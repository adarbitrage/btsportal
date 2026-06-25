import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Silence the fire-and-forget SLA side effects so the happy path doesn't depend
// on external config.
vi.mock("../lib/sla", () => ({
  createSlaForTicket: vi.fn(async () => undefined),
  resumeSla: vi.fn(async () => undefined),
  recordFirstResponse: vi.fn(async () => undefined),
}));

// Mock ONLY sendMemberReplyToTicketDesk; keep every other client export real so
// the route's other imports (webhook helpers, resolution signal) are unaffected.
// vi.hoisted defines the spy ahead of the hoisted vi.mock factory.
const { sendMemberReplyToTicketDesk } = vi.hoisted(() => ({
  sendMemberReplyToTicketDesk: vi.fn(async () => undefined),
}));
vi.mock("../lib/ticketdesk-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ticketdesk-client")>();
  return { ...actual, sendMemberReplyToTicketDesk };
});

import { db, usersTable, ticketsTable, ticketMessagesTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `td-mirror-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
let memberId = 0;
let memberEmail = "";
let deliveredTicketId = 0;
let pendingTicketId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

// The mirror call is fire-and-forget (void async IIFE); give its microtasks a
// tick to settle before asserting.
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  memberEmail = `${TEST_TAG}@example.test`;
  const [member] = await db
    .insert(usersTable)
    .values({
      email: memberEmail,
      name: "Mirror Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  memberId = member.id;
  seededUserIds.push(member.id);
  memberCookie = signCookie(member.id, member.email);

  const [delivered] = await db
    .insert(ticketsTable)
    .values({
      userId: memberId,
      ticketNumber: `T-${randomUUID().slice(0, 8)}`,
      subject: "Delivered ticket",
      status: "awaiting_response",
      category: "compliance_review",
      priority: "normal",
      deliveryStatus: "delivered",
    })
    .returning({ id: ticketsTable.id });
  deliveredTicketId = delivered.id;
  seededTicketIds.push(delivered.id);

  const [pending] = await db
    .insert(ticketsTable)
    .values({
      userId: memberId,
      ticketNumber: `T-${randomUUID().slice(0, 8)}`,
      subject: "Pending ticket",
      status: "open",
      category: "compliance_review",
      priority: "normal",
      deliveryStatus: "pending",
    })
    .returning({ id: ticketsTable.id });
  pendingTicketId = pending.id;
  seededTicketIds.push(pending.id);
});

beforeEach(() => {
  sendMemberReplyToTicketDesk.mockClear();
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

describe("POST /tickets/:id/messages — TicketDesk member-reply mirror", () => {
  it("mirrors the reply to TicketDesk when the ticket was delivered", async () => {
    const res = await request(app)
      .post(`/api/tickets/${deliveredTicketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Here is the extra info you asked for." });

    expect(res.status).toBe(201);
    await flush();

    expect(sendMemberReplyToTicketDesk).toHaveBeenCalledTimes(1);
    expect(sendMemberReplyToTicketDesk).toHaveBeenCalledWith(
      expect.objectContaining({
        email: memberEmail,
        messageText: "Here is the extra info you asked for.",
      }),
    );
  });

  it("does NOT mirror the reply when the ticket never reached TicketDesk", async () => {
    const res = await request(app)
      .post(`/api/tickets/${pendingTicketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Reply on an undelivered ticket." });

    expect(res.status).toBe(201);
    await flush();

    expect(sendMemberReplyToTicketDesk).not.toHaveBeenCalled();
  });

  it("still saves the member reply even when the TicketDesk mirror throws", async () => {
    sendMemberReplyToTicketDesk.mockRejectedValueOnce(new Error("TicketDesk down"));

    const res = await request(app)
      .post(`/api/tickets/${deliveredTicketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "This should persist regardless." });

    // The response must succeed and the message must be persisted even though
    // the best-effort mirror rejected.
    expect(res.status).toBe(201);
    await flush();
    expect(sendMemberReplyToTicketDesk).toHaveBeenCalledTimes(1);

    const persisted = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.id, res.body.id));
    expect(persisted.length).toBe(1);
    expect(persisted[0].body).toBe("This should persist regardless.");
  });
});
