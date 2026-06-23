/**
 * Tests the signature-enforcement branches of the inbound TicketDesk webhook
 * (POST /api/webhooks/ticketdesk).
 *
 * The route fails closed (503) in production when TICKETDESK_WEBHOOK_SECRET is
 * missing, and when the secret IS set it requires a valid HMAC-SHA256 signature
 * (over the raw body) in the X-TicketDesk-Signature header — a wrong or absent
 * signature is rejected with 401. These tests lock that contract in so a future
 * refactor can't silently accept unauthenticated replies.
 *
 * Note: the test app does not install the raw-body middleware, so the route
 * falls back to `JSON.stringify(req.body)` for verification. We therefore sign
 * that exact serialization and send it as the request body so the bytes the
 * route hashes match the bytes we signed (matching verifyWebhookSignature).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
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
import { inArray, like } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const TEST_TAG = `td-sig-${randomUUID().slice(0, 8)}`;
const WEBHOOK_SECRET = `whsec_${randomUUID().replace(/-/g, "")}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberUserId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

const ORIGINAL_SECRET = process.env.TICKETDESK_WEBHOOK_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function sign(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function createTicket(): Promise<{ id: number; ticketNumber: string }> {
  const ticketNumber = `BTS-${Math.floor(100000 + Math.random() * 900000)}`;
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber,
      userId: memberUserId,
      category: "technical",
      priority: "normal",
      status: "open",
      subject: "Signature enforcement test",
    })
    .returning({ id: ticketsTable.id, ticketNumber: ticketsTable.ticketNumber });
  seededTicketIds.push(ticket.id);
  return ticket;
}

beforeAll(async () => {
  // Configure the shared secret BEFORE the route verifies — the client reads it
  // lazily via getWebhookSecret(), so setting it here is sufficient.
  process.env.TICKETDESK_WEBHOOK_SECRET = WEBHOOK_SECRET;

  app = buildTestAppWithRouters([ticketsRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Signature Test Member",
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

  // Restore env so we don't leak config into other test files.
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.TICKETDESK_WEBHOOK_SECRET;
  } else {
    process.env.TICKETDESK_WEBHOOK_SECRET = ORIGINAL_SECRET;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe("POST /api/webhooks/ticketdesk — signature enforcement", () => {
  it("accepts a reply carrying a valid signature (200)", async () => {
    const ticket = await createTicket();
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Signed agent reply.",
        author: { type: "agent" },
      },
    };
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .set("Content-Type", "application/json")
      .set("X-TicketDesk-Signature", sign(rawBody, WEBHOOK_SECRET))
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.ticketNumber).toBe(ticket.ticketNumber);
  });

  it("accepts a valid signature carrying the 'sha256=' prefix (200)", async () => {
    const ticket = await createTicket();
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Signed agent reply with prefix.",
        author: { type: "agent" },
      },
    };
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .set("Content-Type", "application/json")
      .set("X-TicketDesk-Signature", `sha256=${sign(rawBody, WEBHOOK_SECRET)}`)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.ticketNumber).toBe(ticket.ticketNumber);
  });

  it("rejects a reply signed with the wrong secret (401)", async () => {
    const ticket = await createTicket();
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Reply signed with the wrong key.",
        author: { type: "agent" },
      },
    };
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .set("Content-Type", "application/json")
      .set("X-TicketDesk-Signature", sign(rawBody, "the-wrong-secret"))
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("rejects a reply whose body was tampered after signing (401)", async () => {
    const ticket = await createTicket();
    const signedPayload = JSON.stringify({
      reference: ticket.ticketNumber,
      reply: { id: "rep_signed", body: "original", author: { type: "agent" } },
    });
    const tamperedPayload = JSON.stringify({
      reference: ticket.ticketNumber,
      reply: { id: "rep_signed", body: "tampered", author: { type: "agent" } },
    });

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .set("Content-Type", "application/json")
      .set("X-TicketDesk-Signature", sign(signedPayload, WEBHOOK_SECRET))
      .send(tamperedPayload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("rejects a reply with no signature header (401)", async () => {
    const ticket = await createTicket();
    const payload = {
      reference: ticket.ticketNumber,
      reply: {
        id: `rep_${randomUUID().slice(0, 8)}`,
        body: "Reply with no signature at all.",
        author: { type: "agent" },
      },
    };

    const res = await request(app)
      .post("/api/webhooks/ticketdesk")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("fails closed with 503 in production when the secret is missing", async () => {
    const savedSecret = process.env.TICKETDESK_WEBHOOK_SECRET;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.TICKETDESK_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";

    try {
      const res = await request(app)
        .post("/api/webhooks/ticketdesk")
        .send({
          reference: "BTS-000000",
          reply: { id: "rep_prod", body: "x", author: { type: "agent" } },
        });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("TicketDesk webhook not configured");
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      if (savedSecret === undefined) {
        delete process.env.TICKETDESK_WEBHOOK_SECRET;
      } else {
        process.env.TICKETDESK_WEBHOOK_SECRET = savedSecret;
      }
    }
  });
});
