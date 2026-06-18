import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  voiceCallsTable,
  voiceDailyUsageTable,
  productsTable,
  userProductsTable,
  knowledgebaseDocsTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

// voice.ts captures RETELL_FUNCTION_SECRET into a module-level const at import
// time, so it must be set BEFORE the router module is evaluated. vi.hoisted runs
// ahead of the static imports below, giving kb-search a known shared secret to
// authenticate against without depending on any live Retell configuration.
const KB_SECRET = vi.hoisted(() => {
  const secret = "test-kb-fn-secret";
  process.env.RETELL_FUNCTION_SECRET = secret;
  return secret;
});

// voice.ts also captures RETELL_API_KEY / RETELL_AGENT_ID into module-level
// consts at import time. POST /voice/web-call short-circuits with a 500 unless
// both are set, so seed them here (ahead of the static import below) to exercise
// the real entitlement + daily-cap gates rather than the missing-config branch.
const RETELL = vi.hoisted(() => {
  process.env.RETELL_API_KEY = "test-retell-api-key";
  process.env.RETELL_AGENT_ID = "agent_test";
  return { apiKey: "test-retell-api-key", agentId: "agent_test" };
});

// Mock the Retell SDK so a started call never reaches the live service. The
// hoisted handle lets each test control what createWebCall returns (or throws).
const retellMock = vi.hoisted(() => ({ createWebCall: vi.fn() }));
vi.mock("retell-sdk", () => ({
  default: class {
    call = { createWebCall: retellMock.createWebCall };
  },
}));

import voiceRouter from "../routes/voice";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `voice-member-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedCallIds: number[] = [];
const insertedUsageIds: number[] = [];
const insertedProductIds: number[] = [];
const insertedUserProductIds: number[] = [];
const insertedDocIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(
  role: "super_admin" | "member",
  suffix: string,
): Promise<{ id: number; email: string; name: string; cookie: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const name = `Test ${suffix}`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, name, cookie: signCookie(row.id, email) };
}

// Grant a user `voice:access` by creating a product carrying that entitlement
// key and an active, non-expiring ownership row. Mirrors how production
// entitlements are derived (see lib/entitlements.ts).
async function grantVoiceAccess(userId: number, suffix: string): Promise<void> {
  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-${suffix}-product`,
      name: `Voice Product ${suffix}`,
      type: "frontend",
      entitlementKeys: ["voice:access"],
    })
    .returning({ id: productsTable.id });
  insertedProductIds.push(product.id);

  const [up] = await db
    .insert(userProductsTable)
    .values({ userId, productId: product.id, status: "active", expiresAt: null })
    .returning({ id: userProductsTable.id });
  insertedUserProductIds.push(up.id);
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

function dateMinusDays(days: number): string {
  const d = new Date(todayUtc() + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

function middayOn(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00.000Z");
}

async function insertUsage(userId: number, usageDate: string, secondsUsed: number): Promise<void> {
  const [row] = await db
    .insert(voiceDailyUsageTable)
    .values({ userId, usageDate, secondsUsed })
    .returning({ id: voiceDailyUsageTable.id });
  insertedUsageIds.push(row.id);
}

async function insertCall(args: {
  userId: number;
  startedAt: Date;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  status?: string;
  transcript?: string | null;
  summary?: string | null;
  disconnectReason?: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId: args.userId,
      retellCallId: `${TEST_TAG}-${randomUUID()}`,
      status: args.status ?? "ended",
      startedAt: args.startedAt,
      endedAt: args.endedAt ?? null,
      durationSeconds: args.durationSeconds ?? null,
      transcript: args.transcript ?? null,
      summary: args.summary ?? null,
      disconnectReason: args.disconnectReason ?? null,
    })
    .returning({ id: voiceCallsTable.id });
  insertedCallIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([voiceRouter]);
});

