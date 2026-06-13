/**
 * Tests that POST /api/tickets triggers a TicketDesk delivery with the
 * correct contact email, subject, body, and BTS ticket number, and that a
 * TicketDesk failure (or missing API key) does NOT break local ticket
 * creation.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
  ticketSlaTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "ghl_job_id"),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

vi.mock("../lib/ticketdesk-queue", () => ({
  queueTicketDeskDelivery: vi.fn(async () => "td_job_id"),
}));

import { queueTicketDeskDelivery } from "../lib/ticketdesk-queue";
import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const queueTicketDeskDeliveryMock = vi.mocked(queueTicketDeskDelivery);

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticketdesk-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
let memberUserId = 0;
let memberEmail = "";
let memberName = "";
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  memberEmail = `${TEST_TAG}@example.test`;
  memberName = "TicketDesk Test Member";

  const [member] = await db
    .insert(usersTable)
    .values({
      email: memberEmail,
      name: memberName,
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
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db
      .delete(ticketSlaTable)
      .where(inArray(ticketSlaTable.ticketId, seededTicketIds));
    await db
      .delete(ticketMessagesTable)
      .where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db
      .delete(ticketsTable)
      .where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/tickets — TicketDesk delivery", () => {
  it("queues a TicketDesk delivery with the member's email, name, subject, body, and BTS ticket number", async () => {
    queueTicketDeskDeliveryMock.mockClear();

    const subject = "Cannot access my course materials";
    const description =
      "I tried logging in three times but the dashboard keeps loading forever.";

    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", memberCookie)
      .send({ category: "technical", subject, description });

    expect(res.status).toBe(201);

    const ticketNumber: string = res.body.ticketNumber;
    expect(ticketNumber).toMatch(/^BTS-\d{6}$/);

    // Track for cleanup
    seededTicketIds.push(res.body.id as number);

    // The route dispatches TicketDesk in a fire-and-forget async IIFE, so
    // give it a tick to settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queueTicketDeskDeliveryMock).toHaveBeenCalledOnce();

    const callArg = queueTicketDeskDeliveryMock.mock.calls[0][0];
    expect(callArg).toMatchObject({
      contactEmail: memberEmail,
      contactName: memberName,
      subject,
      body: description,
      btsTicketNumber: ticketNumber,
    });
  });

  it("still creates the ticket locally when TicketDesk delivery throws", async () => {
    queueTicketDeskDeliveryMock.mockClear();
    queueTicketDeskDeliveryMock.mockRejectedValueOnce(
      new Error("TicketDesk temporarily unavailable"),
    );

    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", memberCookie)
      .send({
        category: "billing",
        subject: "Charge appeared twice on my card",
        description:
          "I was billed twice in the same month, please investigate.",
      });

    // Local ticket creation must succeed regardless of TicketDesk state
    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^BTS-\d{6}$/);
    seededTicketIds.push(res.body.id as number);

    // Confirm the ticket exists in the DB
    const [row] = await db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, res.body.id as number));
    expect(row).toBeDefined();
  });

  it("sends the member's account email for the Contact Us form body format", async () => {
    // The Contact Us / General Support form embeds a custom name/email as
    // "From: Jane <jane@other.example>\n\n…" in the description body.
    // The TicketDesk contact must always be keyed off the logged-in member's
    // account email so tickets group under the correct person.
    queueTicketDeskDeliveryMock.mockClear();

    const customEmail = "jane@other.example";
    const description = `From: Jane Doe <${customEmail}>\n\nHello, I need help with my account.`;
    const subject = "General Support Request from Jane Doe";

    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", memberCookie)
      .send({ category: "other", subject, description });

    expect(res.status).toBe(201);
    seededTicketIds.push(res.body.id as number);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queueTicketDeskDeliveryMock).toHaveBeenCalledOnce();
    const callArg = queueTicketDeskDeliveryMock.mock.calls[0][0];

    // Must use the account email, NOT the email embedded in the form body
    expect(callArg.contactEmail).toBe(memberEmail);
    expect(callArg.contactEmail).not.toBe(customEmail);
    expect(callArg.body).toBe(description);
  });
});
