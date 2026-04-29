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
