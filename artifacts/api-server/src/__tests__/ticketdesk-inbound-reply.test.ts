/**
 * Tests the inbound TicketDesk webhook (POST /api/webhooks/ticketdesk) that
 * mirrors a support agent's reply back into the member's portal ticket thread.
 *
 * Covers: appending an agent reply, status/SLA side-effects, ignoring the
 * member's own echoed messages, unknown-ticket and unparseable payloads, and
 * idempotent redelivery.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
  ticketSlaTable,
  webhookLogsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "ghl_job_id"),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

vi.mock("../lib/ticketdesk-queue", () => ({
  queueTicketDeskDelivery: vi.fn(async () => "td_job_id"),
}));

const queueEmailMock = vi.fn(async (_params: unknown) => ({ result: "queued" as const }));
const queueSmsMock = vi.fn(async (_params: unknown) => ({ result: "queued" as const }));
vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: (params: unknown) => queueEmailMock(params),
    queueSms: (params: unknown) => queueSmsMock(params),
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const TEST_TAG = `td-inbound-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberUserId = 0;
let smsMemberUserId = 0;
let ticketSmsOptOutUserId = 0;
const SMS_MEMBER_PHONE = "+15555550123";
const TICKET_OPTOUT_PHONE = "+15555550199";
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

async function createTicket(opts: {
  status?: string;
  userId?: number;
} = {}): Promise<{ id: number; ticketNumber: string }> {
  const ticketNumber = `BTS-${Math.floor(100000 + Math.random() * 900000)}`;
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber,
      userId: opts.userId ?? memberUserId,
      category: "technical",
      priority: "normal",
      status: opts.status ?? "open",
      subject: "Inbound reply test",
    })
    .returning({ id: ticketsTable.id, ticketNumber: ticketsTable.ticketNumber });
  seededTicketIds.push(ticket.id);
  return ticket;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Inbound Reply Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });

  memberUserId = member.id;
  seededUserIds.push(member.id);

  const [smsMember] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-sms@example.test`,
      name: "SMS Opted-in Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: SMS_MEMBER_PHONE,
      smsOptIn: true,
    })
    .returning({ id: usersTable.id });

  smsMemberUserId = smsMember.id;
  seededUserIds.push(smsMember.id);

  // Master SMS on, but opted OUT of the ticket-reply SMS category. Should
  // still get the email, never the text.
  const [ticketOptOut] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-ticketoptout@example.test`,
      name: "Ticket SMS Opt-out Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      phone: TICKET_OPTOUT_PHONE,
      smsOptIn: true,
      ticketReplySmsOptIn: false,
    })
    .returning({ id: usersTable.id });

  ticketSmsOptOutUserId = ticketOptOut.id;
  seededUserIds.push(ticketOptOut.id);
});

afterAll(async () => {
  await db
    .delete(webhookLogsTable)
    .where(like(webhookLogsTable.externalId, "ticketdesk_reply_%"));
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
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/webhooks/ticketdesk — inbound replies", () => {
  it("appends an agent reply to the matching ticket as an admin message", async () => {
    const ticket = await createTicket({ status: "open" });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        event: "conversation.reply.created",
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Thanks for reaching out — try clearing your cache.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ticketNumber).toBe(ticket.ticketNumber);

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id));

    expect(messages).toHaveLength(1);
    expect(messages[0].senderType).toBe("admin");
    expect(messages[0].isInternal).toBe(false);
    expect(messages[0].body).toContain("clearing your cache");

    // open -> in_progress
    const [updated] = await db
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticket.id));
    expect(updated.status).toBe("in_progress");
  });

  it("emails the member a deep-linked reply notification when an agent replies", async () => {
    queueEmailMock.mockClear();
    const ticket = await createTicket({ status: "open" });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Here is our answer.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    expect(queueEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateSlug: "ticket_reply",
        to: `${TEST_TAG}@example.test`,
        userId: memberUserId,
        variables: expect.objectContaining({
          ticket_number: ticket.ticketNumber,
          ticket_id: String(ticket.id),
        }),
      }),
    );
  });

  it("also texts an SMS-opted-in member with a deep-linked reply notification", async () => {
    queueEmailMock.mockClear();
    queueSmsMock.mockClear();
    const ticket = await createTicket({ status: "open", userId: smsMemberUserId });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Here is our SMS-worthy answer.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    expect(queueSmsMock).toHaveBeenCalledTimes(1);
    expect(queueSmsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateSlug: "ticket_reply",
        to: SMS_MEMBER_PHONE,
        userId: smsMemberUserId,
        variables: expect.objectContaining({
          ticket_number: ticket.ticketNumber,
          ticket_id: String(ticket.id),
        }),
      }),
    );
  });

  it("does not text a member who opted out of ticket-reply texts but still emails them", async () => {
    queueEmailMock.mockClear();
    queueSmsMock.mockClear();
    const ticket = await createTicket({ status: "open", userId: ticketSmsOptOutUserId });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Email yes, ticket-reply text no.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    expect(queueSmsMock).not.toHaveBeenCalled();
  });

  it("does not text a member who has not opted into SMS", async () => {
    queueEmailMock.mockClear();
    queueSmsMock.mockClear();
    const ticket = await createTicket({ status: "open" });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Email only, no SMS.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    expect(queueSmsMock).not.toHaveBeenCalled();
  });

  it("does not text twice on a redelivered (duplicate) reply", async () => {
    queueSmsMock.mockClear();
    const ticket = await createTicket({ status: "open", userId: smsMemberUserId });
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Dedup SMS body.",
        author: { type: "agent" },
      },
    };

    await request(app).post("/api/webhooks/ticketdesk").send(payload);
    await request(app).post("/api/webhooks/ticketdesk").send(payload);

    expect(queueSmsMock).toHaveBeenCalledTimes(1);
  });

  it("does not email the member for their own echoed reply", async () => {
    queueEmailMock.mockClear();
    const ticket = await createTicket({ status: "in_progress" });

    await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Member talking, no email expected.",
          author: { type: "contact" },
        },
      });

    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("does not email twice on a redelivered (duplicate) reply", async () => {
    queueEmailMock.mockClear();
    const ticket = await createTicket({ status: "open" });
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Dedup email body.",
        author: { type: "agent" },
      },
    };

    await request(app).post("/api/webhooks/ticketdesk").send(payload);
    await request(app).post("/api/webhooks/ticketdesk").send(payload);

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
  });

  it("resumes a paused SLA when replying to an awaiting_response ticket", async () => {
    const ticket = await createTicket({ status: "awaiting_response" });
    await db.insert(ticketSlaTable).values({
      ticketId: ticket.id,
      tierSlug: "lifetime",
      firstResponseTargetMinutes: 120,
      resolutionTargetMinutes: 720,
      pausedAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Following up on your issue.",
          author: { type: "staff" },
        },
      });

    expect(res.status).toBe(200);

    const [sla] = await db
      .select()
      .from(ticketSlaTable)
      .where(eq(ticketSlaTable.ticketId, ticket.id));
    expect(sla.pausedAt).toBeNull();

    const [updated] = await db
      .select({ status: ticketsTable.status })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticket.id));
    expect(updated.status).toBe("in_progress");
  });

  it("ignores the member's own echoed reply (does not append)", async () => {
    const ticket = await createTicket({ status: "in_progress" });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: ticket.ticketNumber,
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "This is the member talking, should not be mirrored.",
          author: { type: "contact" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("member_reply");

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id));
    expect(messages).toHaveLength(0);
  });

  it("acks an unknown ticket reference without appending anything", async () => {
    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({
        reference: "BTS-000000",
        reply: {
          id: `rep_${randomUUID().slice(0, 8)}`,
          body: "Reply to a ticket that does not exist.",
          author: { type: "agent" },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("ticket_not_found");
  });

  it("acks an unparseable payload (no reference / body)", async () => {
    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send({ event: "conversation.opened", foo: "bar" });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("not_a_reply");
  });

  it("is idempotent: a redelivered reply id is not posted twice", async () => {
    const ticket = await createTicket({ status: "open" });
    const replyId = `rep_${randomUUID().slice(0, 8)}`;
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: replyId,
        body: "Idempotent reply body.",
        author: { type: "agent" },
      },
    };

    const first = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.ticketNumber).toBe(ticket.ticketNumber);

    const second = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id));
    expect(messages).toHaveLength(1);
  });

  it("releases the dedup claim on failure so a retry can reprocess", async () => {
    const ticket = await createTicket({ status: "open" });
    const replyId = `rep_${randomUUID().slice(0, 8)}`;
    const externalId = `ticketdesk_reply_${replyId}`;
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: replyId,
        body: "Reply that fails on first delivery.",
        author: { type: "agent" },
      },
    };

    // Force the message insert to blow up after the dedup row is claimed.
    // First db.insert call (the dedup claim) passes through; the second (the
    // ticket message) throws to simulate a transient failure.
    const realInsert = db.insert.bind(db);
    let insertCalls = 0;
    const insertSpy = vi
      .spyOn(db, "insert")
      .mockImplementation((...args: Parameters<typeof db.insert>) => {
        insertCalls += 1;
        if (insertCalls === 2) {
          throw new Error("simulated transient insert failure");
        }
        return realInsert(...args);
      });

    const failed = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send(payload);
    expect(failed.status).toBe(500);
    insertSpy.mockRestore();

    // The claim must have been released — no lingering webhook_logs row.
    const afterFailure = await db
      .select()
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId));
    expect(afterFailure).toHaveLength(0);

    // No message should have been written either.
    const noMessages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id));
    expect(noMessages).toHaveLength(0);

    // Retry succeeds and posts exactly one message.
    const retry = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body.ticketNumber).toBe(ticket.ticketNumber);

    const messages = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticket.id));
    expect(messages).toHaveLength(1);
  });
});
