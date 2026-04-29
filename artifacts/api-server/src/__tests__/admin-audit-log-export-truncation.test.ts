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
const TEST_TAG = `audit-export-stream-${randomUUID().slice(0, 8)}`;

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
      name: "Audit Export Streaming Admin",
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

describe("GET /admin/audit-log/export — streaming with no row cap", () => {
  it("reports accurate counts and includes every row for small queries", async () => {
    const actionType = `${TEST_TAG}-small`;
    await seedAuditRows(actionType, 25);

    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType, entityType: TEST_TAG, format: "csv" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.headers["x-audit-log-total-count"]).toBe("25");
    // The truncation/cap signals are gone now that the export is complete.
    // The redundant "returned count" header is gone too — clients should
    // treat a successful download as authoritative.
    expect(res.headers["x-audit-log-truncated"]).toBeUndefined();
    expect(res.headers["x-audit-log-export-cap"]).toBeUndefined();
    expect(res.headers["x-audit-log-returned-count"]).toBeUndefined();

    const exposed = res.headers["access-control-expose-headers"] || "";
    expect(exposed).toContain("X-Audit-Log-Total-Count");

    // Header line + 25 data rows, no trailing newline.
    const lines = res.text.split("\n");
    expect(lines).toHaveLength(26);
    expect(lines[0]).toBe(
      "id,actor_id,actor_email,action_type,entity_type,entity_id,description,ip_address,created_at",
    );
  });

  it("streams the full result set when the row count exceeds the legacy 10,000 cap", async () => {
    // Seed just over the old cap so we exercise the streaming path with
    // multiple internal batches (batch size is 1,000) and prove no row gets
    // dropped. We use a single big test (with both formats verified
    // separately below for correctness) to keep the seeding cost down.
    const actionType = `${TEST_TAG}-stream`;
    const ROW_COUNT = 10_050;
    await seedAuditRows(actionType, ROW_COUNT);

    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType, entityType: TEST_TAG, format: "json" })
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        // supertest's default JSON parser doesn't kick in here because the
        // response is streamed; assemble the body ourselves so the assertions
        // see the full payload.
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            callback(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            callback(err as Error, null);
          }
        });
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-audit-log-total-count"]).toBe(String(ROW_COUNT));
    expect(res.headers["x-audit-log-truncated"]).toBeUndefined();

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(ROW_COUNT);

    // Sanity check that the keyset pagination preserves the newest-first
    // ordering across batch boundaries — the largest entityId (last row
    // inserted) should be the first in the export.
    const ourRows = (res.body as Array<{ entityType: string; entityId: string }>)
      .filter((r) => r.entityType === TEST_TAG);
    expect(ourRows[0].entityId).toBe(String(ROW_COUNT - 1));

    // Spot-check the batch boundaries: the row at the end of the first
    // batch and the row at the start of the second batch must be present
    // and in the correct order.
    expect(ourRows[999].entityId).toBe(String(ROW_COUNT - 1 - 999));
    expect(ourRows[1000].entityId).toBe(String(ROW_COUNT - 1 - 1000));
  }, 120_000);
});
