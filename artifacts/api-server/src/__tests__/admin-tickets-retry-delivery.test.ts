import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminTicketsRouter from "../routes/admin-tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticket-retry-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let superAdminCookie = "";
let memberCookie = "";
let memberUserId = 0;
let failedTicketId = 0;
let skippedTicketId = 0;
let deliveredTicketId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedTicket(
  suffix: string,
  deliveryStatus: "failed" | "skipped" | "delivered",
): Promise<number> {
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}-${suffix}`,
      userId: memberUserId,
      subject: `Retry ${suffix} ticket`,
      category: "billing",
      priority: "normal",
      status: "open",
      deliveryStatus,
      deliveryLastError: deliveryStatus === "delivered" ? null : "boom",
    })
    .returning({ id: ticketsTable.id });
  seededTicketIds.push(ticket.id);
  await db.insert(ticketMessagesTable).values({
    ticketId: ticket.id,
    senderType: "member",
    body: "Original member message body.",
    isInternal: false,
  });
  return ticket.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminTicketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [superAdmin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-super@example.test`,
      name: "Retry Super Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(superAdmin.id);
  superAdminCookie = signCookie(superAdmin.id, superAdmin.email);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Retry Member",
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

  failedTicketId = await seedTicket("failed", "failed");
  skippedTicketId = await seedTicket("skipped", "skipped");
  deliveredTicketId = await seedTicket("delivered", "delivered");
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db
      .delete(ticketMessagesTable)
      .where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/tickets/:id/retry-delivery", () => {
  it("resets a failed ticket back to pending and clears the last error", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/${failedTicketId}/retry-delivery`)
      .set("Cookie", superAdminCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deliveryStatus).toBe("pending");

    const [row] = await db
      .select({
        deliveryStatus: ticketsTable.deliveryStatus,
        deliveryLastError: ticketsTable.deliveryLastError,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, failedTicketId));
    expect(row.deliveryStatus).toBe("pending");
    expect(row.deliveryLastError).toBeNull();
  });

  it("retries a skipped ticket", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/${skippedTicketId}/retry-delivery`)
      .set("Cookie", superAdminCookie);

    expect(res.status).toBe(200);
    const [row] = await db
      .select({ deliveryStatus: ticketsTable.deliveryStatus })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, skippedTicketId));
    expect(row.deliveryStatus).toBe("pending");
  });

  it("returns 409 for a ticket that was already delivered", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/${deliveredTicketId}/retry-delivery`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(409);

    const [row] = await db
      .select({ deliveryStatus: ticketsTable.deliveryStatus })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, deliveredTicketId));
    expect(row.deliveryStatus).toBe("delivered");
  });

  it("returns 404 for an unknown ticket id", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/99999999/retry-delivery`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric ticket id", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/not-a-number/retry-delivery`)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects callers without tickets:manage permission", async () => {
    const res = await request(app)
      .post(`/api/admin/tickets/${failedTicketId}/retry-delivery`)
      .set("Cookie", memberCookie);
    expect([401, 403]).toContain(res.status);
  });
});
