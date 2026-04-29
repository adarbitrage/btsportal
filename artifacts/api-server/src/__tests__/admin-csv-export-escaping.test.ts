import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable, ticketsTable } from "@workspace/db";
import { eq, gt, inArray, and, desc } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter, { csvEscape } from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `audit-export-escape-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminId = 0;
let adminCookie = "";
let baselineAuditId = 0;
const createdTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

// Minimal RFC 4180 CSV parser used to verify the export round-trips. Supports
// quoted fields, doubled quotes, and embedded commas/CR/LF inside quoted
// values. The export uses LF row terminators, so that's what we accept.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\r") {
        // Skip CR; LF below will close the row.
      } else {
        field += ch;
      }
    }
  }
  // Flush trailing field/row if the input does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
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
      name: "CSV Escape Admin",
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
  // Delete every audit row created during this run that references our test
  // admin — that includes rows our tests inserted directly (entityType ===
  // TEST_TAG) AND rows the export route logged via logAdminAction (e.g.
  // entityType === "tickets") which would otherwise block deleting the
  // admin user via the actor_id foreign key.
  if (adminId) {
    await db
      .delete(auditLogTable)
      .where(and(gt(auditLogTable.id, baselineAuditId), eq(auditLogTable.actorId, adminId)));
  } else {
    await db
      .delete(auditLogTable)
      .where(and(gt(auditLogTable.id, baselineAuditId), eq(auditLogTable.entityType, TEST_TAG)));
  }
  if (createdTicketIds.length > 0) {
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, createdTicketIds));
  }
  if (adminId) {
    await db.delete(usersTable).where(inArray(usersTable.id, [adminId]));
  }
});

describe("csvEscape helper", () => {
  it("returns plain values unquoted when no special characters are present", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape(42)).toBe("42");
  });

  it("represents null and undefined as empty fields", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes commas, quotes, and newlines and doubles inner quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("serializes Date instances as ISO strings", () => {
    const d = new Date("2025-01-02T03:04:05.000Z");
    expect(csvEscape(d)).toBe("2025-01-02T03:04:05.000Z");
  });
});

describe("GET /admin/audit-log/export — CSV escaping", () => {
  it("round-trips rows whose descriptions contain commas, quotes, and newlines", async () => {
    const actionType = `${TEST_TAG}-special`;
    const tricky = [
      'Member updated profile, including email',
      'Note: "looks legit" but flagged',
      "Multi-line\nnote with\nnewlines",
      'Combo: "quoted", comma, and\nnewline',
    ];

    // Insert the rows with both a tricky description and a tricky entityId
    // (which used to be written unquoted) so we cover both columns.
    for (let i = 0; i < tricky.length; i++) {
      await db.insert(auditLogTable).values({
        actorId: adminId,
        actorEmail: `${TEST_TAG}@example.test`,
        actionType,
        entityType: TEST_TAG,
        entityId: i === 0 ? "id,with,commas" : String(i),
        description: tricky[i],
      });
    }

    const res = await request(app)
      .get("/api/admin/audit-log/export")
      .query({ actionType, entityType: TEST_TAG, format: "csv" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const parsed = parseCsv(res.text);
    // First row is the header.
    expect(parsed[0]).toEqual([
      "id",
      "actor_id",
      "actor_email",
      "action_type",
      "entity_type",
      "entity_id",
      "description",
      "ip_address",
      "created_at",
    ]);

    // The remaining rows must all have the same column count as the header,
    // even though the descriptions contain commas and newlines.
    const dataRows = parsed.slice(1);
    expect(dataRows).toHaveLength(tricky.length);
    for (const row of dataRows) {
      expect(row).toHaveLength(parsed[0].length);
    }

    // The export is sorted by createdAt desc, so the last inserted row comes
    // first. Build a map by entity_id to compare independently of order.
    const byEntityId = new Map(dataRows.map(r => [r[5], r]));
    expect(byEntityId.get("id,with,commas")?.[6]).toBe(tricky[0]);
    expect(byEntityId.get("1")?.[6]).toBe(tricky[1]);
    expect(byEntityId.get("2")?.[6]).toBe(tricky[2]);
    expect(byEntityId.get("3")?.[6]).toBe(tricky[3]);

    // And actor_email/action_type/entity_type round-trip too.
    for (const row of dataRows) {
      expect(row[2]).toBe(`${TEST_TAG}@example.test`);
      expect(row[3]).toBe(actionType);
      expect(row[4]).toBe(TEST_TAG);
    }
  });
});

describe("GET /admin/export/:type — CSV escaping", () => {
  it("round-trips ticket subjects containing commas, quotes, and newlines", async () => {
    // Use a unique category tied to the test tag so we can isolate our rows
    // even if other tickets exist in the database.
    const category = `${TEST_TAG}-cat`;
    const trickySubjects = [
      'Login broken: "press the, button" then nothing',
      "Multi-line\nrequest with\nembedded newlines",
      'Order #42, "urgent", refund please',
    ];

    for (let i = 0; i < trickySubjects.length; i++) {
      const [row] = await db
        .insert(ticketsTable)
        .values({
          ticketNumber: `${TEST_TAG}-${i}`,
          userId: adminId,
          category,
          priority: "normal",
          status: "open",
          subject: trickySubjects[i],
        })
        .returning({ id: ticketsTable.id });
      createdTicketIds.push(row.id);
    }

    const res = await request(app)
      .get("/api/admin/export/tickets")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const parsed = parseCsv(res.text);

    // Filter to just the rows this test inserted (matched by category at
    // column index 3 — the data ordering matches `ticketsTable`'s column
    // order).
    const ourRows = parsed.slice(1).filter(r => r[3] === category);
    expect(ourRows).toHaveLength(trickySubjects.length);

    // Every data row must have the same column count as every other data
    // row. Without proper escaping a subject with commas or newlines would
    // shift the column boundaries and produce rows of varying lengths —
    // that's the exact regression this fix prevents.
    const widths = new Set(ourRows.map(r => r.length));
    expect(widths.size).toBe(1);

    // The subject column (index 6 in `ticketsTable`'s column order) must
    // round-trip exactly, including embedded commas/quotes/newlines.
    const byTicketNumber = new Map(ourRows.map(r => [r[1], r]));
    for (let i = 0; i < trickySubjects.length; i++) {
      const row = byTicketNumber.get(`${TEST_TAG}-${i}`);
      expect(row, `expected a row for ticket ${TEST_TAG}-${i}`).toBeDefined();
      expect(row?.[6]).toBe(trickySubjects[i]);
    }
  });
});
