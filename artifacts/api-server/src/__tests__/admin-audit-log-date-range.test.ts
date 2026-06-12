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
const TEST_TAG = `audit-daterange-${randomUUID().slice(0, 8)}`;
const ACTION_TYPE = `test_daterange_${TEST_TAG.replace(/-/g, "_")}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];

// Three rows on three consecutive UTC days. We deliberately put a row late
// in the day (23:30Z) on the end day to prove the end boundary is inclusive
// of the *whole* day when the client sends a bare "YYYY-MM-DD".
const ROW_JUN_10 = new Date("2026-06-10T08:00:00.000Z");
const ROW_JUN_11 = new Date("2026-06-11T12:00:00.000Z");
const ROW_JUN_12_LATE = new Date("2026-06-12T23:30:00.000Z");

let idJun10 = 0;
let idJun11 = 0;
let idJun12 = 0;

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Audit Date Range Test Admin",
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

  const inserted = await db
    .insert(auditLogTable)
    .values([
      { actionType: ACTION_TYPE, entityType: "queue", description: "jun 10", createdAt: ROW_JUN_10 },
      { actionType: ACTION_TYPE, entityType: "queue", description: "jun 11", createdAt: ROW_JUN_11 },
      { actionType: ACTION_TYPE, entityType: "queue", description: "jun 12 late", createdAt: ROW_JUN_12_LATE },
    ])
    .returning({ id: auditLogTable.id, createdAt: auditLogTable.createdAt });
  for (const r of inserted) {
    seededAuditIds.push(r.id);
    const t = new Date(r.createdAt as Date).getTime();
    if (t === ROW_JUN_10.getTime()) idJun10 = r.id;
    else if (t === ROW_JUN_11.getTime()) idJun11 = r.id;
    else if (t === ROW_JUN_12_LATE.getTime()) idJun12 = r.id;
  }
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function readIds(query: Record<string, string>): Promise<number[]> {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType: ACTION_TYPE, ...query })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return (res.body.logs as Array<{ id: number }>).map((r) => r.id);
}

describe("/admin/audit-log date-range filter", () => {
  it("startDate excludes rows strictly before the start day", async () => {
    const ids = await readIds({ startDate: "2026-06-11" });
    expect(ids).toContain(idJun11);
    expect(ids).toContain(idJun12);
    expect(ids).not.toContain(idJun10);
  });

  it("endDate (date-only) is inclusive of the entire end day", async () => {
    // The Jun 12 row is at 23:30Z; a naive `new Date('2026-06-12')` ceiling
    // (UTC midnight) would drop it. The end boundary must cover the whole day.
    const ids = await readIds({ endDate: "2026-06-12" });
    expect(ids).toContain(idJun12);
    expect(ids).toContain(idJun11);
    expect(ids).toContain(idJun10);
  });

  it("endDate excludes rows after the end day", async () => {
    const ids = await readIds({ endDate: "2026-06-11" });
    expect(ids).toContain(idJun10);
    expect(ids).toContain(idJun11);
    expect(ids).not.toContain(idJun12);
  });

  it("start+end together narrow to the window inclusively", async () => {
    const ids = await readIds({ startDate: "2026-06-11", endDate: "2026-06-12" });
    expect(ids).toContain(idJun11);
    expect(ids).toContain(idJun12);
    expect(ids).not.toContain(idJun10);
  });

  it("export honors the same inclusive date range", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType: ACTION_TYPE, startDate: "2026-06-11", endDate: "2026-06-12", format: "csv" })
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (chunk) => (data += chunk));
        r.on("end", () => cb(null, data));
      });
    expect(res.status).toBe(200);
    const csv = res.body as string;
    expect(csv).toContain(`${idJun11},`);
    expect(csv).toContain(`${idJun12},`);
    expect(csv).not.toContain(`${idJun10},`);
  });
});
