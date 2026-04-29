import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-cursor-${randomUUID().slice(0, 8)}`;
const ACTION_TYPE = `test_cursor_${TEST_TAG.replace(/-/g, "_")}`;
const PAGE_SIZE = 20;
const TOTAL_ROWS = 73; // intentionally not a multiple of PAGE_SIZE

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];
let newestFirstIds: number[] = [];

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Audit Cursor Test Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(admin.id);

  const token = jwt.sign({ userId: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;

  const base = Date.now() - 1000 * 60 * 60;
  // Mix in a couple of rows that share a createdAt so the secondary id sort
  // is exercised by the cursor compare predicate.
  const rows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    actionType: ACTION_TYPE,
    entityType: "queue",
    description: `seeded row ${i}`,
    metadata: { seq: i },
    // Two rows with the same createdAt at positions 30 and 31:
    createdAt: new Date(base + (i === 31 ? 30 : i)),
  }));
  const inserted = await db.insert(auditLogTable).values(rows).returning({ id: auditLogTable.id });
  seededAuditIds.push(...inserted.map((r) => r.id));
  // Reverse for newest-first order — but at the duplicate-createdAt
  // boundary, larger id wins under (createdAt desc, id desc), which lines
  // up with insertion order anyway since serial ids are increasing.
  newestFirstIds = [...inserted.map((r) => r.id)].reverse();
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function fetchPage(query: Record<string, string | number>) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType: ACTION_TYPE, ...query })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body as {
    logs: Array<{ id: number }>;
    pagination: { page: number | null; limit: number; total: number | null; totalPages: number | null };
    cursors: { next: string | null; prev: string | null };
  };
}

describe("/admin/audit-log cursor pagination", () => {
  it("walks every row exactly once when paging older with the next cursor", async () => {
    const seen: number[] = [];
    let cursor: string | null | undefined = undefined;
    let direction: "forward" | "backward" = "forward";
    let safety = 100;
    do {
      const body: any = await fetchPage({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor, direction } : {}),
      });
      for (const row of body.logs) seen.push(row.id);
      cursor = body.cursors.next;
      direction = "forward";
    } while (cursor && --safety > 0);
    expect(safety).toBeGreaterThan(0);
    expect(seen).toEqual(newestFirstIds);
  });

  it("walks back to the newest page when paging with the prev cursor", async () => {
    // First, hop forward two pages to get a deep cursor.
    const first = await fetchPage({ limit: PAGE_SIZE });
    expect(first.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(first.cursors.prev).toBeNull();

    const second = await fetchPage({ limit: PAGE_SIZE, cursor: first.cursors.next!, direction: "forward" });
    expect(second.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(PAGE_SIZE, PAGE_SIZE * 2));
    expect(second.cursors.prev).toBeTruthy();

    const third = await fetchPage({ limit: PAGE_SIZE, cursor: second.cursors.next!, direction: "forward" });
    expect(third.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(PAGE_SIZE * 2, PAGE_SIZE * 3));

    // Now walk backward from the third page using its prev cursor — we
    // should land on the second page's contents.
    const backToSecond = await fetchPage({ limit: PAGE_SIZE, cursor: third.cursors.prev!, direction: "backward" });
    expect(backToSecond.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(PAGE_SIZE, PAGE_SIZE * 2));
    expect(backToSecond.cursors.prev).toBeTruthy();
    expect(backToSecond.cursors.next).toBeTruthy();

    const backToFirst = await fetchPage({ limit: PAGE_SIZE, cursor: backToSecond.cursors.prev!, direction: "backward" });
    expect(backToFirst.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(backToFirst.cursors.prev).toBeNull();
  });

  it("clears next when the last older page is reached", async () => {
    let cursor: string | null = null;
    let last: any = null;
    let safety = 100;
    do {
      last = await fetchPage({
        limit: PAGE_SIZE,
        ...(cursor ? { cursor, direction: "forward" } : {}),
      });
      cursor = last.cursors.next;
    } while (cursor && --safety > 0);
    // Last page contains the trailing slice (TOTAL_ROWS % PAGE_SIZE rows).
    const tailSize = TOTAL_ROWS % PAGE_SIZE === 0 ? PAGE_SIZE : TOTAL_ROWS % PAGE_SIZE;
    expect(last.logs.map((l: any) => l.id)).toEqual(newestFirstIds.slice(-tailSize));
    expect(last.cursors.next).toBeNull();
  });

  it("returns a 200 with empty results when given a malformed cursor", async () => {
    const body = await fetchPage({ limit: PAGE_SIZE, cursor: "not-real-base64!!" });
    // Malformed cursors are silently ignored — the API falls back to the
    // newest-first default slice instead of erroring out.
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
  });

  it("legacy ?page= still works and returns a total + page-aware cursors", async () => {
    const body = await fetchPage({ limit: PAGE_SIZE, page: 2 });
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.total).toBe(TOTAL_ROWS);
    expect(body.pagination.totalPages).toBe(Math.ceil(TOTAL_ROWS / PAGE_SIZE));
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(PAGE_SIZE, PAGE_SIZE * 2));
    // Both navigation cursors populated for a middle legacy page.
    expect(body.cursors.next).toBeTruthy();
    expect(body.cursors.prev).toBeTruthy();
  });
});
