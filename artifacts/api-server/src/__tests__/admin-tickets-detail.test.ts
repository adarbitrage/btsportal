import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  ticketsTable,
  ticketSlaTable,
  ticketMessagesTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminTicketsRouter from "../routes/admin-tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticket-detail-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let superAdminCookie = "";
let memberCookie = "";
let adminUserId = 0;
let otherAdminUserId = 0;
let memberUserId = 0;
let ticketId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminTicketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [superAdmin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-super@example.test`,
      name: "Detail Super Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  adminUserId = superAdmin.id;
  seededUserIds.push(superAdmin.id);
  superAdminCookie = signCookie(superAdmin.id, superAdmin.email);

  const [otherAdmin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Detail Other Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  otherAdminUserId = otherAdmin.id;
  seededUserIds.push(otherAdmin.id);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Detail Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  memberUserId = member.id;
  seededUserIds.push(member.id);
  memberCookie = signCookie(member.id, member.email);

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}`,
      userId: memberUserId,
      subject: "Detail endpoint ticket",
      category: "billing",
      priority: "normal",
      status: "open",
    })
    .returning({ id: ticketsTable.id });
  ticketId = ticket.id;
  seededTicketIds.push(ticketId);

  await db.insert(ticketSlaTable).values({
    ticketId,
    tierSlug: "lifetime",
    firstResponseTargetMinutes: 60,
    resolutionTargetMinutes: 1440,
  });

  await db.insert(ticketMessagesTable).values([
    {
      ticketId,
      senderType: "member",
      body: "Hello, I need help.",
      isInternal: false,
    },
    {
      ticketId,
      senderType: "admin",
      body: "We're on it.",
      isInternal: false,
    },
  ]);
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db
      .delete(ticketMessagesTable)
      .where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db
      .delete(ticketSlaTable)
      .where(inArray(ticketSlaTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/tickets/:id", () => {
  it("returns enriched ticket with member, tier, and labelled messages", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/${ticketId}`)
      .set("Cookie", superAdminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ticketId);
    expect(res.body.subject).toBe("Detail endpoint ticket");
    expect(res.body.member).toMatchObject({
      id: memberUserId,
      name: "Detail Member",
    });
    expect(res.body.assignee).toBeNull();
    expect(res.body.tier).toBe("lifetime");
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBe(2);
    const memberMsg = res.body.messages.find((m: { senderType: string }) => m.senderType === "member");
    const adminMsg = res.body.messages.find((m: { senderType: string }) => m.senderType === "admin");
    expect(memberMsg.senderName).toBe("Detail Member");
    expect(adminMsg.senderName).toBe("Admin");
  });

  it("returns 404 for an unknown ticket id", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/99999999`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric ticket id", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/not-a-number`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects callers without tickets:view permission", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/${ticketId}`)
      .set("Cookie", memberCookie);
    expect([401, 403]).toContain(res.status);
  });
});

describe("GET /admin/tickets/assignees", () => {
  it("returns admin and super_admin users only", async () => {
    const res = await request(app)
      .get(`/api/admin/tickets/assignees`)
      .set("Cookie", superAdminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((a: { id: number }) => a.id);
    expect(ids).toContain(adminUserId);
    expect(ids).toContain(otherAdminUserId);
    expect(ids).not.toContain(memberUserId);
  });
});

describe("PUT /admin/tickets/:id/priority", () => {
  it("updates the priority", async () => {
    const res = await request(app)
      .put(`/api/admin/tickets/${ticketId}/priority`)
      .set("Cookie", superAdminCookie)
      .send({ priority: "high" });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("high");

    const [row] = await db
      .select({ priority: ticketsTable.priority })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId));
    expect(row.priority).toBe("high");
  });

  it("rejects invalid priorities", async () => {
    const res = await request(app)
      .put(`/api/admin/tickets/${ticketId}/priority`)
      .set("Cookie", superAdminCookie)
      .send({ priority: "bogus" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /admin/tickets/:id/assign", () => {
  it("assigns the ticket to an admin user", async () => {
    const res = await request(app)
      .put(`/api/admin/tickets/${ticketId}/assign`)
      .set("Cookie", superAdminCookie)
      .send({ assignedTo: otherAdminUserId });

    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe(otherAdminUserId);
  });

  it("rejects assigning to a non-admin user", async () => {
    const res = await request(app)
      .put(`/api/admin/tickets/${ticketId}/assign`)
      .set("Cookie", superAdminCookie)
      .send({ assignedTo: memberUserId });
    expect(res.status).toBe(400);
  });

  it("unassigns when assignedTo is null", async () => {
    const res = await request(app)
      .put(`/api/admin/tickets/${ticketId}/assign`)
      .set("Cookie", superAdminCookie)
      .send({ assignedTo: null });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBeNull();
  });
});