afterAll(async () => {
  if (insertedDocIds.length > 0) {
    await db.delete(knowledgebaseDocsTable).where(inArray(knowledgebaseDocsTable.id, insertedDocIds));
  }
  if (insertedCallIds.length > 0) {
    await db.delete(voiceCallsTable).where(inArray(voiceCallsTable.id, insertedCallIds));
  }
  if (insertedUsageIds.length > 0) {
    await db.delete(voiceDailyUsageTable).where(inArray(voiceDailyUsageTable.id, insertedUsageIds));
  }
  if (insertedUserProductIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.id, insertedUserProductIds));
  }
  if (insertedProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, insertedProductIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/voice/status", () => {
  it("grants access to an admin even without the voice entitlement", async () => {
    const admin = await seedUser("super_admin", "status-admin");
    const res = await request(app).get("/api/voice/status").set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(true);
  });

  it("grants access to a member who holds voice:access", async () => {
    const member = await seedUser("member", "status-entitled");
    await grantVoiceAccess(member.id, "status-entitled");
    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(true);
  });

  it("denies access to a member without the voice entitlement", async () => {
    const member = await seedUser("member", "status-noaccess");
    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.has_access).toBe(false);
    // No usage yet → full daily cap remains.
    expect(res.body.seconds_used_today).toBe(0);
    expect(res.body.daily_cap_seconds).toBeGreaterThan(0);
    expect(res.body.seconds_remaining).toBe(res.body.daily_cap_seconds);
  });

  it("computes seconds_used_today and seconds_remaining against the daily cap", async () => {
    const member = await seedUser("member", "status-usage");
    // Only today's usage row should count toward seconds_used_today; an older
    // row must be ignored by the date filter.
    await insertUsage(member.id, todayUtc(), 120);
    await insertUsage(member.id, dateMinusDays(2), 999);

    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.seconds_used_today).toBe(120);
    expect(res.body.seconds_remaining).toBe(res.body.daily_cap_seconds - 120);
  });

  it("clamps seconds_remaining at zero once usage exceeds the cap", async () => {
    const member = await seedUser("member", "status-overcap");
    const probe = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    const cap = probe.body.daily_cap_seconds as number;
    await insertUsage(member.id, todayUtc(), cap + 500);

    const res = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.seconds_used_today).toBe(cap + 500);
    expect(res.body.seconds_remaining).toBe(0);
  });
});

describe("GET /api/voice/calls", () => {
  it("returns only ended calls, newest-first", async () => {
    const member = await seedUser("member", "calls-ended");

    // In-progress (no endedAt) call must be excluded entirely.
    await insertCall({ userId: member.id, startedAt: middayOn(todayUtc()), endedAt: null, status: "ongoing" });

    const newest = await insertCall({
      userId: member.id,
      startedAt: middayOn(todayUtc()),
      endedAt: middayOn(todayUtc()),
    });
    const middle = await insertCall({
      userId: member.id,
      startedAt: middayOn(dateMinusDays(1)),
      endedAt: middayOn(dateMinusDays(1)),
    });
    const oldest = await insertCall({
      userId: member.id,
      startedAt: middayOn(dateMinusDays(2)),
      endedAt: middayOn(dateMinusDays(2)),
    });

    const res = await request(app).get("/api/voice/calls").set("Cookie", member.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.calls.map((c: { id: number }) => c.id);
    expect(ids).toEqual([newest, middle, oldest]);
    // The in-progress call is absent.
    expect(res.body.calls.every((c: { ended_at: string | null }) => c.ended_at !== null)).toBe(true);
  });

  it("clamps the limit into the 1..50 range", async () => {
    const member = await seedUser("member", "calls-limit");

    const tooLow = await request(app).get("/api/voice/calls?limit=0").set("Cookie", member.cookie);
    expect(tooLow.status).toBe(200);
    expect(tooLow.body.limit).toBe(1);

    const tooHigh = await request(app).get("/api/voice/calls?limit=100").set("Cookie", member.cookie);
    expect(tooHigh.status).toBe(200);
    expect(tooHigh.body.limit).toBe(50);
  });

  it("pages via limit/offset and reports has_more", async () => {
    const member = await seedUser("member", "calls-paging");

    const ids: number[] = [];
    // Newest first → index 0 is the most recent.
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertCall({
          userId: member.id,
          startedAt: middayOn(dateMinusDays(i)),
          endedAt: middayOn(dateMinusDays(i)),
        }),
      );
    }

    const page1 = await request(app)
      .get("/api/voice/calls?limit=2&offset=0")
      .set("Cookie", member.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.offset).toBe(0);
    expect(page1.body.has_more).toBe(true);
    expect(page1.body.calls.map((c: { id: number }) => c.id)).toEqual([ids[0], ids[1]]);

    const page2 = await request(app)
      .get("/api/voice/calls?limit=2&offset=2")
      .set("Cookie", member.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.offset).toBe(2);
    expect(page2.body.has_more).toBe(false);
    expect(page2.body.calls.map((c: { id: number }) => c.id)).toEqual([ids[2]]);
  });
});

