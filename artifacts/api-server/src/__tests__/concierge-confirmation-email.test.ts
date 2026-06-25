import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// The TicketDesk delivery path already records its own terminal outcome on the
// ticket (delivery_status + support fallback), so it stays fire-and-forget. The
// confirmation email is the gap this test guards: its queueEmail outcome must
// be surfaced to the member via `confirmationEmailSent` rather than silently
// swallowed. We control that outcome through this mock.
const queueEmailMock = vi.fn();

vi.mock("../lib/ghl-queue", () => ({ queueGHLSync: vi.fn(async () => "job") }));
vi.mock("../lib/ticketdesk-queue", () => ({
  queueTicketDeskDelivery: vi.fn(async () => undefined),
}));
vi.mock("../lib/webhook-events", () => ({ emitWebhookEvent: vi.fn(async () => undefined) }));
vi.mock("../lib/communication-service", () => ({
  CommunicationService: { queueEmail: (...args: unknown[]) => queueEmailMock(...args) },
}));
vi.mock("../lib/sla", () => ({
  createSlaForTicket: vi.fn(async () => undefined),
  resumeSla: vi.fn(async () => undefined),
  recordFirstResponse: vi.fn(async () => undefined),
}));
vi.mock("../lib/ticket-routing", () => ({ autoRouteTicket: vi.fn(async () => undefined) }));

import { db, usersTable, ticketsTable, ticketMessagesTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `concierge-confirm-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

const conciergeBody = {
  offerName: "Acme Offer",
  offerUrl: "https://example.test/vsl",
  network: "Clickbank",
  traffic: "Grasshopper",
  phase: '"Build" Phase',
  selectedTasks: ["Create Full Banner (10 Max)"],
};

const complianceBody = {
  offerName: "Acme Offer",
  affiliateNetwork: "ClickBank",
  trafficSource: "Grasshopper",
  selectedCreatives: ["Banner Images"],
};

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Concierge Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(member.id);
  memberCookie = signCookie(member.id, member.email);
});

beforeEach(() => {
  queueEmailMock.mockReset();
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db.delete(ticketMessagesTable).where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("confirmation-email visibility on concierge/compliance submit", () => {
  it("reports confirmationEmailSent: true when the email is queued", async () => {
    queueEmailMock.mockResolvedValue({ result: "queued" });

    const res = await request(app)
      .post("/api/tickets/concierge")
      .set("Cookie", memberCookie)
      .send(conciergeBody);

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(true);
    seededTicketIds.push(res.body.ticketId as number);
    expect(queueEmailMock).toHaveBeenCalledOnce();

    // The `From:` line is built from the authenticated account record, not from
    // typed input (the form no longer collects name/email).
    const [message] = await db
      .select({ body: ticketMessagesTable.body })
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, res.body.ticketId as number));
    expect(message.body).toContain(`From: Concierge Member <${TEST_TAG}@example.test>`);
  });

  it("reports confirmationEmailSent: true when the email is sent directly", async () => {
    queueEmailMock.mockResolvedValue({ result: "sent_direct" });

    const res = await request(app)
      .post("/api/tickets/concierge")
      .set("Cookie", memberCookie)
      .send(conciergeBody);

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(true);
    seededTicketIds.push(res.body.ticketId as number);
  });

  it("reports confirmationEmailSent: false when queueEmail reports a failed outcome", async () => {
    queueEmailMock.mockResolvedValue({ result: "failed", reason: "provider exploded" });

    const res = await request(app)
      .post("/api/tickets/concierge")
      .set("Cookie", memberCookie)
      .send(conciergeBody);

    // The ticket is still created — a missed confirmation never fails the
    // request — but the member is told the truth.
    expect(res.status).toBe(201);
    expect(typeof res.body.ticketId).toBe("number");
    expect(res.body.confirmationEmailSent).toBe(false);
    seededTicketIds.push(res.body.ticketId as number);
  });

  it("reports confirmationEmailSent: false when queueEmail skips (template missing/unconfigured)", async () => {
    queueEmailMock.mockResolvedValue({ result: "skipped", reason: "template_not_found" });

    const res = await request(app)
      .post("/api/tickets/concierge")
      .set("Cookie", memberCookie)
      .send(conciergeBody);

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(false);
    seededTicketIds.push(res.body.ticketId as number);
  });

  it("reports confirmationEmailSent: false when queueEmail throws", async () => {
    queueEmailMock.mockRejectedValue(new Error("boom"));

    const res = await request(app)
      .post("/api/tickets/concierge")
      .set("Cookie", memberCookie)
      .send(conciergeBody);

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(false);
    seededTicketIds.push(res.body.ticketId as number);
  });

  it("also surfaces confirmationEmailSent on the compliance endpoint", async () => {
    queueEmailMock.mockResolvedValue({ result: "failed", reason: "nope" });

    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send(complianceBody);

    expect(res.status).toBe(201);
    expect(res.body.confirmationEmailSent).toBe(false);
    seededTicketIds.push(res.body.ticketId as number);

    // Compliance, like concierge, builds the `From:` line from the
    // authenticated account record rather than typed input.
    const [message] = await db
      .select({ body: ticketMessagesTable.body })
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, res.body.ticketId as number));
    expect(message.body).toContain(`From: Concierge Member <${TEST_TAG}@example.test>`);
  });
});
