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
const IMPERSONATE_NAME = `Impersonated Member ${TEST_TAG}`;
const IMPERSONATE_EMAIL = `${TEST_TAG}-impersonated@example.test`;
const PASSWORD_RESET_EMAIL = `${TEST_TAG}-pwreset@example.test`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];

interface SeededAuditIds {
  queueFallback: number;
  impersonate: number;
  passwordReset: number;
  legacyImpersonate: number;
  legacyQueueFallback: number;
  cancelEmailChange: number;
}

const LEGACY_NAME = `Legacy Member ${TEST_TAG}`;
const LEGACY_EMAIL = `${TEST_TAG}-legacy@example.test`;
const LEGACY_RECIPIENT = `${TEST_TAG}-legacy-recipient@example.test`;
const CANCEL_MEMBER_EMAIL = `${TEST_TAG}-cancel-current@example.test`;
const CANCEL_PENDING_EMAIL = `${TEST_TAG}-cancel-pending@example.test`;

let seededIds: SeededAuditIds;

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

  const [queueRow] = await db
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
  seededAuditIds.push(queueRow.id);

  const [impersonateRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "impersonate_start",
      entityType: "user",
      entityId: "999999",
      description: `Admin started impersonating member ${IMPERSONATE_NAME} (${IMPERSONATE_EMAIL})`,
      changeDiff: {
        memberName: IMPERSONATE_NAME,
        memberEmail: IMPERSONATE_EMAIL,
      },
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(impersonateRow.id);

  const [passwordResetRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "regenerate_password",
      entityType: "flexy_credentials",
      entityId: "888888",
      description: `Regenerated Flexy password for member ${PASSWORD_RESET_EMAIL}`,
      changeDiff: {
        memberId: 888888,
        memberEmail: PASSWORD_RESET_EMAIL,
      },
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(passwordResetRow.id);

  // Legacy-shaped rows: PII embedded in the description but NO structured
  // memberEmail/memberName/recipient on metadata or changeDiff. These
  // mimic rows written before this redaction work landed and prove the
  // template-based fallback redaction still scrubs them at read time.
  const [legacyImpersonateRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "impersonate_start",
      entityType: "user",
      entityId: "777777",
      description: `Admin started impersonating member ${LEGACY_NAME} (${LEGACY_EMAIL})`,
      // Intentionally null: this is what an old row looks like.
      changeDiff: null,
      metadata: null,
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(legacyImpersonateRow.id);

  const [legacyQueueFallbackRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "queue_fallback",
      entityType: "communication",
      description: `Email queue unavailable — direct-send fallback to ${LEGACY_RECIPIENT}`,
      // Legacy row: no metadata at all (the tracker started writing
      // metadata.recipient later). The description rewriter must still
      // redact it.
      metadata: null,
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(legacyQueueFallbackRow.id);

  // cancel_email_change row: PII lives in the description AND nested in
  // changeDiff.before.pendingEmail. This is the row shape the route
  // actually writes today, and it's the worst case for redaction —
  // top-level key stripping alone would leak the email through the
  // expanded changeDiff payload.
  const [cancelEmailChangeRow] = await db
    .insert(auditLogTable)
    .values({
      actionType: "cancel_email_change",
      entityType: "user",
      entityId: "555555",
      description: `Cancelled pending email change for member ${CANCEL_MEMBER_EMAIL} (was: ${CANCEL_PENDING_EMAIL})`,
      changeDiff: {
        memberEmail: CANCEL_MEMBER_EMAIL,
        previousPendingEmail: CANCEL_PENDING_EMAIL,
        before: { pendingEmail: CANCEL_PENDING_EMAIL, emailChangeExpires: "2026-01-01T00:00:00Z" },
        after: { pendingEmail: null, emailChangeExpires: null },
      },
    })
    .returning({ id: auditLogTable.id });
  seededAuditIds.push(cancelEmailChangeRow.id);

  seededIds = {
    queueFallback: queueRow.id,
    impersonate: impersonateRow.id,
    passwordReset: passwordResetRow.id,
    legacyImpersonate: legacyImpersonateRow.id,
    legacyQueueFallback: legacyQueueFallbackRow.id,
    cancelEmailChange: cancelEmailChangeRow.id,
  };
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

async function fetchSeededRow(id: number, actionType: string) {
  const res = await request(app)
    .get("/api/admin/audit-log")
    .query({ actionType, limit: "100" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  const match = (res.body.logs as Array<Record<string, unknown>>).find(
    (l) => l.id === id,
  );
  expect(match, `audit log row ${id} for ${actionType}`).toBeDefined();
  return match!;
}

async function fetchSeededExportJson(actionType: string, id: number) {
  const res = await request(app)
    .get("/api/admin/audit-log/export")
    .query({ actionType, format: "json" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  const match = (res.body as Array<Record<string, unknown>>).find(
    (l) => l.id === id,
  );
  expect(match, `export row ${id} for ${actionType}`).toBeDefined();
  return match!;
}

async function fetchSeededExportCsv(actionType: string) {
  const res = await request(app)
    .get("/api/admin/audit-log/export")
    .query({ actionType, format: "csv" })
    .set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.text;
}

describe("/admin/audit-log queue_fallback PII redaction", () => {
  it("returns the recipient verbatim when the viewer has members:pii", async () => {
    piiState.allowPii = true;

    const row = await fetchSeededRow(seededIds.queueFallback, "queue_fallback");
    expect(row.description).toContain(RECIPIENT);
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.recipient).toBe(RECIPIENT);
    expect(meta.channel).toBe("email");

    const exportRow = await fetchSeededExportJson(
      "queue_fallback",
      seededIds.queueFallback,
    );
    expect(exportRow.description).toContain(RECIPIENT);
    expect((exportRow.metadata as Record<string, unknown>).recipient).toBe(
      RECIPIENT,
    );

    const csv = await fetchSeededExportCsv("queue_fallback");
    expect(csv).toContain(RECIPIENT);
  });

  it("redacts the recipient from description, metadata, and exports when the viewer lacks members:pii", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow(seededIds.queueFallback, "queue_fallback");
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
    const exportRow = await fetchSeededExportJson(
      "queue_fallback",
      seededIds.queueFallback,
    );
    expect(exportRow.description as string).not.toContain(RECIPIENT);
    const exportMeta = exportRow.metadata as Record<string, unknown>;
    expect("recipient" in exportMeta).toBe(false);

    // CSV export embeds the description, so the recipient must not leak there
    // either.
    const csv = await fetchSeededExportCsv("queue_fallback");
    expect(csv).not.toContain(RECIPIENT);
    expect(csv).toContain("redacted");
  });

  it("leaves the underlying audit row in the database unchanged so admins with PII access can still investigate", async () => {
    // Even after a redacted read above, the persisted row must still carry
    // the real recipient.
    const id = seededIds.queueFallback;
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

describe("/admin/audit-log impersonation PII redaction", () => {
  it("returns the member name and email verbatim when the viewer has members:pii", async () => {
    piiState.allowPii = true;

    const row = await fetchSeededRow(seededIds.impersonate, "impersonate_start");
    expect(row.description).toContain(IMPERSONATE_NAME);
    expect(row.description).toContain(IMPERSONATE_EMAIL);
    const diff = row.changeDiff as Record<string, unknown>;
    expect(diff.memberName).toBe(IMPERSONATE_NAME);
    expect(diff.memberEmail).toBe(IMPERSONATE_EMAIL);

    const exportRow = await fetchSeededExportJson(
      "impersonate_start",
      seededIds.impersonate,
    );
    expect(exportRow.description).toContain(IMPERSONATE_EMAIL);

    const csv = await fetchSeededExportCsv("impersonate_start");
    expect(csv).toContain(IMPERSONATE_EMAIL);
  });

  it("scrubs the member name and email from description, changeDiff, and exports when the viewer lacks members:pii", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow(seededIds.impersonate, "impersonate_start");
    expect(row.description).toBe(
      "Admin started impersonating member redacted (redacted)",
    );
    expect(row.description as string).not.toContain(IMPERSONATE_NAME);
    expect(row.description as string).not.toContain(IMPERSONATE_EMAIL);

    const diff = row.changeDiff as Record<string, unknown>;
    expect("memberName" in diff).toBe(false);
    expect("memberEmail" in diff).toBe(false);

    const exportRow = await fetchSeededExportJson(
      "impersonate_start",
      seededIds.impersonate,
    );
    expect(exportRow.description as string).not.toContain(IMPERSONATE_NAME);
    expect(exportRow.description as string).not.toContain(IMPERSONATE_EMAIL);

    const csv = await fetchSeededExportCsv("impersonate_start");
    expect(csv).not.toContain(IMPERSONATE_NAME);
    expect(csv).not.toContain(IMPERSONATE_EMAIL);
    expect(csv).toContain("redacted");
  });

  it("leaves the persisted impersonation row intact so PII-cleared admins can investigate", async () => {
    const [row] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.id, seededIds.impersonate));
    expect(row).toBeDefined();
    expect(row.description).toContain(IMPERSONATE_NAME);
    expect(row.description).toContain(IMPERSONATE_EMAIL);
    const diff = (row.changeDiff ?? {}) as Record<string, unknown>;
    expect(diff.memberName).toBe(IMPERSONATE_NAME);
    expect(diff.memberEmail).toBe(IMPERSONATE_EMAIL);
  });
});

describe("/admin/audit-log password-reset PII redaction", () => {
  it("returns the member email verbatim when the viewer has members:pii", async () => {
    piiState.allowPii = true;

    const row = await fetchSeededRow(
      seededIds.passwordReset,
      "regenerate_password",
    );
    expect(row.description).toContain(PASSWORD_RESET_EMAIL);
    const diff = row.changeDiff as Record<string, unknown>;
    expect(diff.memberEmail).toBe(PASSWORD_RESET_EMAIL);
    // memberId stays put for filtering whether or not the viewer has PII.
    expect(diff.memberId).toBe(888888);

    const exportRow = await fetchSeededExportJson(
      "regenerate_password",
      seededIds.passwordReset,
    );
    expect(exportRow.description).toContain(PASSWORD_RESET_EMAIL);
  });

  it("scrubs the member email but keeps the memberId for filtering when the viewer lacks members:pii", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow(
      seededIds.passwordReset,
      "regenerate_password",
    );
    expect(row.description).toBe(
      "Regenerated Flexy password for member redacted",
    );
    expect(row.description as string).not.toContain(PASSWORD_RESET_EMAIL);

    const diff = row.changeDiff as Record<string, unknown>;
    expect("memberEmail" in diff).toBe(false);
    // Non-PII identifiers like memberId survive so support can still
    // pivot from this row to the member detail page.
    expect(diff.memberId).toBe(888888);

    const csv = await fetchSeededExportCsv("regenerate_password");
    expect(csv).not.toContain(PASSWORD_RESET_EMAIL);
    expect(csv).toContain("redacted");
  });
});

describe("/admin/audit-log redaction of legacy rows (no structured PII fields)", () => {
  // Rows written before the structured-field plumbing existed have no
  // memberName/memberEmail/recipient on changeDiff or metadata. The
  // redactor must still scrub them via the per-action-type description
  // rewriter — otherwise historical PII leaks straight through to viewers
  // without `members:pii`.

  it("redacts a legacy impersonate_start row in JSON list, JSON export, and CSV export", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow(
      seededIds.legacyImpersonate,
      "impersonate_start",
    );
    expect(row.description).toBe(
      "Admin started impersonating member redacted (redacted)",
    );
    expect(row.description as string).not.toContain(LEGACY_NAME);
    expect(row.description as string).not.toContain(LEGACY_EMAIL);

    const exportRow = await fetchSeededExportJson(
      "impersonate_start",
      seededIds.legacyImpersonate,
    );
    expect(exportRow.description as string).not.toContain(LEGACY_NAME);
    expect(exportRow.description as string).not.toContain(LEGACY_EMAIL);

    const csv = await fetchSeededExportCsv("impersonate_start");
    expect(csv).not.toContain(LEGACY_NAME);
    expect(csv).not.toContain(LEGACY_EMAIL);
  });

  it("redacts a legacy queue_fallback row whose metadata is null", async () => {
    piiState.allowPii = false;

    const row = await fetchSeededRow(
      seededIds.legacyQueueFallback,
      "queue_fallback",
    );
    expect(row.description).toBe(
      "Email queue unavailable — direct-send fallback to redacted",
    );
    expect(row.description as string).not.toContain(LEGACY_RECIPIENT);

    const csv = await fetchSeededExportCsv("queue_fallback");
    expect(csv).not.toContain(LEGACY_RECIPIENT);
  });

  it("strips nested PII from cancel_email_change.changeDiff.before.pendingEmail in the listing endpoint", async () => {
    // The route writes the email twice into the audit row: once at the
    // top level (memberEmail / previousPendingEmail) and once inside the
    // before/after blob (before.pendingEmail). Both must be redacted —
    // top-level stripping alone would still leak the address through the
    // nested diff.
    piiState.allowPii = false;

    const row = await fetchSeededRow(
      seededIds.cancelEmailChange,
      "cancel_email_change",
    );
    expect(row.description).toBe(
      "Cancelled pending email change for member redacted (was: redacted)",
    );

    // The single hardest assertion: the email must not appear ANYWHERE
    // in the row payload — not in the description, not in changeDiff
    // top-level, and not in any nested object.
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(CANCEL_MEMBER_EMAIL);
    expect(serialised).not.toContain(CANCEL_PENDING_EMAIL);

    // Spot-check the nested shape so we know we're actually walking deep
    // and not just removing description text.
    const diff = row.changeDiff as Record<string, unknown>;
    expect("memberEmail" in diff).toBe(false);
    expect("previousPendingEmail" in diff).toBe(false);
    const before = diff.before as Record<string, unknown> | undefined;
    expect(before).toBeDefined();
    expect("pendingEmail" in (before ?? {})).toBe(false);
    // Non-PII context fields survive — emailChangeExpires is a timestamp,
    // not the address itself.
    expect(before?.emailChangeExpires).toBe("2026-01-01T00:00:00Z");

    // CSV export goes through the same redactor.
    const csv = await fetchSeededExportCsv("cancel_email_change");
    expect(csv).not.toContain(CANCEL_MEMBER_EMAIL);
    expect(csv).not.toContain(CANCEL_PENDING_EMAIL);

    // And the JSON export.
    const exportRow = await fetchSeededExportJson(
      "cancel_email_change",
      seededIds.cancelEmailChange,
    );
    expect(JSON.stringify(exportRow)).not.toContain(CANCEL_MEMBER_EMAIL);
    expect(JSON.stringify(exportRow)).not.toContain(CANCEL_PENDING_EMAIL);

    // Database row must remain intact for PII-cleared admins / forensic
    // investigation. Verify by querying the DB directly.
    const [dbRow] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.id, seededIds.cancelEmailChange));
    expect(dbRow.description).toContain(CANCEL_MEMBER_EMAIL);
    expect(dbRow.description).toContain(CANCEL_PENDING_EMAIL);
    const dbDiff = dbRow.changeDiff as Record<string, unknown>;
    expect(dbDiff.memberEmail).toBe(CANCEL_MEMBER_EMAIL);
    expect((dbDiff.before as Record<string, unknown>).pendingEmail).toBe(
      CANCEL_PENDING_EMAIL,
    );
  });

  it("returns the original description for legacy rows when the viewer has members:pii", async () => {
    // Sanity check: the description rewriter only runs in the
    // non-PII branch, so PII-cleared admins still see the full text.
    piiState.allowPii = true;

    const row = await fetchSeededRow(
      seededIds.legacyImpersonate,
      "impersonate_start",
    );
    expect(row.description).toContain(LEGACY_NAME);
    expect(row.description).toContain(LEGACY_EMAIL);
  });
});
