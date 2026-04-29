import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  emailChangeAttemptsTable,
  emailChangeHistoryTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

import { buildTestApp } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `admin-attempts-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;
let admin: { id: number; email: string };
let member: { id: number; email: string };

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestApp({ routers: [adminPanelRouter] });

  const passwordHash = await bcrypt.hash("pw", 4);

  const [adminRow] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-admin@example.test`,
      name: "Admin",
      passwordHash,
      role: "super_admin",
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  admin = adminRow;
  seededUserIds.push(adminRow.id);

  const [memberRow] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-member@example.test`,
      name: "Member",
      passwordHash,
      role: "member",
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  member = memberRow;
  seededUserIds.push(memberRow.id);
});

afterAll(async () => {
  if (seededUserIds.length === 0) return;
  await db
    .delete(emailChangeAttemptsTable)
    .where(inArray(emailChangeAttemptsTable.userId, seededUserIds));
  await db
    .delete(emailChangeHistoryTable)
    .where(inArray(emailChangeHistoryTable.userId, seededUserIds));
  await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
});

async function resetAttempts() {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, member.id));
  await db
    .delete(emailChangeHistoryTable)
    .where(eq(emailChangeHistoryTable.userId, member.id));
  await db
    .update(usersTable)
    .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
    .where(eq(usersTable.id, member.id));
}

async function backdateAttempt(id: number, createdAt: Date): Promise<void> {
  await db.execute(
    sql`UPDATE email_change_attempts SET created_at = ${createdAt} WHERE id = ${id}`,
  );
}

describe("GET /admin/members/:id/full — emailAttempts classification", () => {
  it("classifies pending, expired, abandoned and confirmed attempts correctly", async () => {
    await resetAttempts();

    const now = Date.now();
    const HOUR = 60 * 60 * 1000;

    // 1) pending: still active in users + not expired
    const pendingExpires = new Date(now + 12 * HOUR);
    await db
      .update(usersTable)
      .set({
        pendingEmail: "pending-new@example.test",
        emailChangeToken: "tok",
        emailChangeExpires: pendingExpires,
      })
      .where(eq(usersTable.id, member.id));
    await db.insert(emailChangeAttemptsTable).values({
      userId: member.id,
      newEmail: "pending-new@example.test",
      expiresAt: pendingExpires,
    });

    // 2) expired: past expiry, not in history, not the active pending
    const expiredCreated = new Date(now - 3 * 24 * HOUR);
    const expiredExpires = new Date(now - 2 * 24 * HOUR);
    const [expiredRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: "expired-target@example.test",
        expiresAt: expiredExpires,
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(expiredRow.id, expiredCreated);

    // 3) abandoned: was requested, then a newer pending one superseded it,
    // and it isn't expired yet but isn't the active one either.
    const abandonedExpires = new Date(now + 6 * HOUR);
    await db.insert(emailChangeAttemptsTable).values({
      userId: member.id,
      newEmail: "abandoned-target@example.test",
      expiresAt: abandonedExpires,
    });

    // 4) confirmed: matching history row exists with changedAt >= createdAt
    const confirmedAttemptCreated = new Date(now - 5 * HOUR);
    const confirmedAt = new Date(now - 4 * HOUR);
    const [confirmedAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: "confirmed-target@example.test",
        expiresAt: new Date(now - 1 * HOUR),
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(confirmedAttempt.id, confirmedAttemptCreated);
    await db.insert(emailChangeHistoryTable).values({
      userId: member.id,
      oldEmail: member.email,
      newEmail: "confirmed-target@example.test",
      changedAt: confirmedAt,
    });

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    const attempts: Array<{ newEmail: string; status: string }> = res.body.emailAttempts;
    expect(attempts).toBeDefined();
    expect(Array.isArray(attempts)).toBe(true);

    const byEmail = Object.fromEntries(attempts.map(a => [a.newEmail, a.status]));
    expect(byEmail["pending-new@example.test"]).toBe("pending");
    expect(byEmail["expired-target@example.test"]).toBe("expired");
    expect(byEmail["abandoned-target@example.test"]).toBe("abandoned");
    expect(byEmail["confirmed-target@example.test"]).toBe("confirmed");
  });

  it("attaches a confirmation to the latest matching attempt, not the oldest", async () => {
    // When a member requests the same email twice (e.g. first request's
    // verification email got buried, so they requested again) and then
    // confirms, only the latest attempt's token is valid — so the
    // confirmation belongs to the latest attempt, not the original.
    await resetAttempts();

    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const TARGET = "repeat-target@example.test";

    // Older attempt: same email, was abandoned (still un-expired but stale).
    const [olderAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: TARGET,
        expiresAt: new Date(now + 8 * HOUR),
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(olderAttempt.id, new Date(now - 6 * HOUR));

    // Newer attempt: same email, confirmed shortly after.
    const [newerAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: TARGET,
        expiresAt: new Date(now + 20 * HOUR),
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(newerAttempt.id, new Date(now - 2 * HOUR));

    await db.insert(emailChangeHistoryTable).values({
      userId: member.id,
      oldEmail: member.email,
      newEmail: TARGET,
      changedAt: new Date(now - 1 * HOUR),
    });

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    const attempts: Array<{ id: number; status: string }> = res.body.emailAttempts;
    const newer = attempts.find(a => a.id === newerAttempt.id);
    const older = attempts.find(a => a.id === olderAttempt.id);
    expect(newer?.status).toBe("confirmed");
    expect(older?.status).toBe("abandoned");
  });

  it("excludes legacy attempt rows that have no newEmail", async () => {
    await resetAttempts();

    // Legacy row inserted before the column existed.
    await db.insert(emailChangeAttemptsTable).values({ userId: member.id });

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    expect(res.body.emailAttempts).toEqual([]);
  });

  it("returns the first page and total count from /full and pages older attempts via /email-attempts", async () => {
    await resetAttempts();

    const HOUR = 60 * 60 * 1000;
    const baseTime = Date.now() - 80 * 24 * HOUR;

    // Seed 60 attempts so we exceed the 50-row first page and need to page.
    const TOTAL = 60;
    const expected: { id: number; newEmail: string; createdAtMs: number }[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const newEmail = `paged-${i.toString().padStart(3, "0")}@example.test`;
      const [row] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail,
          // All in the past so none classify as pending.
          expiresAt: new Date(baseTime + i * HOUR + 30 * 60 * 1000),
        })
        .returning({ id: emailChangeAttemptsTable.id });
      const createdAtMs = baseTime + i * HOUR;
      await backdateAttempt(row.id, new Date(createdAtMs));
      expected.push({ id: row.id, newEmail, createdAtMs });
    }
    // DESC order — what the API should walk through.
    expected.sort((a, b) => b.createdAtMs - a.createdAtMs);

    // /full embeds the first page + total count.
    const fullRes = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(fullRes.status).toBe(200);
    expect(fullRes.body.emailAttemptsTotal).toBe(TOTAL);
    expect(fullRes.body.emailAttemptsPageSize).toBe(50);
    expect(Array.isArray(fullRes.body.emailAttempts)).toBe(true);
    expect(fullRes.body.emailAttempts).toHaveLength(50);
    const firstPageIds = fullRes.body.emailAttempts.map((a: { id: number }) => a.id);
    expect(firstPageIds).toEqual(expected.slice(0, 50).map((e) => e.id));

    // /email-attempts paging — second page should pick up where /full left off.
    const pageRes = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=50&limit=20`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(pageRes.status).toBe(200);
    expect(pageRes.body.total).toBe(TOTAL);
    expect(pageRes.body.offset).toBe(50);
    expect(pageRes.body.limit).toBe(20);
    expect(pageRes.body.hasMore).toBe(false);
    expect(pageRes.body.attempts).toHaveLength(10);
    const secondPageIds = pageRes.body.attempts.map((a: { id: number }) => a.id);
    expect(secondPageIds).toEqual(expected.slice(50, 60).map((e) => e.id));

    // hasMore=true when more rows remain after the requested page.
    const partialRes = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=0&limit=20`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(partialRes.status).toBe(200);
    expect(partialRes.body.attempts).toHaveLength(20);
    expect(partialRes.body.hasMore).toBe(true);
    expect(partialRes.body.total).toBe(TOTAL);
  });

  it("classifies older attempts on a second page using full history", async () => {
    // A confirmed history row matches an old attempt; the most recent 50
    // attempts are all unrelated. Without classifying across pages, the older
    // attempt would be misclassified as abandoned.
    await resetAttempts();

    const HOUR = 60 * 60 * 1000;
    const baseTime = Date.now() - 80 * 24 * HOUR;

    // Seed 55 dummy attempts (older than the confirmed one) — all unrelated.
    for (let i = 0; i < 55; i++) {
      const [row] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail: `noise-${i}@example.test`,
          expiresAt: new Date(baseTime + i * HOUR + 30 * 60 * 1000),
        })
        .returning({ id: emailChangeAttemptsTable.id });
      await backdateAttempt(row.id, new Date(baseTime + i * HOUR));
    }

    // The confirmed attempt is older than all of the noise rows — it lands on
    // page 2 (offset=50). Its matching history row exists.
    const confirmedTarget = "confirmed-paged-target@example.test";
    const confirmedAttemptCreated = new Date(baseTime - 5 * HOUR);
    const confirmedAt = new Date(baseTime - 4 * HOUR);
    const [confirmedAttempt] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: confirmedTarget,
        expiresAt: new Date(baseTime - 1 * HOUR),
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(confirmedAttempt.id, confirmedAttemptCreated);
    await db.insert(emailChangeHistoryTable).values({
      userId: member.id,
      oldEmail: member.email,
      newEmail: confirmedTarget,
      changedAt: confirmedAt,
    });

    const pageRes = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=50&limit=20`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(pageRes.status).toBe(200);
    expect(pageRes.body.total).toBe(56);
    const found = pageRes.body.attempts.find(
      (a: { id: number }) => a.id === confirmedAttempt.id,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe("confirmed");
    expect(found.confirmedAt).toBe(confirmedAt.toISOString());
  });

  it("rejects invalid limit/offset on /email-attempts", async () => {
    await resetAttempts();

    const badLimit = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?limit=0`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(badLimit.status).toBe(400);

    const badOffset = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=-1`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(badOffset.status).toBe(400);

    const nonNumeric = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?limit=abc`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(nonNumeric.status).toBe(400);
  });

  it("caps /email-attempts limit at the documented max", async () => {
    await resetAttempts();
    const res = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?limit=10000`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(100);
  });

  it("/email-attempts requires members:view permission", async () => {
    const passwordHash = await bcrypt.hash("pw", 4);
    const [memberOnly] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-pageguard@example.test`,
        name: "Page Guard",
        passwordHash,
        role: "member",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    seededUserIds.push(memberOnly.id);

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts`)
      .set("Cookie", signCookie(memberOnly.id, memberOnly.email));
    expect(res.status).toBe(403);
  });

  it("classifies admin-cancelled attempts and exposes cancelledBy admin info", async () => {
    await resetAttempts();

    const now = Date.now();
    const HOUR = 60 * 60 * 1000;

    // Admin who did the cancellation.
    const passwordHash = await bcrypt.hash("pw", 4);
    const [adminRow] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-cancel-admin@example.test`,
        name: "Cancel Admin",
        passwordHash,
        role: "super_admin",
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(adminRow.id);

    // 1) Admin-cancelled attempt: cancelled_at + cancelled_by_admin_id set.
    //    Even though its expiresAt is still in the future, the status must
    //    surface as cancelled_by_admin so support staff can tell why it died.
    const cancelledTarget = "cancelled-target@example.test";
    const cancelledExpires = new Date(now + 6 * HOUR);
    const cancelledAt = new Date(now - 1 * HOUR);
    const [cancelledRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: cancelledTarget,
        expiresAt: cancelledExpires,
        cancelledAt,
        cancelledByAdminId: adminRow.id,
      })
      .returning({ id: emailChangeAttemptsTable.id });

    // 2) Cancelled attempt whose admin user has since been deleted — the
    //    join must still classify it as cancelled_by_admin and the row's
    //    cancelledByAdmin* fields just come back null.
    const orphanTarget = "orphan-cancelled@example.test";
    const [orphanRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: orphanTarget,
        expiresAt: new Date(now + 8 * HOUR),
        cancelledAt: new Date(now - 30 * 60 * 1000),
        cancelledByAdminId: null,
      })
      .returning({ id: emailChangeAttemptsTable.id });

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    const attempts: Array<{
      id: number;
      status: string;
      cancelledAt: string | null;
      cancelledByAdminId: number | null;
      cancelledByAdminName: string | null;
      cancelledByAdminEmail: string | null;
    }> = res.body.emailAttempts;

    const cancelled = attempts.find((a) => a.id === cancelledRow.id);
    expect(cancelled?.status).toBe("cancelled_by_admin");
    expect(cancelled?.cancelledAt).toBeTruthy();
    expect(cancelled?.cancelledByAdminId).toBe(adminRow.id);
    expect(cancelled?.cancelledByAdminName).toBe("Cancel Admin");
    expect(cancelled?.cancelledByAdminEmail).toBe(`${TAG}-cancel-admin@example.test`);

    const orphan = attempts.find((a) => a.id === orphanRow.id);
    expect(orphan?.status).toBe("cancelled_by_admin");
    expect(orphan?.cancelledByAdminId).toBeNull();
    expect(orphan?.cancelledByAdminName).toBeNull();
  });

  it("requires members:view permission", async () => {
    const passwordHash = await bcrypt.hash("pw", 4);
    const [memberOnly] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-noaccess@example.test`,
        name: "No Access",
        passwordHash,
        role: "member",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    seededUserIds.push(memberOnly.id);

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(memberOnly.id, memberOnly.email));

    expect(res.status).toBe(403);
  });
});
