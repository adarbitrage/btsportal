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
import { eq, inArray } from "drizzle-orm";

// The /members/me handler does not actually call the entitlements helpers
// for any logic we exercise here, but resolving them touches a number of
// joined tables. Stubbing them keeps the test focused on the new
// `lastAdminCancelledEmailChange` field and avoids depending on product
// fixtures.
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
const TEST_TAG = `current-member-test-${randomUUID().slice(0, 8)}`;

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
}): Promise<number> {
  const [row] = await db
    .insert(emailChangeAttemptsTable)
    .values({
      userId: opts.userId,
      newEmail: opts.newEmail,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      cancelledByAdminId: opts.cancelledByAdminId ?? null,
      cancelledAt: opts.cancelledAt ?? null,
      // createdAt is `defaultNow()`, so callers that need a deterministic
      // ordering pass an explicit value to control which row is "latest".
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

describe("GET /api/members/me — lastAdminCancelledEmailChange", () => {
  it("is null when the member has never requested an email change", async () => {
    const user = await insertUser("never");

    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.lastAdminCancelledEmailChange).toBeNull();
  });

  it("is null when the member's most recent attempt is still pending (not cancelled)", async () => {
    const user = await insertUser("pending");
    await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-pending-target@example.test`,
    });

    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.lastAdminCancelledEmailChange).toBeNull();
  });

  it("returns the cancelled target and timestamp when the latest attempt was admin-cancelled", async () => {
    const user = await insertUser("cancelled");
    const adminId = await insertAdmin("cancelled");
    const cancelledTarget = `${TEST_TAG}-cancelled-target@example.test`;
    const cancelledAt = new Date("2026-04-15T10:30:00.000Z");
    await insertAttempt({
      userId: user.id,
      newEmail: cancelledTarget,
      cancelledByAdminId: adminId,
      cancelledAt,
    });

    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.lastAdminCancelledEmailChange).toEqual({
      newEmail: cancelledTarget,
      cancelledAt: cancelledAt.toISOString(),
    });
  });

  it("hides the admin cancellation once the member starts a newer attempt", async () => {
    // The member's pending change was admin-cancelled, then the member
    // immediately tried again. The second attempt is the freshest signal
    // about their email-change state, so the admin-cancelled note should
    // disappear to avoid stale messaging on the account page.
    const user = await insertUser("superseded");
    const adminId = await insertAdmin("superseded");
    await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-superseded-old@example.test`,
      cancelledByAdminId: adminId,
      cancelledAt: new Date("2026-04-10T08:00:00.000Z"),
      createdAt: new Date("2026-04-10T07:55:00.000Z"),
    });
    await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-superseded-new@example.test`,
      createdAt: new Date("2026-04-12T09:00:00.000Z"),
    });

    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.lastAdminCancelledEmailChange).toBeNull();
  });

  it("does not surface attempts cancelled by the member themselves (no admin id)", async () => {
    // /members/me/email/cancel does NOT set cancelledByAdminId — only the
    // admin-side handler does. A self-cancel therefore must not produce the
    // admin-cancelled note, even though the row's `cancelledAt` is set.
    const user = await insertUser("self-cancel");
    await insertAttempt({
      userId: user.id,
      newEmail: `${TEST_TAG}-self-cancel-target@example.test`,
      cancelledAt: new Date("2026-04-05T12:00:00.000Z"),
      cancelledByAdminId: null,
    });

    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body.lastAdminCancelledEmailChange).toBeNull();
  });
});
