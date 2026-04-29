import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

// This test reproduces the keyset-precision bug that the previous ms-only
// cursor exhibited at sub-millisecond `created_at` boundaries.
//
// audit_log.created_at is `timestamptz` and Postgres stores microseconds.
// JS Date only carries milliseconds, so a cursor that encodes the anchor's
// timestamp as `Date.getTime()` silently truncates the µs digits. When two
// rows share the same ms-truncated timestamp but differ in microseconds
// (here, ...123456 vs ...123789), a forward page whose anchor is one of
// those rows would emit `created_at = '...123'` in the equality branch and
// fail to match either µs row — both would vanish from the page sequence.
//
// The seeded layout below straddles a page boundary (page size 5, ten rows
// total) with three rows sharing a microsecond-tier timestamp at positions
// 4, 5, 6 (1-indexed, newest-first). The middle row of that triple is the
// last row on page 1, so a buggy paginator skips its µs siblings on the
// jump to page 2.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-us-${randomUUID().slice(0, 8)}`;
const ACTION_TYPE = `test_us_cursor_${TEST_TAG.replace(/-/g, "_")}`;
const PAGE_SIZE = 5;
const TOTAL_ROWS = 10;

// Strictly decreasing timestamps — newest first — so that insertion order
// also gives us the (created_at desc, id desc) display order. The three
// boundary entries (indices 4, 5, 6) all collapse to the same millisecond
// (`...123ms`) when round-tripped through a JS Date but carry distinct
// microsecond values in Postgres. Indices 4 and 5 straddle the page-1 /
// page-2 split (page size 5) — exactly the spot where a ms-only cursor
// would silently skip the page-2 rows that share the boundary millisecond.
const BASE_ISO = "2026-01-15T12:34:56";
const TIMESTAMPS = [
  `${BASE_ISO}.200000Z`, // 0 — newest
  `${BASE_ISO}.190000Z`, // 1
  `${BASE_ISO}.180000Z`, // 2
  `${BASE_ISO}.170000Z`, // 3
  // Boundary triple: all three round-trip through Date(...).getTime() to
  // ...123ms (their µs digits are < 500 so even Math.round drops to 123)
  // while remaining distinct in Postgres.
  `${BASE_ISO}.123400Z`, // 4 — page 1 last row (anchor for next page)
  `${BASE_ISO}.123200Z`, // 5 — page 2 first row (would be skipped by buggy cursor)
  `${BASE_ISO}.123100Z`, // 6 — page 2 second row (would also be skipped)
  `${BASE_ISO}.110000Z`, // 7
  `${BASE_ISO}.100000Z`, // 8
  `${BASE_ISO}.050000Z`, // 9 — oldest
];

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
      name: "Audit µs Cursor Admin",
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

  // Insert rows in newest-first order so id and created_at line up — the
  // test then asserts that the (created_at desc, id desc) walk visits each
  // row exactly once. We seed `created_at` directly through Drizzle's
  // generated insert path first (with placeholder `now()` defaults) then
  // overwrite each row with a microsecond-precision timestamp via raw SQL,
  // because the JS driver can only bind a Date with ms resolution.
  for (let i = 0; i < TOTAL_ROWS; i++) {
    const [inserted] = await db
      .insert(auditLogTable)
      .values({
        actionType: ACTION_TYPE,
        entityType: "queue",
        description: `µs row ${i}`,
        metadata: { seq: i },
      })
      .returning({ id: auditLogTable.id });
    seededAuditIds.push(inserted.id);
    await db.execute(
      sql`UPDATE audit_log SET created_at = ${TIMESTAMPS[i]}::timestamptz WHERE id = ${inserted.id}`,
    );
  }

  newestFirstIds = [...seededAuditIds];

  // Sanity check: confirm Postgres actually retained the µs component for
  // the boundary triple. If this fails the rest of the test isn't proving
  // anything — surface that loudly instead of asserting a false negative.
  const probe = await db
    .select({ id: auditLogTable.id, ts: sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
    .from(auditLogTable)
    .where(inArray(auditLogTable.id, seededAuditIds.slice(4, 7)));
  const tsValues = probe.map((r) => r.ts).sort();
  expect(tsValues).toEqual([
    `${BASE_ISO}.123100Z`,
    `${BASE_ISO}.123200Z`,
    `${BASE_ISO}.123400Z`,
  ]);
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
    logs: Array<{ id: number; created_at: string }>;
    cursors: { next: string | null; prev: string | null };
  };
}

describe("/admin/audit-log keyset cursor at the microsecond boundary", () => {
  it("keeps walking older without dropping rows that share a sub-ms created_at across the page boundary", async () => {
    // Page 1 lands on rows 0..4 (newest-first). Row 4 is the boundary
    // anchor that previously truncated to ms-precision, so the buggy
    // cursor would skip rows 5 and 6 on the next page.
    const page1 = await fetchPage({ limit: PAGE_SIZE });
    expect(page1.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
    expect(page1.cursors.next).toBeTruthy();

    const page2 = await fetchPage({ limit: PAGE_SIZE, cursor: page1.cursors.next!, direction: "forward" });
    // Page 2 must contain rows 5..9 in order — neither µs sibling of the
    // boundary triple may be skipped.
    expect(page2.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(PAGE_SIZE));

    // And the natural exhaustion signal must fire (no further older page).
    expect(page2.cursors.next).toBeNull();

    // Walking the entire forward sequence visits every seeded row exactly
    // once, in newest-first order.
    const seen: number[] = [...page1.logs.map((l) => l.id), ...page2.logs.map((l) => l.id)];
    expect(seen).toEqual(newestFirstIds);
  });

  it("keeps walking newer without dropping the µs siblings when paging back", async () => {
    // Hop forward to page 2 first to obtain a deep cursor, then walk back
    // to page 1 via the prev cursor. The boundary triple straddles the
    // page split, so a buggy backward walk would also skip the µs siblings
    // when emitting the equality branch with a truncated anchor.
    const page1 = await fetchPage({ limit: PAGE_SIZE });
    const page2 = await fetchPage({ limit: PAGE_SIZE, cursor: page1.cursors.next!, direction: "forward" });
    expect(page2.cursors.prev).toBeTruthy();

    const back = await fetchPage({ limit: PAGE_SIZE, cursor: page2.cursors.prev!, direction: "backward" });
    expect(back.logs.map((l) => l.id)).toEqual(newestFirstIds.slice(0, PAGE_SIZE));
  });

  it("preserves the boundary triple when an `expand` deep-link anchors on the middle µs row", async () => {
    // Centre the window on the middle row of the boundary triple. The
    // surrounding window must include both µs siblings (the rows
    // immediately above and below the anchor) — a ms-truncated anchor in
    // the deep-link branch would have lost them just like the cursor
    // branch.
    const middle = newestFirstIds[5];
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: ACTION_TYPE, expand: middle, limit: PAGE_SIZE })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = (res.body.logs as Array<{ id: number }>).map((l) => l.id);
    // limit=5 -> half=2 newer rows + anchor + 2 older rows = ids 3..7.
    expect(ids).toEqual(newestFirstIds.slice(3, 8));
  });
});
