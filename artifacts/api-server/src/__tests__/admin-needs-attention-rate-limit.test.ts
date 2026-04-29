import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { and, eq, gte, inArray, like } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { AUTH_RATE_LIMIT_AUDIT_ACTION, AUTH_RATE_LIMIT_AUDIT_ENTITY } from "../routes/auth";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const TEST_TAG = `needs-attention-rl-${randomUUID().slice(0, 8)}`;
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let adminUserId: number;

async function seedAdmin(): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Test admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, email, cookie: `access_token=${token}` };
}

async function insertRateLimitRow(opts: { ip: string | null; minutesAgo: number }) {
  await db.insert(auditLogTable).values({
    actorId: null,
    actorEmail: null,
    actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
    entityType: AUTH_RATE_LIMIT_AUDIT_ENTITY,
    entityId: "login",
    description: `[${TEST_TAG}] simulated rate-limit hit`,
    ipAddress: opts.ip,
    metadata: { source: TEST_TAG },
    createdAt: new Date(Date.now() - opts.minutesAgo * 60 * 1000),
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedAdmin();
  adminUserId = admin.id;
  adminCookie = admin.cookie;
});

// The endpoint counts every `auth_rate_limit_blocked` row in the trailing
// 15-minute window — it has no concept of "rows belonging to this test". To
// keep assertions hermetic we wipe ALL rows with this action type that fall
// inside the alert window before each test, plus any tagged rows from this
// file (which may have been inserted with a backdated createdAt outside the
// window). We never run this in parallel with other suites — the api-server
// vitest config sets `pool: "forks"` with `singleFork: true`.
const ALERT_WINDOW_MS = 15 * 60 * 1000;

async function isolateRecentRows() {
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        gte(auditLogTable.createdAt, new Date(Date.now() - ALERT_WINDOW_MS - 60_000)),
      ),
    );
  // Backdated rows from this file (createdAt outside the window above).
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actionType, AUTH_RATE_LIMIT_AUDIT_ACTION),
        like(auditLogTable.description, "[needs-attention-rl-%"),
      ),
    );
}

afterAll(async () => {
  await isolateRecentRows();
  await db.delete(usersTable).where(inArray(usersTable.id, [adminUserId]));
});

beforeEach(async () => {
  await isolateRecentRows();
});

describe("GET /admin/dashboard/needs-attention — auth rate-limit burst alert", () => {
  it("does not surface an alert when activity is below the threshold", async () => {
    for (let i = 0; i < 5; i++) {
      await insertRateLimitRow({ ip: "10.0.0.1", minutesAgo: 1 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeUndefined();
  });

  it("surfaces a burst alert with the dominant IP when ≥10 hits come from one source", async () => {
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: "203.0.113.7", minutesAgo: i % 10 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.severity).toBe("high");
    expect(burst.description).toContain("12 auth rate-limit hits");
    expect(burst.description).toContain("203.0.113.7");
    expect(burst.link).toBe(`/admin/audit-log?actionType=${AUTH_RATE_LIMIT_AUDIT_ACTION}`);
  });

  it("omits the dominant-IP suffix when the burst is spread across many IPs", async () => {
    for (let i = 0; i < 12; i++) {
      await insertRateLimitRow({ ip: `198.51.100.${i + 1}`, minutesAgo: 2 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeDefined();
    expect(burst.description).toContain("12 auth rate-limit hits");
    expect(burst.description).not.toContain("from 198.51.100.");
  });

  it("ignores rate-limit hits older than the 15-minute window", async () => {
    for (let i = 0; i < 20; i++) {
      await insertRateLimitRow({ ip: "203.0.113.99", minutesAgo: 30 });
    }

    const res = await request(app)
      .get("/api/admin/dashboard/needs-attention")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const burst = (res.body as any[]).find((a) => a.type === "auth_rate_limit_burst");
    expect(burst).toBeUndefined();
  });
});
