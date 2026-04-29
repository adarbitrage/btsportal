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
  auditLogTable,
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
  await db
    .delete(auditLogTable)
    .where(inArray(auditLogTable.actorId, seededUserIds));
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
    .delete(auditLogTable)
    .where(
      sql`${auditLogTable.entityType} = 'user' AND ${auditLogTable.entityId} = ${String(member.id)}`,
    );
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

  it("surfaces admin-cancelled attempts older than the 90-day audit window so support can investigate stale tickets", async () => {
    // Admin-cancelled rows live for ~1 year (longer than the 90-day audit
    // window) specifically so support can look them up later. The member
    // detail endpoints must keep returning them past the 90-day mark
    // — both on /full's first-page slice and on the /email-attempts pager
    // — within the 365-day retention.
    await resetAttempts();

    const passwordHash = await bcrypt.hash("pw", 4);
    const [adminRow] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-stale-admin@example.test`,
        name: "Stale Admin",
        passwordHash,
        role: "super_admin",
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(adminRow.id);

    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const now = Date.now();

    // 1) An admin-cancelled attempt aged ~120 days — well past the 90-day
    //    audit cutoff but inside the 365-day admin-cancelled retention.
    const staleTarget = "stale-cancelled@example.test";
    const staleCreatedAt = new Date(now - 120 * DAY);
    const staleCancelledAt = new Date(now - 119 * DAY);
    const [staleRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: staleTarget,
        // expiresAt was originally in the past relative to "today" — we want
        // to confirm the cancelled status wins over the expired bucket even
        // for very old rows.
        expiresAt: new Date(now - 119 * DAY + 12 * HOUR),
        cancelledAt: staleCancelledAt,
        cancelledByAdminId: adminRow.id,
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(staleRow.id, staleCreatedAt);

    // 2) A near-the-edge admin-cancelled attempt aged ~360 days — still
    //    within the 365-day retention; should still be returned.
    const veryStaleTarget = "very-stale-cancelled@example.test";
    const veryStaleCreatedAt = new Date(now - 360 * DAY);
    const veryStaleCancelledAt = new Date(now - 359 * DAY);
    const [veryStaleRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: veryStaleTarget,
        expiresAt: new Date(now - 359 * DAY + 12 * HOUR),
        cancelledAt: veryStaleCancelledAt,
        cancelledByAdminId: adminRow.id,
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(veryStaleRow.id, veryStaleCreatedAt);

    // First-page slice on /full must still include both old cancelled rows
    // (no time filter — total of 2 fits under the page size).
    const fullRes = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(fullRes.status).toBe(200);
    expect(fullRes.body.emailAttemptsTotal).toBe(2);
    const fullAttempts: Array<{
      id: number;
      status: string;
      cancelledAt: string | null;
      cancelledByAdminName: string | null;
    }> = fullRes.body.emailAttempts;
    const staleOnFull = fullAttempts.find((a) => a.id === staleRow.id);
    const veryStaleOnFull = fullAttempts.find((a) => a.id === veryStaleRow.id);
    expect(staleOnFull?.status).toBe("cancelled_by_admin");
    expect(staleOnFull?.cancelledByAdminName).toBe("Stale Admin");
    expect(staleOnFull?.cancelledAt).toBe(staleCancelledAt.toISOString());
    expect(veryStaleOnFull?.status).toBe("cancelled_by_admin");
    expect(veryStaleOnFull?.cancelledByAdminName).toBe("Stale Admin");
    expect(veryStaleOnFull?.cancelledAt).toBe(veryStaleCancelledAt.toISOString());

    // Same rows must still come back via the dedicated pager — this is the
    // endpoint the "Show older" button uses, and it shouldn't filter on the
    // 90-day audit window either.
    const pagerRes = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=0&limit=50`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(pagerRes.status).toBe(200);
    expect(pagerRes.body.total).toBe(2);
    const pagerAttempts: Array<{ id: number; status: string }> = pagerRes.body.attempts;
    expect(pagerAttempts.find((a) => a.id === staleRow.id)?.status).toBe(
      "cancelled_by_admin",
    );
    expect(pagerAttempts.find((a) => a.id === veryStaleRow.id)?.status).toBe(
      "cancelled_by_admin",
    );
  });

  it("returns admin-cancelled rows on a later page when many newer attempts exist", async () => {
    // When the most recent 50 attempts are all unrelated noise, an older
    // admin-cancelled row still has to be reachable via the /email-attempts
    // pager — that's the whole point of the 1-year retention for support.
    await resetAttempts();

    const passwordHash = await bcrypt.hash("pw", 4);
    const [adminRow] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}-paged-cancel-admin@example.test`,
        name: "Paged Cancel Admin",
        passwordHash,
        role: "super_admin",
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(adminRow.id);

    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const baseTime = Date.now() - 200 * DAY;

    // Seed 55 newer noise attempts so page 1 is saturated with them.
    for (let i = 0; i < 55; i++) {
      const [row] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail: `noise-cancel-${i}@example.test`,
          expiresAt: new Date(baseTime + (i + 5) * HOUR + 30 * 60 * 1000),
        })
        .returning({ id: emailChangeAttemptsTable.id });
      await backdateAttempt(row.id, new Date(baseTime + (i + 5) * HOUR));
    }

    // The admin-cancelled row is older than every noise row, so it lands on
    // page 2.
    const cancelledTarget = "paged-cancelled@example.test";
    const cancelledCreatedAt = new Date(baseTime - 10 * HOUR);
    const cancelledAt = new Date(baseTime - 9 * HOUR);
    const [cancelledRow] = await db
      .insert(emailChangeAttemptsTable)
      .values({
        userId: member.id,
        newEmail: cancelledTarget,
        expiresAt: new Date(baseTime - 8 * HOUR),
        cancelledAt,
        cancelledByAdminId: adminRow.id,
      })
      .returning({ id: emailChangeAttemptsTable.id });
    await backdateAttempt(cancelledRow.id, cancelledCreatedAt);

    // The cancelled row is too old to make page 1 — it's the very last row
    // by createdAt DESC.
    const pageRes = await request(app)
      .get(`/api/admin/members/${member.id}/email-attempts?offset=50&limit=20`)
      .set("Cookie", signCookie(admin.id, admin.email));
    expect(pageRes.status).toBe(200);
    expect(pageRes.body.total).toBe(56);
    const found = pageRes.body.attempts.find(
      (a: { id: number }) => a.id === cancelledRow.id,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe("cancelled_by_admin");
    expect(found.cancelledAt).toBe(cancelledAt.toISOString());
    expect(found.cancelledByAdminId).toBe(adminRow.id);
    expect(found.cancelledByAdminName).toBe("Paged Cancel Admin");
  });

  describe("GET /admin/members/:id/email-attempts/:attemptId — detail panel", () => {
    it("returns the matching audit entry, next attempt, and confirmation for an abandoned attempt", async () => {
      await resetAttempts();

      const HOUR = 60 * 60 * 1000;
      const baseTime = Date.now() - 30 * 24 * HOUR;

      // Abandoned attempt — legacy row with no expiresAt, never confirmed,
      // followed by a separate successful change. The classifier surfaces
      // this as "abandoned" rather than "expired".
      const abandonedTarget = "abandoned-target@example.test";
      const [abandonedRow] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail: abandonedTarget,
          expiresAt: null,
        })
        .returning({ id: emailChangeAttemptsTable.id });
      await backdateAttempt(abandonedRow.id, new Date(baseTime));

      // Audit entry written inside the attempt's window (admin viewed/cancel etc.)
      await db.insert(auditLogTable).values({
        actorId: admin.id,
        actorEmail: admin.email,
        actionType: "view_member",
        entityType: "user",
        entityId: String(member.id),
        description: `Admin viewed member ${member.id}`,
        createdAt: new Date(baseTime + 30 * 60 * 1000),
      });

      // A subsequent (later) attempt that did confirm.
      const nextTarget = "follow-up-confirmed@example.test";
      const nextCreated = new Date(baseTime + 5 * HOUR);
      const [nextRow] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail: nextTarget,
          expiresAt: new Date(baseTime + 6 * HOUR),
        })
        .returning({ id: emailChangeAttemptsTable.id });
      await backdateAttempt(nextRow.id, nextCreated);

      // The history row that confirms the second attempt.
      await db.insert(emailChangeHistoryTable).values({
        userId: member.id,
        oldEmail: member.email,
        newEmail: nextTarget,
        changedAt: new Date(baseTime + 5.5 * HOUR),
      });

      const res = await request(app)
        .get(`/api/admin/members/${member.id}/email-attempts/${abandonedRow.id}`)
        .set("Cookie", signCookie(admin.id, admin.email));

      expect(res.status).toBe(200);
      expect(res.body.attempt.id).toBe(abandonedRow.id);
      expect(res.body.attempt.status).toBe("abandoned");
      expect(res.body.nextAttempt).toBeTruthy();
      expect(res.body.nextAttempt.id).toBe(nextRow.id);
      expect(res.body.nextAttempt.newEmail).toBe(nextTarget);
      expect(res.body.subsequentConfirmation).toBeTruthy();
      expect(res.body.subsequentConfirmation.newEmail).toBe(nextTarget);
      expect(res.body.auditEntries).toHaveLength(1);
      expect(res.body.auditEntries[0].actionType).toBe("view_member");
      // Audit entry that occurred AFTER the next attempt's window must be excluded.
      await db.insert(auditLogTable).values({
        actorId: admin.id,
        actorEmail: admin.email,
        actionType: "view_member",
        entityType: "user",
        entityId: String(member.id),
        description: `Later admin view`,
        createdAt: new Date(baseTime + 10 * HOUR),
      });
      const res2 = await request(app)
        .get(`/api/admin/members/${member.id}/email-attempts/${abandonedRow.id}`)
        .set("Cookie", signCookie(admin.id, admin.email));
      expect(res2.status).toBe(200);
      expect(res2.body.auditEntries).toHaveLength(1);
    });

    it("returns the matching confirmation history row for a confirmed attempt", async () => {
      await resetAttempts();

      const HOUR = 60 * 60 * 1000;
      const baseTime = Date.now() - 10 * 24 * HOUR;

      const confirmedTarget = "click-confirmed@example.test";
      const [confirmedRow] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: member.id,
          newEmail: confirmedTarget,
          expiresAt: new Date(baseTime + HOUR),
        })
        .returning({ id: emailChangeAttemptsTable.id });
      await backdateAttempt(confirmedRow.id, new Date(baseTime));

      await db.insert(emailChangeHistoryTable).values({
        userId: member.id,
        oldEmail: member.email,
        newEmail: confirmedTarget,
        changedAt: new Date(baseTime + 30 * 60 * 1000),
      });

      const res = await request(app)
        .get(`/api/admin/members/${member.id}/email-attempts/${confirmedRow.id}`)
        .set("Cookie", signCookie(admin.id, admin.email));

      expect(res.status).toBe(200);
      expect(res.body.attempt.status).toBe("confirmed");
      expect(res.body.nextAttempt).toBeNull();
      expect(res.body.subsequentConfirmation).toBeTruthy();
      expect(res.body.subsequentConfirmation.newEmail).toBe(confirmedTarget);
    });

    it("rejects an attempt that belongs to a different user", async () => {
      await resetAttempts();

      const passwordHash = await bcrypt.hash("pw", 4);
      const [otherMember] = await db
        .insert(usersTable)
        .values({
          email: `${TAG}-other@example.test`,
          name: "Other Member",
          passwordHash,
          role: "member",
        })
        .returning({ id: usersTable.id });
      seededUserIds.push(otherMember.id);

      const [otherAttempt] = await db
        .insert(emailChangeAttemptsTable)
        .values({
          userId: otherMember.id,
          newEmail: "other-attempt@example.test",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning({ id: emailChangeAttemptsTable.id });

      const res = await request(app)
        .get(`/api/admin/members/${member.id}/email-attempts/${otherAttempt.id}`)
        .set("Cookie", signCookie(admin.id, admin.email));

      expect(res.status).toBe(404);
    });
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
