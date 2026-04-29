import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

// Happy-path coverage for the compliance_reviewer role through the live
// admin-panel router with a real seeded user (no @workspace/auth mock).
// If anyone ever grants `members:pii` to compliance_reviewer, this fails.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `compliance-reviewer-${randomUUID().slice(0, 8)}`;
const QUEUE_RECIPIENT = `${TEST_TAG}-queue@example.test`;
const IMPERSONATED_NAME = `Impersonated Member ${TEST_TAG}`;
const IMPERSONATED_EMAIL = `${TEST_TAG}-impersonated@example.test`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let reviewerCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];

let queueFallbackId = 0;
let impersonateId = 0;

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [reviewer] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-reviewer@example.test`,
      name: "Compliance Reviewer",
      passwordHash,
      role: "compliance_reviewer",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(reviewer.id);

  const token = jwt.sign(
    { userId: reviewer.id, email: reviewer.email },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  reviewerCookie = `access_token=${token}`;

  // queue_fallback (PII in description + metadata.recipient) and
  // impersonate_start (PII in description + changeDiff) — the two canary
  // action types from the task spec.
  const [queueRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "queue_fallback",
      entityType: "communication",
      description: `Email queue unavailable — direct-send fallback to ${QUEUE_RECIPIENT}`,
      metadata: {
        channel: "email",
        recipient: QUEUE_RECIPIENT,
        reason: "queue_unavailable",
      },
    })
    .returning({ id: auditLogTable.id });
  queueFallbackId = queueRow.id;
  seededAuditIds.push(queueRow.id);

  const [impersonateRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "impersonate_start",
      entityType: "user",
      entityId: "999999",
      description: `Admin started impersonating member ${IMPERSONATED_NAME} (${IMPERSONATED_EMAIL})`,
      changeDiff: {
        memberName: IMPERSONATED_NAME,
        memberEmail: IMPERSONATED_EMAIL,
      },
    })
    .returning({ id: auditLogTable.id });
  impersonateId = impersonateRow.id;
  seededAuditIds.push(impersonateRow.id);
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function fetchRow(id: number, actionType: string) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType, limit: "100" })
    .set("Cookie", reviewerCookie);
  expect(res.status).toBe(200);
  const match = (res.body.logs as Array<Record<string, unknown>>).find(
    (l) => l.id === id,
  );
  expect(match, `audit log row ${id} for ${actionType}`).toBeDefined();
  return match!;
}

describe("compliance_reviewer reads /admin/audit-log end-to-end", () => {
  it("can list audit-log rows (audit:view is in the production matrix)", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ limit: "10" })
      .set("Cookie", reviewerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it("redacts the recipient on a queue_fallback row (no members:pii in production)", async () => {
    const row = await fetchRow(queueFallbackId, "queue_fallback");
    expect(row.description).toBe(
      "Email queue unavailable — direct-send fallback to redacted",
    );
    expect(row.description as string).not.toContain(QUEUE_RECIPIENT);

    const meta = row.metadata as Record<string, unknown>;
    expect("recipient" in meta).toBe(false);
    expect(meta.channel).toBe("email");
    expect(meta.reason).toBe("queue_unavailable");
  });

  it("redacts member name and email on an impersonate_start row (no members:pii in production)", async () => {
    const row = await fetchRow(impersonateId, "impersonate_start");
    expect(row.description).toBe(
      "Admin started impersonating member redacted (redacted)",
    );
    expect(row.description as string).not.toContain(IMPERSONATED_NAME);
    expect(row.description as string).not.toContain(IMPERSONATED_EMAIL);

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(IMPERSONATED_NAME);
    expect(serialised).not.toContain(IMPERSONATED_EMAIL);
  });

  it("cannot read /admin/members (no members:view in the production matrix)", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: "1" })
      .set("Cookie", reviewerCookie);
    expect(res.status).toBe(403);
  });
});
