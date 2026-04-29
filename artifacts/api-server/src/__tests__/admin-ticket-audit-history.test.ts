import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable, ticketsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticket-audit-${randomUUID().slice(0, 8)}`;
const ACTION_TYPE = `test_ticket_audit_${TEST_TAG.replace(/-/g, "_")}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";
let ticketId = 0;
let otherTicketId = 0;
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Ticket Audit Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(admin.id);
  adminCookie = signCookie(admin.id, admin.email);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Ticket Audit Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(member.id);
  memberCookie = signCookie(member.id, member.email);

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}`,
      userId: member.id,
      subject: "Test ticket for audit history",
      category: "billing",
      priority: "normal",
      status: "open",
    })
    .returning({ id: ticketsTable.id });
  ticketId = ticket.id;
  seededTicketIds.push(ticketId);

  const [other] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}-other`,
      userId: member.id,
      subject: "Another ticket for noise",
      category: "billing",
      priority: "normal",
      status: "open",
    })
    .returning({ id: ticketsTable.id });
  otherTicketId = other.id;
  seededTicketIds.push(otherTicketId);

  // Three rows on the target ticket — strictly-increasing timestamps so we
  // can assert the newest-first ordering returned by the endpoint.
  const base = Date.now() - 60 * 60 * 1000;
  const rows = [
    {
      actionType: ACTION_TYPE,
      entityType: "ticket",
      entityId: String(ticketId),
      actorId: admin.id,
      description: "ticket assigned",
      createdAt: new Date(base),
    },
    {
      actionType: ACTION_TYPE,
      entityType: "ticket",
      entityId: String(ticketId),
      actorId: admin.id,
      description: "status moved to in_progress",
      createdAt: new Date(base + 1000),
    },
    {
      actionType: ACTION_TYPE,
      entityType: "ticket",
      entityId: String(ticketId),
      actorId: admin.id,
      description: "ticket merged",
      ipAddress: "10.0.0.7",
      createdAt: new Date(base + 2000),
    },
    // Noise rows — different ticket and different entityType — must not be
    // returned for the target ticket.
    {
      actionType: ACTION_TYPE,
      entityType: "ticket",
      entityId: String(otherTicketId),
      actorId: admin.id,
      description: "different ticket activity",
      createdAt: new Date(base + 3000),
    },
    {
      actionType: ACTION_TYPE,
      entityType: "user",
      entityId: String(ticketId),
      actorId: admin.id,
      description: "user-entity row that happens to share the ticket id",
      createdAt: new Date(base + 4000),
    },
  ];
  const inserted = await db.insert(auditLogTable).values(rows).returning({
    id: auditLogTable.id,
  });
  seededAuditIds.push(...inserted.map((r) => r.id));
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededTicketIds.length > 0) {
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/tickets/:id/audit-history", () => {
  it("returns the ticket's audit rows newest-first and ignores other entities", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/${ticketId}/audit-history`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: expect.any(Number) });
    const history: Array<{ entityType: string; entityId: string; description: string }> =
      res.body.auditHistory;
    expect(Array.isArray(history)).toBe(true);

    // Only entityType === "ticket" + entityId === ticketId should appear.
    expect(history.every((row) => row.entityType === "ticket" && row.entityId === String(ticketId))).toBe(true);

    // Filter to seeded rows so concurrent dev-data noise can't break the
    // ordering assertion.
    const seeded = history.filter((row) =>
      ["ticket assigned", "status moved to in_progress", "ticket merged"].includes(row.description),
    );
    expect(seeded.map((r) => r.description)).toEqual([
      "ticket merged",
      "status moved to in_progress",
      "ticket assigned",
    ]);
  });

  it("returns 400 for a non-numeric ticket id", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/not-a-number/audit-history`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects callers without tickets:view permission", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/${ticketId}/audit-history`)
      .set("Cookie", memberCookie);
    // Members don't get tickets:view in the admin RBAC catalogue.
    expect([401, 403]).toContain(res.status);
  });
});
