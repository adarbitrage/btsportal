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
const TEST_TAG = `audit-jump-${randomUUID().slice(0, 8)}`;
// Tagging the seeded rows with a unique actionType keeps these tests from
// stepping on whatever's already in the dev audit log when the suite runs.
const ACTION_TYPE = `test_jump_${TEST_TAG.replace(/-/g, "_")}`;
const PAGE_SIZE = 50;
const TOTAL_ROWS = 130;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];
// Newest-first list of seeded ids and their createdAt timestamps. Mirrors
// the API's (createdAt desc, id desc) ordering so we can pick a target by
// position and assert against it.
let newestFirstIds: number[] = [];
let newestFirstTimestamps: number[] = [];

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Audit Jump Test Admin",
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

  // Seed rows with strictly increasing createdAt (1s apart so jumpTo can
  // land "between" rows without timestamp ties confusing the assertions).
  const base = Date.now() - 1000 * 60 * 60 * 24; // 24h ago, well clear of "now"
  const rows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    actionType: ACTION_TYPE,
    entityType: "queue",
    description: `seeded row ${i}`,
    metadata: { seq: i },
    createdAt: new Date(base + i * 1000),
  }));
  const inserted = await db.insert(auditLogTable).values(rows).returning({
    id: auditLogTable.id,
    createdAt: auditLogTable.createdAt,
  });
  seededAuditIds.push(...inserted.map((r) => r.id));
  // Insertion order matches creation order (oldest first); reverse for the
  // expected newest-first response order.
  const reversed = [...inserted].reverse();
  newestFirstIds = reversed.map((r) => r.id);
  newestFirstTimestamps = reversed.map((r) => (r.createdAt as Date).getTime());
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function fetchWith(query: Record<string, string | number>) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType: ACTION_TYPE, ...query })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body as {
    logs: Array<{ id: number; createdAt: string }>;
    pagination: { page: number | null; limit: number; total: number | null; totalPages: number | null };
    cursors: { next: string | null; prev: string | null };
    jumpTo?: { requested: string; found: boolean };
  };
}

