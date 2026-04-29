import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

// Verifies the bounded "N matching rows" count surfaced by /admin/audit-log
// on filter changes. The count is intentionally capped at the export hard
// cap via a `LIMIT cap+1` subquery so the first page render isn't blocked
// on a multi-million-row count(*); when the cap fires the response carries
// `totalIsApproximate: true` and the displayed total is the cap (treated
// as a lower bound by the UI).

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-cap-count-${randomUUID().slice(0, 8)}`;
const ACTION_TYPE = `test_cap_count_${TEST_TAG.replace(/-/g, "_")}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Audit Cap Count Test Admin",
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
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function seed(rowCount: number, actionType = ACTION_TYPE) {
  const base = Date.now() - 1000 * 60 * 60;
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    actionType,
    entityType: "queue",
    description: `seeded row ${i}`,
    metadata: { seq: i },
    createdAt: new Date(base + i),
  }));
  const inserted = await db.insert(auditLogTable).values(rows).returning({ id: auditLogTable.id });
  seededAuditIds.push(...inserted.map((r) => r.id));
}

async function fetchPage(query: Record<string, string | number>) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query(query)
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
    exportCap?: number;
    expand?: { targetId: number; found: boolean };
    jumpTo?: { requested: string; found: boolean };
  };
}

describe("/admin/audit-log bounded total count", () => {
  it("returns the exact total and totalIsApproximate=false when matching rows fit under the cap", async () => {
    const ROW_COUNT = 12;
    await seed(ROW_COUNT);

    // With the cap well above the seeded count, the LIMIT cap+1 subquery
    // counts every matching row exactly and the API returns the true total.
    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = "1000";
    try {
      const body = await fetchPage({ actionType: ACTION_TYPE, limit: 5 });
      expect(body.pagination.total).toBe(ROW_COUNT);
      expect(body.pagination.totalIsApproximate).toBe(false);
      expect(body.exportCap).toBe(1000);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });

  it("caps the total at the export hard cap and flags totalIsApproximate when the true total exceeds it", async () => {
    // Force the hard cap below the seeded count so we exercise the
    // cap-fired branch without seeding a million-row table. The same
    // seeded rows from the previous test still match this filter.
    const expectedSeededRows = seededAuditIds.length;
    expect(expectedSeededRows).toBeGreaterThanOrEqual(12);

    const CAP = 5;
    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const body = await fetchPage({ actionType: ACTION_TYPE, limit: 3 });
      // Capped: total clamps to the cap and the approximate flag fires so
      // the portal can render "More than 5 matching rows" instead of "5".
      expect(body.pagination.total).toBe(CAP);
      expect(body.pagination.totalIsApproximate).toBe(true);
      expect(body.exportCap).toBe(CAP);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });

  it("returns the exact total and totalIsApproximate=false when matching rows exactly equal the cap", async () => {
    // Edge case: when the matching set is exactly `cap` rows, the LIMIT
    // cap+1 subquery returns cap rows (not cap+1) so the cap must NOT
    // fire — the count is exact and the truncation warning stays off.
    const exactActionType = `${ACTION_TYPE}_exact`;
    const CAP = 7;
    await seed(CAP, exactActionType);

    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const body = await fetchPage({ actionType: exactActionType, limit: 3 });
      expect(body.pagination.total).toBe(CAP);
      expect(body.pagination.totalIsApproximate).toBe(false);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });

  it("applies the same cap on the jumpTo deep-jump branch", async () => {
    const CAP = 5;
    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const body = await fetchPage({
        actionType: ACTION_TYPE,
        limit: 3,
        jumpTo: new Date().toISOString(),
      });
      expect(body.jumpTo).toBeDefined();
      expect(body.pagination.total).toBe(CAP);
      expect(body.pagination.totalIsApproximate).toBe(true);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });

  it("applies the same cap on the expand=<id> deep-link branch", async () => {
    // Pick any seeded row and ask the API to deep-link to it. The branch
    // returns a window centered on the row plus the bounded count, which
    // must still cap when the true total exceeds the export hard cap.
    const targetId = seededAuditIds[0];
    expect(targetId).toBeGreaterThan(0);

    const CAP = 5;
    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const body = await fetchPage({ actionType: ACTION_TYPE, limit: 3, expand: targetId });
      expect(body.expand?.found).toBe(true);
      expect(body.pagination.total).toBe(CAP);
      expect(body.pagination.totalIsApproximate).toBe(true);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });
});
