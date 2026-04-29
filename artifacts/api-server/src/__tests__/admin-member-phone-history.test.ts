import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  phoneChangeHistoryTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

import { buildTestApp } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `admin-phone-history-${randomUUID().slice(0, 8)}`;

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
    .delete(phoneChangeHistoryTable)
    .where(inArray(phoneChangeHistoryTable.userId, seededUserIds));
  await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
});

beforeEach(async () => {
  await db
    .delete(phoneChangeHistoryTable)
    .where(eq(phoneChangeHistoryTable.userId, member.id));
});

async function backdateHistoryRow(id: number, changedAt: Date): Promise<void> {
  await db.execute(
    sql`UPDATE phone_change_history SET changed_at = ${changedAt} WHERE id = ${id}`,
  );
}

describe("GET /admin/members/:id/full — phoneHistory", () => {
  it("returns the phoneHistory array sorted newest-first", async () => {
    const HOUR = 60 * 60 * 1000;
    const now = Date.now();

    // Insert in arbitrary (non-sorted) order so we know the API is the one
    // sorting, not the insertion order.
    const middle = await db
      .insert(phoneChangeHistoryTable)
      .values({
        userId: member.id,
        oldPhone: "+15550000002",
        newPhone: "+15550000003",
      })
      .returning({ id: phoneChangeHistoryTable.id });
    await backdateHistoryRow(middle[0].id, new Date(now - 5 * HOUR));

    const oldest = await db
      .insert(phoneChangeHistoryTable)
      .values({
        userId: member.id,
        oldPhone: "+15550000001",
        newPhone: "+15550000002",
      })
      .returning({ id: phoneChangeHistoryTable.id });
    await backdateHistoryRow(oldest[0].id, new Date(now - 10 * HOUR));

    const newest = await db
      .insert(phoneChangeHistoryTable)
      .values({
        userId: member.id,
        oldPhone: "+15550000003",
        newPhone: "+15550000004",
      })
      .returning({ id: phoneChangeHistoryTable.id });
    await backdateHistoryRow(newest[0].id, new Date(now - 1 * HOUR));

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.phoneHistory)).toBe(true);
    const ids = res.body.phoneHistory.map((row: { id: number }) => row.id);
    expect(ids).toEqual([newest[0].id, middle[0].id, oldest[0].id]);

    // Each row should expose the fields the UI uses to render.
    const newestRow = res.body.phoneHistory[0];
    expect(newestRow.oldPhone).toBe("+15550000003");
    expect(newestRow.newPhone).toBe("+15550000004");
    expect(typeof newestRow.changedAt).toBe("string");
  });

  it("caps the phoneHistory array at 50 rows even when more exist", async () => {
    const HOUR = 60 * 60 * 1000;
    const baseTime = Date.now() - 200 * HOUR;
    const TOTAL = 60;

    const inserted: { id: number; createdAtMs: number }[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const [row] = await db
        .insert(phoneChangeHistoryTable)
        .values({
          userId: member.id,
          oldPhone: `+1555${i.toString().padStart(7, "0")}`,
          newPhone: `+1555${(i + 1).toString().padStart(7, "0")}`,
        })
        .returning({ id: phoneChangeHistoryTable.id });
      const changedAtMs = baseTime + i * HOUR;
      await backdateHistoryRow(row.id, new Date(changedAtMs));
      inserted.push({ id: row.id, createdAtMs: changedAtMs });
    }

    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.phoneHistory)).toBe(true);
    expect(res.body.phoneHistory).toHaveLength(50);

    // The 50 most recent rows (sorted newest-first) — i.e. indexes 59..10.
    const expected = inserted
      .slice()
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 50)
      .map((r) => r.id);
    const actual = res.body.phoneHistory.map((r: { id: number }) => r.id);
    expect(actual).toEqual(expected);
  });

  it("returns an empty phoneHistory array when the member has no phone changes", async () => {
    const res = await request(app)
      .get(`/api/admin/members/${member.id}/full`)
      .set("Cookie", signCookie(admin.id, admin.email));

    expect(res.status).toBe(200);
    expect(res.body.phoneHistory).toEqual([]);
  });
});