describe("/admin/audit-log jumpTo=<iso>", () => {
  it("anchors the page at the first matching row at-or-before the chosen instant", async () => {
    // Pick a row well into the middle of the seeded set so there are plenty
    // of rows on both sides for the keyset window math to exercise.
    const targetIndex = 70;
    const targetTimestamp = newestFirstTimestamps[targetIndex];

    const body = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(targetTimestamp).toISOString(),
    });

    const ids = body.logs.map((l) => l.id);
    // The newest row in the page should be exactly the row at-or-before
    // the chosen instant — i.e. the target itself, since it lives at that
    // timestamp. The remaining rows are the next-older slice.
    expect(ids).toEqual(newestFirstIds.slice(targetIndex, targetIndex + PAGE_SIZE));
    expect(body.logs[0].id).toBe(newestFirstIds[targetIndex]);

    // Both directions should still have rows available — older rows below
    // (newest-first ordering) and newer rows above the jumped-to point.
    expect(body.cursors.next).toBeTruthy();
    expect(body.cursors.prev).toBeTruthy();

    // Total + jumpTo metadata is returned (matches first-page / expand path).
    expect(body.pagination.total).toBe(TOTAL_ROWS);
    expect(body.jumpTo?.found).toBe(true);
    expect(body.jumpTo?.requested).toBe(new Date(targetTimestamp).toISOString());
  });

  it("seeks to the first row strictly older when the chosen instant has no exact match", async () => {
    // Halfway between two seeded rows: there's no row at this instant, so
    // the API should land on the newer of the two surrounding rows (the
    // first row at-or-before the chosen instant).
    const newerIndex = 40;
    const olderIndex = 41;
    const halfway =
      (newestFirstTimestamps[newerIndex] + newestFirstTimestamps[olderIndex]) / 2;

    const body = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(halfway).toISOString(),
    });

    // Halfway < the row at newerIndex's timestamp, so that row is excluded.
    // The first matching row at-or-before is at olderIndex.
    expect(body.logs[0].id).toBe(newestFirstIds[olderIndex]);
    expect(body.logs.map((l) => l.id)).toEqual(
      newestFirstIds.slice(olderIndex, olderIndex + PAGE_SIZE),
    );
    expect(body.jumpTo?.found).toBe(true);
  });

  it("clamps the next cursor when the jump lands close to the oldest row", async () => {
    // Pick a row near the oldest end so the page tail extends past the
    // bottom of the seeded set; the next (older) cursor should be null
    // because there are no further matching rows.
    const targetIndex = TOTAL_ROWS - 5; // 5 rows from the oldest
    const targetTimestamp = newestFirstTimestamps[targetIndex];

    const body = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(targetTimestamp).toISOString(),
    });

    // Only 5 rows from this point onward, so the page is shorter than full.
    expect(body.logs).toHaveLength(TOTAL_ROWS - targetIndex);
    expect(body.cursors.next).toBeNull();
    // Newer rows still exist above the jumped-to point.
    expect(body.cursors.prev).toBeTruthy();
  });

  it("returns no rows but still surfaces total + a prev cursor when jumping before any matching row", async () => {
    // Earlier than every seeded row → empty window. The prev cursor should
    // still be set (synthetic anchor) so the user can step forward via the
    // Newer button instead of getting stuck.
    const beforeAll = newestFirstTimestamps[TOTAL_ROWS - 1] - 60_000;

    const body = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(beforeAll).toISOString(),
    });

    expect(body.logs).toEqual([]);
    expect(body.cursors.next).toBeNull();
    expect(body.cursors.prev).toBeTruthy();
    // Count for the active filter is still returned so the UI doesn't show
    // "Counting…" forever.
    expect(body.pagination.total).toBe(TOTAL_ROWS);
    expect(body.jumpTo?.found).toBe(false);
  });

  it("Newer/Older cursor paging from a jumped page navigates contiguously", async () => {
    // Jump to the middle, then click "Older" once and "Newer" once and
    // confirm we walk the seeded slice without gaps or duplicates.
    const targetIndex = 70;
    const targetTimestamp = newestFirstTimestamps[targetIndex];

    const jumped = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(targetTimestamp).toISOString(),
    });

    // Older page: rows past the bottom of the jumped page.
    const older = await fetchWith({
      limit: PAGE_SIZE,
      cursor: jumped.cursors.next!,
      direction: "forward",
    });
    const olderEnd = Math.min(targetIndex + PAGE_SIZE * 2, TOTAL_ROWS);
    expect(older.logs.map((l) => l.id)).toEqual(
      newestFirstIds.slice(targetIndex + PAGE_SIZE, olderEnd),
    );

    // Newer page: rows above the top of the jumped page.
    const newer = await fetchWith({
      limit: PAGE_SIZE,
      cursor: jumped.cursors.prev!,
      direction: "backward",
    });
    const newerStart = Math.max(targetIndex - PAGE_SIZE, 0);
    expect(newer.logs.map((l) => l.id)).toEqual(
      newestFirstIds.slice(newerStart, targetIndex),
    );
  });

  it("ignores invalid jumpTo values and returns the default newest-first page", async () => {
    const body = await fetchWith({ limit: PAGE_SIZE, jumpTo: "not-a-real-date" });
    // Falls through to the no-cursor first page → newest slice, no jumpTo
    // metadata in the response.
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(body.jumpTo).toBeUndefined();
  });

  it("respects other filters when seeking the jumped-to row", async () => {
    // Same jumpTo, but with an entityType that no seeded row matches —
    // result should be empty and the count zero (the seek still uses the
    // filtered (created_at, id) walk; it doesn't accidentally bypass it).
    const targetTimestamp = newestFirstTimestamps[20];
    const body = await fetchWith({
      limit: PAGE_SIZE,
      jumpTo: new Date(targetTimestamp).toISOString(),
      entityType: "definitely_not_an_entity_type",
    });
    expect(body.logs).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.jumpTo?.found).toBe(false);
  });
});
