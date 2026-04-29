import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  auditLogTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

// In-memory fake Redis matching the throttle helpers in auth.ts (SET NX EX
// only). Mirrors the fixture in
// `auth-register-signup-attempted-throttle.test.ts` so behavior under test
// matches what the rest of the suite already validates.
const { fakeRedis, redisStore } = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  const redis: any = {
    async set(key: string, value: string, ...args: unknown[]) {
      let ttlMs: number | null = null;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (typeof token === "string" && token.toUpperCase() === "EX") {
          ttlMs = Number(args[++i]) * 1000;
        } else if (typeof token === "string" && token.toUpperCase() === "PX") {
          ttlMs = Number(args[++i]);
        } else if (typeof token === "string" && token.toUpperCase() === "NX") {
          nx = true;
        }
      }
      const existing = store.get(key);
      if (existing && !isExpired(existing) && nx) return null;
      store.set(key, {
        value,
        expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
      });
      return "OK";
    },
    async del(key: string) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
    async pttl(key: string) {
      const entry = store.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      const remaining = entry.expiresAt - Date.now();
      if (remaining <= 0) {
        store.delete(key);
        return -2;
      }
      return remaining;
    },
  };

  return { fakeRedis: redis, redisStore: store };
});

vi.mock("../lib/redis", () => ({
  getRedis: () => fakeRedis,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => true),
}));

const { sendEmailNowMock, emitWebhookEventMock, queueGHLSyncMock } = vi.hoisted(
  () => ({
    sendEmailNowMock: vi.fn(async () => ({ success: true })),
    emitWebhookEventMock: vi.fn(async () => undefined),
    queueGHLSyncMock: vi.fn(async () => "job_test_id"),
  }),
);

vi.mock("../lib/communication-service", () => ({
  CommunicationService: { sendEmailNow: sendEmailNowMock },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: emitWebhookEventMock,
  WEBHOOK_EVENT_TYPES: [],
}));

vi.mock("../middleware/abuse-rate-limit", () => {
  const passthrough =
    () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    abuseRateLimit: passthrough,
    ipKey: () => () => null,
    emailKey: () => () => null,
  };
});

import {
  processRegisterRequest,
  SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION,
  SIGNUP_NOTICE_SUPPRESSED_AUDIT_ENTITY,
  maskEmailForSignupAudit,
} from "../routes/auth";