describe("POST /api/voice/kb-search", () => {
  it("rejects a request with a missing bearer secret", async () => {
    const res = await request(app)
      .post("/api/voice/kb-search")
      .send({ query: "commissions" });
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong bearer secret", async () => {
    const res = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", "Bearer not-the-secret")
      .send({ query: "commissions" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an empty query once authenticated", async () => {
    const missing = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", `Bearer ${KB_SECRET}`)
      .send({});
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", `Bearer ${KB_SECRET}`)
      .send({ query: "   " });
    expect(blank.status).toBe(400);
  });

  it("accepts the correct bearer secret and returns matching KB content", async () => {
    // Seed a uniquely-titled doc so the full-text search can surface it without
    // colliding with other rows already in the shared test database.
    const marker = `Quetzal${randomUUID().slice(0, 8)}`;
    const [doc] = await db
      .insert(knowledgebaseDocsTable)
      .values({
        title: `${marker} Affiliate Commission Guide`,
        category: "faq",
        content: `This ${marker} guide explains how affiliate commission payouts work each month.`,
      })
      .returning({ id: knowledgebaseDocsTable.id });
    insertedDocIds.push(doc.id);

    const res = await request(app)
      .post("/api/voice/kb-search")
      .set("Authorization", `Bearer ${KB_SECRET}`)
      .send({ query: `${marker} commission` });

    expect(res.status).toBe(200);
    expect(typeof res.body.results).toBe("string");
    expect(res.body.results).toContain(marker);
  });

  // In production the handler takes a stricter, constant-time comparison branch
  // (crypto.timingSafeEqual) instead of the dev string compare. NODE_ENV is read
  // per-request inside the handler, so we can flip it for these cases and restore
  // it afterward without re-importing the router.
  describe("production-mode auth branch", () => {
    let prevNodeEnv: string | undefined;

    beforeEach(() => {
      prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
    });

    afterEach(() => {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    });

    it("rejects a missing bearer secret with 401", async () => {
      const res = await request(app).post("/api/voice/kb-search").send({ query: "commissions" });
      expect(res.status).toBe(401);
    });

    it("rejects a wrong bearer secret with 401", async () => {
      const res = await request(app)
        .post("/api/voice/kb-search")
        .set("Authorization", "Bearer not-the-secret")
        .send({ query: "commissions" });
      expect(res.status).toBe(401);
    });

    it("accepts the correct bearer secret (past the auth gate → 400 on empty query)", async () => {
      const res = await request(app)
        .post("/api/voice/kb-search")
        .set("Authorization", `Bearer ${KB_SECRET}`)
        .send({ query: "   " });
      // Reaching the 400 validation proves the timingSafeEqual gate accepted it.
      expect(res.status).toBe(400);
    });
  });
});

describe("POST /api/voice/web-call", () => {
  beforeEach(() => {
    retellMock.createWebCall.mockReset();
  });

  it("returns 403 voice_access_required for a member without the voice entitlement", async () => {
    const member = await seedUser("member", "webcall-noaccess");

    const res = await request(app).post("/api/voice/web-call").set("Cookie", member.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("voice_access_required");
    // The Retell SDK must never be touched once the entitlement gate rejects.
    expect(retellMock.createWebCall).not.toHaveBeenCalled();
  });

  it("returns 403 voice_cap_reached for an entitled member at/over the daily cap", async () => {
    const member = await seedUser("member", "webcall-capped");
    await grantVoiceAccess(member.id, "webcall-capped");

    // Probe the configured cap, then drive today's usage to exactly the cap.
    const probe = await request(app).get("/api/voice/status").set("Cookie", member.cookie);
    const cap = probe.body.daily_cap_seconds as number;
    await insertUsage(member.id, todayUtc(), cap);

    const res = await request(app).post("/api/voice/web-call").set("Cookie", member.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("voice_cap_reached");
    expect(retellMock.createWebCall).not.toHaveBeenCalled();
  });

  it("lets an admin over the daily cap bypass the cap and start a call", async () => {
    const admin = await seedUser("super_admin", "webcall-admin");
    // Admin is over the cap; the cap gate must NOT apply to admins.
    const probe = await request(app).get("/api/voice/status").set("Cookie", admin.cookie);
    const cap = probe.body.daily_cap_seconds as number;
    await insertUsage(admin.id, todayUtc(), cap + 500);

    retellMock.createWebCall.mockResolvedValue({
      call_id: `${TEST_TAG}-admin-call`,
      call_status: "registered",
      access_token: "admin-access-token",
    });

    const res = await request(app).post("/api/voice/web-call").set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe("admin-access-token");
    expect(res.body.call_id).toBe(`${TEST_TAG}-admin-call`);
    expect(retellMock.createWebCall).toHaveBeenCalledTimes(1);

    // Track the inserted call row for cleanup.
    const [inserted] = await db
      .select({ id: voiceCallsTable.id })
      .from(voiceCallsTable)
      .where(eq(voiceCallsTable.retellCallId, `${TEST_TAG}-admin-call`));
    if (inserted) insertedCallIds.push(inserted.id);
  });

  it("starts a call for an entitled member under the cap and records a voice_calls row", async () => {
    const member = await seedUser("member", "webcall-success");
    await grantVoiceAccess(member.id, "webcall-success");

    const retellCallId = `${TEST_TAG}-member-call`;
    retellMock.createWebCall.mockResolvedValue({
      call_id: retellCallId,
      call_status: "registered",
      access_token: "member-access-token",
    });

    const res = await request(app).post("/api/voice/web-call").set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe("member-access-token");
    expect(res.body.call_id).toBe(retellCallId);

    // The SDK was invoked with the configured agent id and our member metadata.
    expect(retellMock.createWebCall).toHaveBeenCalledTimes(1);
    const callArg = retellMock.createWebCall.mock.calls[0][0];
    expect(callArg.agent_id).toBe(RETELL.agentId);
    expect(callArg.metadata).toEqual({ bts_user_id: member.id });

    // A voice_calls row must persist for the started call.
    const [inserted] = await db
      .select({
        id: voiceCallsTable.id,
        userId: voiceCallsTable.userId,
        status: voiceCallsTable.status,
        endedAt: voiceCallsTable.endedAt,
      })
      .from(voiceCallsTable)
      .where(eq(voiceCallsTable.retellCallId, retellCallId));
    expect(inserted).toBeTruthy();
    expect(inserted.userId).toBe(member.id);
    expect(inserted.status).toBe("registered");
    expect(inserted.endedAt).toBeNull();
    insertedCallIds.push(inserted.id);
  });

  it("returns 500 and inserts no voice_calls row when the Retell SDK throws", async () => {
    const member = await seedUser("member", "webcall-sdk-throws");
    await grantVoiceAccess(member.id, "webcall-sdk-throws");

    retellMock.createWebCall.mockRejectedValue(new Error("Retell upstream failure"));

    const res = await request(app).post("/api/voice/web-call").set("Cookie", member.cookie);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to start voice call. Please try again.");
    expect(retellMock.createWebCall).toHaveBeenCalledTimes(1);

    // A failed start must NOT leave a phantom voice_calls row behind, or it
    // would pollute usage stats and the admin Voice Usage dashboard.
    const rows = await db
      .select({ id: voiceCallsTable.id })
      .from(voiceCallsTable)
      .where(eq(voiceCallsTable.userId, member.id));
    expect(rows).toHaveLength(0);
  });
});
