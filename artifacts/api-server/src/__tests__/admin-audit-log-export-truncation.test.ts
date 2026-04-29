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

// supertest exposes the underlying http.IncomingMessage on `res.res`, but
// its bundled types don't surface either that field or the IncomingMessage
// `.trailers` property. Narrow to just the shape we need so the rest of
// the helper stays strongly typed without an `any` escape hatch.
type SupertestResponseWithRaw = request.Response & {
  res?: { trailers?: Record<string, string> };
};

// Helper: collect a streamed export body and pull the trailers off the
// underlying http.IncomingMessage. supertest's `res.headers` only exposes
// the leading headers; trailers (which is where we now report row counts
// and truncation) live on `res.trailers` and are only populated after the
// full body has been consumed.
async function streamingGet(query: Record<string, string>): Promise<{
  status: number;
  headers: Record<string, string>;
  trailers: Record<string, string>;
  body: Buffer;
}> {
  const res = (await request(app)
    .get("/api/admin/audit-log/export")
    .query(query)
    .set("Cookie", adminCookie)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    })) as SupertestResponseWithRaw;
  return {
    status: res.status,
    headers: res.headers as Record<string, string>,
    trailers: res.res?.trailers ?? {},
    body: res.body as Buffer,
  };
}

describe("GET /admin/audit-log/export — streaming with trailers", () => {
  it("streams every row for small queries and reports the count via trailer", async () => {
    const actionType = `${TEST_TAG}-small`;
    await seedAuditRows(actionType, 25);

    const res = await streamingGet({
      actionType,
      entityType: TEST_TAG,
      format: "csv",
    });

    expect(res.status).toBe(200);

    // The eager `count(*)` is gone; total-count header should not be set.
    expect(res.headers["x-audit-log-total-count"]).toBeUndefined();

    // Trailer-based reporting: returned-count is always present, truncated
    // only when the cap was hit.
    expect(res.headers["trailer"]).toContain("X-Audit-Log-Returned-Count");
    expect(res.headers["trailer"]).toContain("X-Audit-Log-Truncated");
    expect(res.trailers["x-audit-log-returned-count"]).toBe("25");
    expect(res.trailers["x-audit-log-truncated"]).toBeUndefined();

    const exposed = res.headers["access-control-expose-headers"] || "";
    expect(exposed).toContain("X-Audit-Log-Returned-Count");
    expect(exposed).toContain("X-Audit-Log-Truncated");

    // Header line + 25 data rows, no trailing newline.
    const lines = res.body.toString("utf8").split("\n");
    expect(lines).toHaveLength(26);
    expect(lines[0]).toBe(
      "id,actor_id,actor_email,action_type,entity_type,entity_id,description,ip_address,created_at",
    );
  });

  it("streams the full result set when the row count exceeds the legacy 10,000 cap", async () => {
    // Seed just over the old cap so we exercise the streaming path with
    // multiple internal batches (batch size is 1,000) and prove no row gets
    // dropped. The (created_at, id) microsecond keyset has to survive
    // crossing several batch boundaries here — sub-millisecond collisions
    // between rows inserted in the same `now()` tick would silently drop
    // rows under a millisecond-precision cursor.
    const actionType = `${TEST_TAG}-stream`;
    const ROW_COUNT = 10_050;
    await seedAuditRows(actionType, ROW_COUNT);

    const res = await streamingGet({
      actionType,
      entityType: TEST_TAG,
      format: "json",
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-audit-log-total-count"]).toBeUndefined();
    expect(res.trailers["x-audit-log-returned-count"]).toBe(String(ROW_COUNT));
    expect(res.trailers["x-audit-log-truncated"]).toBeUndefined();

    const body = JSON.parse(res.body.toString("utf8"));
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(ROW_COUNT);

    // Sanity check that the keyset pagination preserves the newest-first
    // ordering across batch boundaries — the largest entityId (last row
    // inserted) should be the first in the export.
    const ourRows = (body as Array<{ entityType: string; entityId: string }>)
      .filter((r) => r.entityType === TEST_TAG);
    expect(ourRows[0].entityId).toBe(String(ROW_COUNT - 1));

    // Spot-check the batch boundaries: the row at the end of the first
    // batch and the row at the start of the second batch must be present
    // and in the correct order. If the microsecond cursor were lossy we
    // would either skip rows here or duplicate them.
    expect(ourRows[999].entityId).toBe(String(ROW_COUNT - 1 - 999));
    expect(ourRows[1000].entityId).toBe(String(ROW_COUNT - 1 - 1000));

    // Every entityId from 0..ROW_COUNT-1 must appear exactly once. This
    // catches any keyset slip — duplicate or missing rows across batch
    // boundaries.
    const seen = new Set(ourRows.map((r) => r.entityId));
    expect(seen.size).toBe(ROW_COUNT);
  }, 120_000);

  it("reports truncation via the trailer when the hard cap is hit", async () => {
    // Seed a small number of rows and force the hard cap below that count
    // so we can prove the "more rows available" trailer fires without
    // having to seed a million-row table.
    const actionType = `${TEST_TAG}-cap`;
    const ROW_COUNT = 12;
    const CAP = 5;
    await seedAuditRows(actionType, ROW_COUNT);

    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const res = await streamingGet({
        actionType,
        entityType: TEST_TAG,
        format: "json",
      });

      expect(res.status).toBe(200);
      expect(res.trailers["x-audit-log-returned-count"]).toBe(String(CAP));
      expect(res.trailers["x-audit-log-truncated"]).toBe("true");

      const body = JSON.parse(res.body.toString("utf8"));
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(CAP);
      // Newest-first ordering: the cap should slice off the OLDEST rows,
      // leaving the most recently inserted CAP rows in the response.
      const ourRows = (body as Array<{ entityType: string; entityId: string }>)
        .filter((r) => r.entityType === TEST_TAG);
      expect(ourRows[0].entityId).toBe(String(ROW_COUNT - 1));
      expect(ourRows[CAP - 1].entityId).toBe(String(ROW_COUNT - CAP));
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });

  it("does not flag truncation when the row count exactly equals the cap", async () => {
    // Edge case: when the matching set is exactly `cap` rows, we must not
    // claim truncation — the peek-ahead row simply doesn't exist.
    const actionType = `${TEST_TAG}-exact-cap`;
    const CAP = 7;
    await seedAuditRows(actionType, CAP);

    const previousCap = process.env.AUDIT_LOG_EXPORT_HARD_CAP;
    process.env.AUDIT_LOG_EXPORT_HARD_CAP = String(CAP);
    try {
      const res = await streamingGet({
        actionType,
        entityType: TEST_TAG,
        format: "json",
      });

      expect(res.status).toBe(200);
      expect(res.trailers["x-audit-log-returned-count"]).toBe(String(CAP));
      expect(res.trailers["x-audit-log-truncated"]).toBeUndefined();

      const body = JSON.parse(res.body.toString("utf8"));
      expect(body).toHaveLength(CAP);
    } finally {
      if (previousCap === undefined) {
        delete process.env.AUDIT_LOG_EXPORT_HARD_CAP;
      } else {
        process.env.AUDIT_LOG_EXPORT_HARD_CAP = previousCap;
      }
    }
  });
});
