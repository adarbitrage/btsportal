import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { eq, gt, inArray, and, desc } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-export-trunc-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminId = 0;
let adminCookie = "";
let baselineAuditId = 0;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedAuditRows(actionType: string, count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    actorId: adminId,
    actorEmail: `${TEST_TAG}@example.test`,
    actionType,
    entityType: TEST_TAG,
    entityId: String(i),
    description: `seeded row ${i}`,
  }));
  // Bulk insert in chunks to avoid statement-size limits.
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(auditLogTable).values(rows.slice(i, i + chunkSize));
  }
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Audit Export Truncation Admin",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  adminId = admin.id;
  adminCookie = signCookie(admin.id, `${TEST_TAG}@example.test`);
});

afterAll(async () => {
  await db
    .delete(auditLogTable)
    .where(and(gt(auditLogTable.id, baselineAuditId), eq(auditLogTable.entityType, TEST_TAG)));
  if (adminId) {
    await db.delete(usersTable).where(inArray(usersTable.id, [adminId]));
  }
});

describe("GET /admin/audit-log/export — truncation reporting", () => {
  it("reports truncated=false and accurate counts when the cap is not exceeded", async () => {
    const actionType = `${TEST_TAG}-small`;
    await seedAuditRows(actionType, 25);

    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType, entityType: TEST_TAG, format: "csv" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.headers["x-audit-log-truncated"]).toBe("false");
    expect(res.headers["x-audit-log-total-count"]).toBe("25");
    expect(res.headers["x-audit-log-returned-count"]).toBe("25");
    expect(res.headers["x-audit-log-export-cap"]).toBe("10000");
    const exposed = res.headers["access-control-expose-headers"] || "";
    expect(exposed).toContain("X-Audit-Log-Truncated");
    expect(exposed).toContain("X-Audit-Log-Total-Count");
  });

  it("reports truncated=true with the real total when the cap is exceeded", async () => {
    const actionType = `${TEST_TAG}-big`;
    await seedAuditRows(actionType, 10001);

    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType, entityType: TEST_TAG, format: "json" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.headers["x-audit-log-truncated"]).toBe("true");
    expect(res.headers["x-audit-log-total-count"]).toBe("10001");
    expect(res.headers["x-audit-log-returned-count"]).toBe("10000");
    expect(res.headers["x-audit-log-export-cap"]).toBe("10000");
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(10000);
  }, 60_000);
});