const TEST_TAG = `signup-audit-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let baselineAuditId = 0;

async function seedExistingUser(suffix: string) {
  const email = `${TEST_TAG}-${suffix}@example.test`.toLowerCase();
  const passwordHash = await bcrypt.hash("ExistingPass1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      name: `Existing ${suffix}`,
      email,
      passwordHash,
      role: "member",
      emailVerified: true,
    })
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    });
  seededUserIds.push(row.id);
  return row;
}

async function fetchSuppressionRows() {
  return db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION),
        gte(auditLogTable.id, baselineAuditId + 1),
      ),
    )
    .orderBy(desc(auditLogTable.id));
}

async function deleteSuppressionRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION),
        gte(auditLogTable.id, baselineAuditId + 1),
      ),
    );
}

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;
});

afterAll(async () => {
  await deleteSuppressionRows();
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  sendEmailNowMock.mockClear();
  emitWebhookEventMock.mockClear();
  queueGHLSyncMock.mockClear();
  redisStore.clear();
  await deleteSuppressionRows();
});

describe("processRegisterRequest — signup_notice_suppressed audit row", () => {
  it("does not write a suppression row when the throttle allows the first notice through", async () => {
    const existing = await seedExistingUser("first-allowed");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "10.0.0.1",
    });

    // Only the actual notice should have been sent — no suppression row yet.
    const noticeCalls = sendEmailNowMock.mock.calls.filter(
      (c: any[]) => c[0]?.templateSlug === "signup_attempted",
    );
    expect(noticeCalls).toHaveLength(1);

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(0);
  });

  it("writes one suppression row on the first throttled attempt and includes hash, masked email, and IP", async () => {
    const existing = await seedExistingUser("burst-source");

    // First attempt sends the notice.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.5",
    });
    // Second attempt is suppressed → should write the audit row.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.5",
    });

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.entityType).toBe(SIGNUP_NOTICE_SUPPRESSED_AUDIT_ENTITY);
    expect(row.entityId).toBeTruthy();
    expect(row.entityId).not.toContain("@");
    // The cleartext email must NOT appear anywhere in the row — it's the
    // whole point of hashing/masking. Check description, metadata, and the
    // top-level columns explicitly.
    const serialized = JSON.stringify(row);
    expect(serialized.toLowerCase()).not.toContain(existing.email);
    expect(row.description).toContain(maskEmailForSignupAudit(existing.email));
    expect(row.description).toContain("203.0.113.5");
    expect(row.ipAddress).toBe("203.0.113.5");
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.ip).toBe("203.0.113.5");
    expect(meta.maskedEmail).toBe(maskEmailForSignupAudit(existing.email));
    expect(meta.emailHash).toBe(row.entityId);
    expect(typeof meta.windowSec).toBe("number");
    // No PII column should be set.
    expect(row.actorEmail).toBeNull();
  });

  it("collapses repeated suppressions within the window down to a single audit row", async () => {
    const existing = await seedExistingUser("flood");

    // 1 send + 9 suppressions (one IP). All 9 suppressions must collapse
    // into a single audit row so an attacker can't flood the audit log
    // itself by repeatedly hitting /auth/register.
    for (let i = 0; i < 10; i++) {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
        ip: "198.51.100.7",
      });
    }

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(1);
  });

  it("collapses suppressions across different source IPs too — one row per email per window", async () => {
    const existing = await seedExistingUser("ip-rotation");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "198.51.100.10",
    });
    // Subsequent attempts from rotating IPs are still all the same
    // probing campaign against this address — the dedup is per-email,
    // not per-(email, ip), so the audit row stays bounded.
    for (let i = 0; i < 5; i++) {
      await processRegisterRequest({
        email: existing.email,
        password: "Whatever1!",
        name: "Imp",
        ip: `198.51.100.${20 + i}`,
      });
    }

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(1);
    // The recorded IP is the first suppressing source — that's enough to
    // start an investigation, and the dedup-bound matters more than full
    // attribution here.
    expect(rows[0].ipAddress).toBe("198.51.100.20");
  });

  it("keeps suppression rows per-target — different victims each get their own row", async () => {
    const a = await seedExistingUser("victim-a");
    const b = await seedExistingUser("victim-b");

    // Burst against A — 2nd attempt suppressed.
    await processRegisterRequest({
      email: a.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.1",
    });
    await processRegisterRequest({
      email: a.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.1",
    });
    // Burst against B — 2nd attempt suppressed.
    await processRegisterRequest({
      email: b.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.2",
    });
    await processRegisterRequest({
      email: b.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.2",
    });

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(2);
    const hashes = rows.map((r) => r.entityId).sort();
    expect(new Set(hashes).size).toBe(2);
  });

  it("writes a fresh suppression row once the dedup window has expired", async () => {
    const existing = await seedExistingUser("window-roll");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.50",
    });
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.50",
    });

    expect((await fetchSuppressionRows()).length).toBe(1);

    // Simulate the window TTL elapsing — the audit gate uses the same
    // expiring Redis key as the email throttle, so once it's gone a new
    // suppression should produce a fresh row.
    redisStore.clear();

    // Re-seed: the email throttle is now also empty, so the first attempt
    // sends the notice again. The second is suppressed and writes a new
    // audit row.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.51",
    });
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "192.0.2.51",
    });

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(2);
    // Newest first (desc by id) — verify the second window's IP is what
    // we surface on the new row.
    expect(rows[0].ipAddress).toBe("192.0.2.51");
    expect(rows[1].ipAddress).toBe("192.0.2.50");
  });

  it("[regression] writes a fresh row in the next throttle window even if the audit gate from the previous window is still live", async () => {
    // This is the key cross-window drift scenario the dedup must handle:
    //   T0:        send (throttle key set, expires at T0+W)
    //   T0 + ε:    suppress (audit gate set — if it had its OWN TTL,
    //              it would expire at T0+ε+W, drifting past the throttle
    //              window)
    //   T0+W:      throttle key expires, BUT a stale audit gate may still
    //              be alive
    //   T0+W+δ:    new send opens a fresh throttle window, then a new
    //              suppression must produce a NEW audit row even though
    //              the previous window's audit gate could still be live
    //
    // Earlier implementations failed this case because the audit gate
    // had its own EX anchored at the first suppression. The fix anchors
    // the audit gate to the throttle key's remaining TTL AND clears the
    // audit gate whenever a fresh send opens a new throttle window.
    const existing = await seedExistingUser("drift");
    const hash = (
      await import("crypto")
    ).default
      .createHash("sha256")
      .update(existing.email.toLowerCase().trim())
      .digest("hex")
      .slice(0, 24);
    const throttleKey = `auth:signup-attempted-notice:${hash}`;
    const auditKey = `auth:signup-attempted-audit:${hash}`;

    // Window 1: send, then suppress.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.40",
    });
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.40",
    });
    expect((await fetchSuppressionRows()).length).toBe(1);

    // Confirm both keys are present, then EXPIRE ONLY THE THROTTLE KEY
    // while leaving the audit gate live. This is the drift scenario:
    // a stale audit-write gate hanging around past the throttle window.
    expect(redisStore.has(throttleKey)).toBe(true);
    expect(redisStore.has(auditKey)).toBe(true);
    redisStore.delete(throttleKey);

    // Window 2: a fresh send should open a new throttle window AND wipe
    // the stale audit gate so the next suppression is recorded.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.41",
    });
    // The send path must have cleared the stale audit gate.
    expect(redisStore.has(auditKey)).toBe(false);
    // Now the next attempt is suppressed by the new throttle window —
    // it must write a fresh audit row, not be silently swallowed.
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
      ip: "203.0.113.41",
    });

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].ipAddress).toBe("203.0.113.41");
    expect(rows[1].ipAddress).toBe("203.0.113.40");
  });

  it("falls back to 'unknown' as the IP label when the request has no usable IP", async () => {
    const existing = await seedExistingUser("no-ip");

    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });
    await processRegisterRequest({
      email: existing.email,
      password: "Whatever1!",
      name: "Imp",
    });

    const rows = await fetchSuppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].ipAddress).toBeNull();
    expect(rows[0].description).toContain("from unknown");
    expect((rows[0].metadata as Record<string, unknown>).ip).toBeNull();
  });
});

describe("maskEmailForSignupAudit", () => {
  it("preserves the first character and full domain", () => {
    expect(maskEmailForSignupAudit("jane.doe@example.com")).toBe(
      "j*******@example.com",
    );
  });

  it("masks single-character locals down to a single asterisk", () => {
    expect(maskEmailForSignupAudit("a@example.com")).toBe("*@example.com");
  });

  it("returns *** for inputs with no usable local or no domain", () => {
    expect(maskEmailForSignupAudit("@example.com")).toBe("***");
    expect(maskEmailForSignupAudit("noatsign")).toBe("***");
    expect(maskEmailForSignupAudit("trailing@")).toBe("***");
  });
});
