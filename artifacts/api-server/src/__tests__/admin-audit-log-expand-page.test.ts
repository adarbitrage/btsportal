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
const TEST_TAG = `audit-expand-${randomUUID().slice(0, 8)}`;
// Tagging the seeded rows with a unique actionType keeps these tests from
// stepping on whatever's already in the dev audit log when the suite runs.
const ACTION_TYPE = `test_expand_${TEST_TAG.replace(/-/g, "_")}`;
const PAGE_SIZE = 50;
const TOTAL_ROWS = 130;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];
// Newest-first list of seeded ids, matching what the API should return when
// ordering by (createdAt desc, id desc). The seed loop walks oldest→newest,
// so reversing gives the same order the endpoint produces.
let newestFirstIds: number[] = [];

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Audit Expand Test Admin",
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

  // Seed rows with strictly increasing createdAt so the order is predictable
  // even if other tests inserted audit rows concurrently. Spacing by 1ms is
  // plenty for postgres timestamp precision.
  const base = Date.now() - 1000 * 60 * 60; // 1h ago, well clear of "now"
  const rows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    actionType: ACTION_TYPE,
    entityType: "queue",
    description: `seeded row ${i}`,
    metadata: { seq: i },
    createdAt: new Date(base + i),
  }));
  const inserted = await db.insert(auditLogTable).values(rows).returning({ id: auditLogTable.id });
  seededAuditIds.push(...inserted.map((r) => r.id));
  // Insertion order matches creation order (oldest first); reverse for the
  // expected newest-first response order.
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

async function fetchWith(query: Record<string, string | number>) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType: ACTION_TYPE, ...query })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body as {
    logs: Array<{ id: number }>;
    pagination: {
      page: number | null;
      limit: number;
      total: number | null;
      totalPages: number | null;
      totalIsApproximate?: boolean;
    };
    cursors: { next: string | null; prev: string | null };
    expand?: { targetId: number; found: boolean };
  };
}

describe("/admin/audit-log expand=<id>", () => {
  it("defaults to the newest page in cursor mode and includes a bounded match count", async () => {
    const body = await fetchWith({ limit: PAGE_SIZE });
    // Cursor-mode default: no legacy page/totalPages numbers, just the
    // newest slice and a forward cursor pointing at the next (older) page.
    expect(body.pagination.page).toBeNull();
    expect(body.pagination.totalPages).toBeNull();
    // The "N matching rows" header on the portal still needs a count, so
    // the first-page response carries it. With a small seeded set the
    // bounded count returns the exact number and `totalIsApproximate` is
    // false (the cap-fired path is exercised in the dedicated test).
    expect(body.pagination.total).toBe(TOTAL_ROWS);
    expect(body.pagination.totalIsApproximate).toBe(false);
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(body.cursors.next).toBeTruthy();
    expect(body.cursors.prev).toBeNull();
  });

  it("returns a window centered on the requested expand row", async () => {
    // Pick a row well into the middle of the seeded set so there are plenty
    // of rows on both sides for the "centered window" math to exercise.
    const targetIndex = 70;
    const targetId = newestFirstIds[targetIndex];

    const body = await fetchWith({ limit: PAGE_SIZE, expand: targetId });
    const ids = body.logs.map((l) => l.id);
    expect(ids).toContain(targetId);
    expect(body.logs).toHaveLength(PAGE_SIZE);

    // Target sits at the boundary between the newer half and older half.
    // With limit=50 → 25 newer rows precede the target, then target +
    // 24 older rows.
    const targetPos = ids.indexOf(targetId);
    expect(targetPos).toBe(Math.floor(PAGE_SIZE / 2));

    // The slice should be a contiguous newest-first window of the seeded
    // ids that contains the target id.
    const startIndex = targetIndex - targetPos;
    expect(ids).toEqual(newestFirstIds.slice(startIndex, startIndex + PAGE_SIZE));

    // Both directions should still have rows available (next + prev set).
    expect(body.cursors.next).toBeTruthy();
    expect(body.cursors.prev).toBeTruthy();
    expect(body.expand).toEqual({ targetId, found: true });
  });

  it("clamps the window when expand lands close to the newest row", async () => {
    // Row at index 5 has only 5 newer rows ahead of it, so the window
    // shifts: the newer half is shorter, but the page should still be full.
    const targetIndex = 5;
    const targetId = newestFirstIds[targetIndex];

    const body = await fetchWith({ limit: PAGE_SIZE, expand: targetId });
    const ids = body.logs.map((l) => l.id);
    expect(ids).toContain(targetId);
    expect(body.logs).toHaveLength(PAGE_SIZE);

    // Target should be at position 5 (only 5 newer rows fit before it).
    expect(ids.indexOf(targetId)).toBe(targetIndex);
    expect(ids).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    // No newer rows past the top → prev cursor is null.
    expect(body.cursors.prev).toBeNull();
    expect(body.cursors.next).toBeTruthy();
  });

  it("ignores expand when the row does not match the supplied filters", async () => {
    // Same target id, but ask for a filter the seeded rows don't satisfy.
    // The API should fall back to the default newest-first slice instead of
    // jumping to a phantom window.
    const targetId = newestFirstIds[110];
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: "definitely_not_a_real_action_type", expand: targetId, limit: PAGE_SIZE })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    // No rows match the bogus actionType → empty page, no cursors.
    expect(res.body.logs).toEqual([]);
    expect(res.body.cursors).toEqual({ next: null, prev: null });
    expect(res.body.expand).toBeUndefined();
  });

  it("ignores expand when the row id does not exist", async () => {
    // A wildly out-of-range id parses cleanly but never matches a row, so
    // we end up on the default newest-first slice.
    const body = await fetchWith({ limit: PAGE_SIZE, expand: 2_147_483_640 });
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(body.expand).toBeUndefined();

    // A non-numeric expand value is rejected outright by the regex guard.
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: ACTION_TYPE, expand: "not-an-id", limit: PAGE_SIZE })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.logs.map((l: any) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
  });
});
