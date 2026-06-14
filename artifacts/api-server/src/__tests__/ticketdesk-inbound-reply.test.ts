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

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const TEST_TAG = `td-inbound-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberUserId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

async function createTicket(opts: {
  status?: string;
} = {}): Promise<{ id: number; ticketNumber: string }> {
  const ticketNumber = `BTS-${Math.floor(100000 + Math.random() * 900000)}`;
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber,
      userId: memberUserId,
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
