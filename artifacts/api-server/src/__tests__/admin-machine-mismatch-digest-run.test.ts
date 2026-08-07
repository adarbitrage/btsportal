/**
 * On-demand Machine mismatch digest run endpoint (task #2117).
 *
 * Verifies the POST /admin/machine-mismatch-digest/run endpoint:
 *  - admins can trigger a run and get the outcome + fresh status back,
 *  - the manual trigger is audit-logged with the outcome,
 *  - members are rejected by RBAC.
 *
 * Runs against the shared dev DB (same pattern as the other admin-*.test.ts
 * suites); the dev DB has no recent mismatched Machine orders so the run
 * outcome is a skip, which is fine — the endpoint contract is what's under
 * test here, the digest internals are covered by the lib suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { inArray, eq, and, gte } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mmd-run-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const startedAt = new Date();
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: "super_admin" | "member") {
  const email = `${TEST_TAG}-${role}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedUser("super_admin");
  const member = await seedUser("member");
  adminCookie = admin.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    // Remove the audit rows written by these test users, then the users.
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    // The digest run itself audits with a null actor; scope cleanup to rows
    // written during this test window with the digest entity type.
    await db
      .delete(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entityType, "machine_mismatch_digest"),
          gte(auditLogTable.createdAt, startedAt),
        ),
      );
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/machine-mismatch-digest/run", () => {
  it("rejects members", async () => {
    const res = await request(app)
      .post("/api/admin/machine-mismatch-digest/run")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("runs the digest on demand for an admin and audit-logs the manual trigger", async () => {
    const res = await request(app)
      .post("/api/admin/machine-mismatch-digest/run")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect([
      "sent",
      "skipped_no_mismatches",
      "skipped_no_recipient",
      "skipped_sendgrid_not_configured",
      "failed",
    ]).toContain(res.body.outcome);
    expect(res.body.status).toBeTruthy();
    expect(res.body.status.lastTrigger).toBe("manual");
    expect(res.body.status.lastAttempt).toBe(0);

    // The button-press audit row (actor = the admin).
    const rows = await db
      .select({
        actionType: auditLogTable.actionType,
        metadata: auditLogTable.metadata,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, "run_machine_mismatch_digest"),
          inArray(auditLogTable.actorId, seededUserIds),
        ),
      );
    expect(rows.length).toBe(1);
    const metadata = rows[0].metadata as Record<string, unknown>;
    expect(metadata.outcome).toBe(res.body.outcome);
  });
});
