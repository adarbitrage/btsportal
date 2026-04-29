import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `arl-alert-cfg-hist-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;
let adminEmail: string;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string, name: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
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
  return { id: row.id, email };
}

async function clearAuditRows() {
  // Wipe every alert-config audit row regardless of source so the history
  // endpoint sees a deterministic dataset on each test.
  await db
    .delete(auditLogTable)
    .where(eq(auditLogTable.entityType, "auth_rate_limit_alert_config"));
}

async function insertEdit(
  changedFields: string[],
  diff: Record<string, { from: number; to: number }>,
  options: { actorId?: number | null; actorEmail?: string | null; createdAt?: Date } = {},
) {
  await db.insert(auditLogTable).values({
    actorId: options.actorId ?? adminId,
    actorEmail: options.actorEmail ?? adminEmail,
    actionType: "update_setting",
    entityType: "auth_rate_limit_alert_config",
    entityId: "auth_rate_limit_alert",
    description: `Updated auth rate-limit alert config: ${changedFields.join(", ")}`,
    changeDiff: { changedFields, diff },
    createdAt: options.createdAt ?? new Date(),
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin", "Test admin");
  const member = await insertUser("member", "non-admin", "Test member");
  adminId = admin.id;
  adminEmail = admin.email;
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  await clearAuditRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearAuditRows();
});

describe("GET /admin/auth-rate-limit-alert-config/history", () => {
  it("returns 401 when unauthenticated and 403 for non-admins", async () => {
    const anon = await request(app).get("/api/admin/auth-rate-limit-alert-config/history");
    expect([401, 403]).toContain(anon.status);

    const member = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history")
      .set("Cookie", memberCookie);
    expect(member.status).toBe(403);
  });

  it("returns an empty events array when no edits have been recorded", async () => {
    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [], limit: 10 });
  });

  it("returns events newest-first with parsed actor + diff fields", async () => {
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const later = new Date(Date.now() - 5 * 60 * 1000);
    await insertEdit(["threshold"], { threshold: { from: 10, to: 25 } }, { createdAt: earlier });
    await insertEdit(
      ["windowMinutes", "dominantIpRatio"],
      {
        windowMinutes: { from: 15, to: 5 },
        dominantIpRatio: { from: 0.6, to: 0.8 },
      },
      { createdAt: later },
    );

    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(10);
    expect(res.body.events).toHaveLength(2);

    // Most recent is first.
    const [first, second] = res.body.events as Array<Record<string, unknown>>;
    expect(new Date(first.createdAt as string).getTime()).toBe(later.getTime());
    expect(new Date(second.createdAt as string).getTime()).toBe(earlier.getTime());

    // Actor join populates name from usersTable so the UI doesn't have to
    // fall back to email-only display when an admin is still on file.
    expect(first.actorId).toBe(adminId);
    expect(first.actorEmail).toBe(adminEmail);
    expect(first.actorName).toBe("Test admin");
    expect(first.actionType).toBe("update_setting");
    expect(first.changedFields).toEqual(
      expect.arrayContaining(["windowMinutes", "dominantIpRatio"]),
    );
    expect(first.diff).toEqual(
      expect.arrayContaining([
        { field: "windowMinutes", from: 15, to: 5 },
        { field: "dominantIpRatio", from: 0.6, to: 0.8 },
      ]),
    );

    expect(second.changedFields).toEqual(["threshold"]);
    expect(second.diff).toEqual([{ field: "threshold", from: 10, to: 25 }]);
  });

  it("clamps the limit to [1, 50] and honors a smaller value", async () => {
    for (let i = 0; i < 5; i++) {
      await insertEdit(["threshold"], { threshold: { from: 10, to: 10 + i } }, {
        createdAt: new Date(Date.now() - i * 60 * 1000),
      });
    }

    const small = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history?limit=2")
      .set("Cookie", adminCookie);
    expect(small.status).toBe(200);
    expect(small.body.limit).toBe(2);
    expect(small.body.events).toHaveLength(2);

    // Bogus values fall back to the default cap rather than 500-ing.
    const bogus = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history?limit=not-a-number")
      .set("Cookie", adminCookie);
    expect(bogus.status).toBe(200);
    expect(bogus.body.limit).toBe(10);

    // Over-the-cap values get clamped to the upper bound, not rejected.
    const big = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history?limit=9999")
      .set("Cookie", adminCookie);
    expect(big.status).toBe(200);
    expect(big.body.limit).toBe(50);

    // Zero clamps up to the lower bound.
    const zero = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history?limit=0")
      .set("Cookie", adminCookie);
    expect(zero.status).toBe(200);
    expect(zero.body.limit).toBe(1);
  });

  it("tolerates malformed audit_log changeDiff payloads without crashing", async () => {
    // Audit rows can be written by older code paths — make sure a row with
    // an unexpected diff shape produces an event with empty changedFields/diff
    // instead of taking the whole endpoint down.
    await db.insert(auditLogTable).values({
      actorId: adminId,
      actorEmail: adminEmail,
      actionType: "update_setting",
      entityType: "auth_rate_limit_alert_config",
      entityId: "auth_rate_limit_alert",
      description: "Legacy entry",
      changeDiff: { somethingElse: 42 } as unknown as Record<string, unknown>,
      createdAt: new Date(),
    });

    const res = await request(app)
      .get("/api/admin/auth-rate-limit-alert-config/history")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].changedFields).toEqual([]);
    expect(res.body.events[0].diff).toEqual([]);
    expect(res.body.events[0].description).toBe("Legacy entry");
  });
});
