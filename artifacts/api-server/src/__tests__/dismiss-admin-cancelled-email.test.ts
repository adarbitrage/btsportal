import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sessionsTable,
  emailChangeAttemptsTable,
} from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";

vi.mock("../lib/entitlements", () => ({
  getUserEntitlements: vi.fn(async () => ({})),
  getUserProducts: vi.fn(async () => []),
  getEntitlementsList: vi.fn(() => []),
  getHighestProductLabel: vi.fn(() => ({ name: "Free", slug: "free" })),
  getSupportTicketLimit: vi.fn(() => 1),
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

import { buildTestApp } from "./test-app";
import membersRouter from "../routes/members";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `dismiss-admin-cancelled-${randomUUID().slice(0, 8)}`;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("CorrectHorse1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function insertAdmin(suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("AdminPass1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin-${suffix}@example.test`,
      name: `Admin ${suffix}`,
      passwordHash,
      role: "admin",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertAttempt(opts: {
  userId: number;
  newEmail: string;
  cancelledByAdminId?: number | null;
  cancelledAt?: Date | null;
  createdAt?: Date;
  dismissedByMemberAt?: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(emailChangeAttemptsTable)
    .values({
      userId: opts.userId,
      newEmail: opts.newEmail,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      cancelledByAdminId: opts.cancelledByAdminId ?? null,
      cancelledAt: opts.cancelledAt ?? null,
      dismissedByMemberAt: opts.dismissedByMemberAt ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: emailChangeAttemptsTable.id });
  return row.id;
}

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

beforeAll(() => {
  app = buildTestApp({ routers: [membersRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(emailChangeAttemptsTable)
      .where(inArray(emailChangeAttemptsTable.userId, seededUserIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/members/me/email/admin-cancellation/dismiss", () => {
  it("stamps dismissed_by_member_at on the latest admin-cancelled attempt", async () => {
    const user = await insertUser("happy-path");
    const adminId = await insertAdmin("happy-path");
    const attemptId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-target@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-15T10:00:00.000Z"),
    });

    const before = Date.now();
    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: true });

    const [row] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, attemptId));

    expect(row.dismissedByMemberAt).not.toBeNull();
    const ts = row.dismissedByMemberAt!.getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  it("is a no-op (dismissed: false) when there is no email-change attempt", async () => {
    const user = await insertUser("none");

    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false });
  });

  it("is a no-op when the latest attempt is not admin-cancelled (e.g. still pending)", async () => {
    // A self-initiated pending attempt arriving after an admin cancellation
    // means the cancellation is no longer the freshest signal. Dismissing in
    // that state must not stamp the older row — otherwise the member could
    // accidentally clear future cancellations they haven't seen yet.
    const user = await insertUser("superseded");
    const adminId = await insertAdmin("superseded");
    const olderAttemptId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-old@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-10T08:00:00.000Z"),
      createdAt: new Date("2026-04-10T07:55:00.000Z"),
    });
    await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-new@example.test`,
      createdAt: new Date("2026-04-12T09:00:00.000Z"),
    });

    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: false });

    const [olderRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, olderAttemptId));
    expect(olderRow.dismissedByMemberAt).toBeNull();
  });

  it("is idempotent — calling dismiss twice does not overwrite the original timestamp", async () => {
    const user = await insertUser("idempotent");
    const adminId = await insertAdmin("idempotent");
    const attemptId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-idem@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-15T10:00:00.000Z"),
    });

    const res1 = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ dismissed: true });

    const [first] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, attemptId));
    const firstStamp = first.dismissedByMemberAt!.getTime();

    // Wait long enough that any second write would be detectable as a delta.
    await new Promise((r) => setTimeout(r, 25));

    const res2 = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res2.status).toBe(200);
    // Already dismissed — second call reports no-op.
    expect(res2.body).toEqual({ dismissed: false });

    const [second] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, attemptId));
    expect(second.dismissedByMemberAt!.getTime()).toBe(firstStamp);
  });

  it("only dismisses the latest attempt, never older admin-cancelled rows", async () => {
    // Two admin cancellations stacked, neither dismissed yet. The dismiss
    // endpoint must touch only the newest one — older history should remain
    // pristine for audit purposes.
    const user = await insertUser("latest-only");
    const adminId = await insertAdmin("latest-only");
    const olderAttemptId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-old@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-03-01T12:00:00.000Z"),
      createdAt: new Date("2026-03-01T11:55:00.000Z"),
    });
    const newerAttemptId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-new@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-01T12:00:00.000Z"),
      createdAt: new Date("2026-04-01T11:55:00.000Z"),
    });

    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dismissed: true });

    const [olderRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, olderAttemptId));
    expect(olderRow.dismissedByMemberAt).toBeNull();

    const [newerRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, newerAttemptId));
    expect(newerRow.dismissedByMemberAt).not.toBeNull();
  });

  it("requires authentication", async () => {
    const res = await request(app).post(
      "/api/members/me/email/admin-cancellation/dismiss",
    );
    // 401 from the auth middleware
    expect(res.status).toBe(401);
  });

  it("does not stamp another member's attempt", async () => {
    // Defence in depth: the latest row lookup is keyed by userId, so the
    // dismiss endpoint must never touch some other member's attempt row even
    // if both rows exist in the table at the same time.
    const victim = await insertUser("victim");
    const adminId = await insertAdmin("crosstalk");
    const victimAttemptId = await insertAttempt({
      userId: victim.id,
      newEmail: `${TEST_TAG}-victim-target@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-15T10:00:00.000Z"),
    });

    const attacker = await insertUser("attacker");

    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(attacker.id, attacker.email));

    expect(res.status).toBe(200);
    // Attacker has no attempts of their own.
    expect(res.body).toEqual({ dismissed: false });

    const [victimRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, victimAttemptId));
    expect(victimRow.dismissedByMemberAt).toBeNull();
  });

  // Sanity: the most recent admin-cancelled attempt is the one that gets
  // surfaced/dismissed, regardless of insertion order. We pick the latest by
  // createdAt with desc() — assert that ordering is honoured here so a later
  // schema/index change doesn't silently break it.
  it("respects createdAt ordering when there are multiple attempts", async () => {
    const user = await insertUser("ordering");
    const adminId = await insertAdmin("ordering");
    // Insert "newer" first so id ordering and createdAt ordering disagree.
    const newerId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-newer@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-20T08:00:00.000Z"),
      createdAt: new Date("2026-04-20T07:55:00.000Z"),
    });
    const olderId = await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-older@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-10T08:00:00.000Z"),
      createdAt: new Date("2026-04-10T07:55:00.000Z"),
    });

    // Sanity-check the desc(createdAt) lookup matches the route's own logic.
    const [latest] = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, user.id))
      .orderBy(desc(emailChangeAttemptsTable.createdAt))
      .limit(1);
    expect(latest.id).toBe(newerId);

    const res = await request(app)
      .post("/api/members/me/email/admin-cancellation/dismiss")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.body).toEqual({ dismissed: true });

    const [newerRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, newerId));
    expect(newerRow.dismissedByMemberAt).not.toBeNull();

    const [olderRow] = await db
      .select({
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.id, olderId));
    expect(olderRow.dismissedByMemberAt).toBeNull();
  });
});
