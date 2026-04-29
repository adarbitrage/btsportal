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
// ordering by (createdAt desc, id desc). The seed loop walks oldest→newest, so
// reversing gives the same order the endpoint produces.
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
    pagination: { page: number; limit: number; total: number; totalPages: number };
  };
}

describe("/admin/audit-log expand=<id>", () => {
  it("defaults to page 1 with a deterministic newest-first order", async () => {
    const body = await fetchWith({ limit: PAGE_SIZE });
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(TOTAL_ROWS);
    expect(body.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
  });

  it("relocates to the page that actually contains the requested row", async () => {
    // Pick a row that lives on page 3 (positions 101..130 of the newest-first
    // list, 0-indexed positions 100..129). Position 110 ⇒ page 3.
    const targetIndex = 110;
    const targetId = newestFirstIds[targetIndex];

    const body = await fetchWith({ limit: PAGE_SIZE, expand: targetId });
    const expectedPage = Math.floor(targetIndex / PAGE_SIZE) + 1;
    expect(body.pagination.page).toBe(expectedPage);
    const ids = body.logs.map((l) => l.id);
    expect(ids).toContain(targetId);
    // And the slice matches the deterministic newest-first ordering.
    const start = (expectedPage - 1) * PAGE_SIZE;
    expect(ids).toEqual(newestFirstIds.slice(start, start + PAGE_SIZE));
  });

  it("ignores expand when the row does not match the supplied filters", async () => {
    // Same target id, but ask for a filter the seeded rows don't satisfy. The
    // API should leave the page param alone (default page 1) instead of
    // jumping to a phantom page.
    const targetId = newestFirstIds[110];
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: "definitely_not_a_real_action_type", expand: targetId, limit: PAGE_SIZE })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });

  it("ignores expand when the row id does not exist", async () => {
    // A wildly out-of-range id parses cleanly but never matches a row, so we
    // end up on the default page 1.
    const body = await fetchWith({ limit: PAGE_SIZE, expand: 2_147_483_640 });
    expect(body.pagination.page).toBe(1);

    // A non-numeric expand value is rejected outright by the regex guard.
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: ACTION_TYPE, expand: "not-an-id", limit: PAGE_SIZE })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
  });
});
