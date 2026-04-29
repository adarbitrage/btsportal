import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray, eq, and, gt } from "drizzle-orm";

// We mock @workspace/auth so we can flip the result of `members:pii` checks
// at runtime — the production matrix grants `members:pii` to every role
// that has `audit:view`, so without mocking there is no role configuration
// that exercises the redacted path through the live endpoint. Other
// permission checks (e.g. `audit:view` itself) keep their real behavior so
// the requirePermission middleware still authorizes the request normally.
const piiState = vi.hoisted(() => ({ allowPii: true }));

vi.mock("@workspace/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/auth")>("@workspace/auth");
  return {
    ...actual,
    hasPermission: (role: unknown, perm: unknown) => {
      if (perm === "members:pii" && !piiState.allowPii) return false;
      return actual.hasPermission(role as never, perm as never);
    },
  };
});

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-pii-${randomUUID().slice(0, 8)}`;
const RECIPIENT = `${TEST_TAG}@example.test`;

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
      name: "Audit PII Test Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(admin.id);

  const token = jwt.sign(
    { userId: admin.id, email: admin.email },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  adminCookie = `access_token=${token}`;

  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: "queue_fallback",
      entityType: "communication",
      description: `Email queue unavailable — direct-send fallback to ${RECIPIENT}`,
      metadata: {
        channel: "email",
        recipient: RECIPIENT,
        reason: "queue_unavailable",
      },
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(row.id);
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

async function fetchSeededRow() {
  const id = seededAuditIds[0];
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType: "queue_fallback", limit: "100" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  const match = (res.body.logs as Array<Record<string, unknown>>).find(
    (l) => l.id === id,
  );
  expect(match).toBeDefined();
  return match!;
}

async function fetchSeededExportJson() {
  const res = await request(app)
    .get("/api/admin/audit-log/export")
    .query({ actionType: "queue_fallback", format: "json" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  const id = seededAuditIds[0];
  const match = (res.body as Array<Record<string, unknown>>).find(
    (l) => l.id === id,
  );
  expect(match).toBeDefined();
  return match!;
}

async function fetchSeededExportCsv() {
  const res = await request(app)
    .get("/api/admin/audit-log/export")
    .query({ actionType: "queue_fallback", format: "csv" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.text;
}

describe("/admin/audit-log queue_fallback PII redaction", () => {
  it("returns the recipient verbatim when the viewer has members:pii", async () => {
    piiState.allowPii = true;

    const row = await fetchSeededRow();
    expect(row.description).toContain(RECIPIENT);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.recipient).toBe(RECIPIENT);
    expect(meta.channel).toBe("email");

    const exportRow = await fetchSeededExportJson();
    expect(exportRow.description).toContain(RECIPIENT);
    expect((exportRow.metadata as Record<string, unknown>).recipient).toBe(
      RECIPIENT,
    );

    const csv = await fetchSeededExportCsv();
    expect(csv).toContain(RECIPIENT);
  });

  it("redacts the recipient from description, metadata, and exports when the viewer lacks members:pii", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow();
    // Description rebuilt with "redacted" in place of the email.
    expect(row.description).toBe(
      "Email queue unavailable — direct-send fallback to redacted",
    );
    expect(row.description as string).not.toContain(RECIPIENT);

    // Metadata has recipient stripped but keeps non-PII fields so the row
    // can still be counted/filtered.
    const meta = row.metadata as Record<string, unknown>;
    expect("recipient" in meta).toBe(false);
    expect(meta.channel).toBe("email");
    expect(meta.reason).toBe("queue_unavailable");

    // JSON export is scrubbed identically.
    const exportRow = await fetchSeededExportJson();
    expect(exportRow.description as string).not.toContain(RECIPIENT);
    const exportMeta = exportRow.metadata as Record<string, unknown>;
    expect("recipient" in exportMeta).toBe(false);

    // CSV export embeds the description, so the recipient must not leak there
    // either.
    const csv = await fetchSeededExportCsv();
    expect(csv).not.toContain(RECIPIENT);
    expect(csv).toContain("redacted");
  });

  it("leaves the underlying audit row in the database unchanged so admins with PII access can still investigate", async () => {
    // Even after a redacted read above, the persisted row must still carry
    // the real recipient.
    const id = seededAuditIds[0];
    const [row] = await db
      .select()
      .from(auditLogTable)
      .where(and(eq(auditLogTable.id, id), gt(auditLogTable.id, 0)));
    expect(row).toBeDefined();
    expect(row.description).toContain(RECIPIENT);
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    expect(meta.recipient).toBe(RECIPIENT);
  });
});
