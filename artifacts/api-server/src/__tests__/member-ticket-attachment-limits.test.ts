import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Task: lock in the ticket upload limits wiring. The shared validator
// (validateTicketAttachment in @workspace/support-config) has its own unit
// tests, but this pins the actual server-side guard in
// POST /tickets/:id/messages — an oversized file or an unsupported content
// type must be rejected with a 400 AND must not insert any ticket_attachments
// row. Without this, a refactor could silently drop the server guard while the
// validator's unit tests stayed green.

import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
  ticketAttachmentsTable,
} from "@workspace/db";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@workspace/support-config";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `attach-limit-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let ownerCookie = "";
let ownerId = 0;
let ticketId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function countAttachments(): Promise<number> {
  const rows = await db
    .select()
    .from(ticketAttachmentsTable)
    .where(inArray(ticketAttachmentsTable.ticketId, seededTicketIds));
  return rows.length;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [owner] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-owner@example.test`,
      name: "Attachment Limit Owner",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  ownerId = owner.id;
  seededUserIds.push(owner.id);
  ownerCookie = signCookie(owner.id, owner.email);

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}`,
      userId: ownerId,
      subject: "Upload limit check",
      category: "other",
      priority: "normal",
      status: "open",
    })
    .returning({ id: ticketsTable.id });
  ticketId = ticket.id;
  seededTicketIds.push(ticketId);
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db
      .delete(ticketAttachmentsTable)
      .where(inArray(ticketAttachmentsTable.ticketId, seededTicketIds));
    await db
      .delete(ticketMessagesTable)
      .where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /tickets/:id/messages — attachment upload limits", () => {
  it("rejects an attachment that exceeds the size cap with a 400 and inserts no row", async () => {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", ownerCookie)
      .send({
        body: "Trying to attach a huge file.",
        attachments: [
          {
            objectPath,
            fileName: "huge.png",
            fileSize: TICKET_ATTACHMENT_MAX_BYTES + 1,
            contentType: "image/png",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
    expect(await countAttachments()).toBe(0);
  });

  it("rejects an attachment with an unsupported content type with a 400 and inserts no row", async () => {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", ownerCookie)
      .send({
        body: "Trying to attach an executable.",
        attachments: [
          {
            objectPath,
            fileName: "malware.exe",
            fileSize: 1024,
            contentType: "application/x-msdownload",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't be attached|allowed types/i);
    expect(await countAttachments()).toBe(0);
  });

  it("rejects the whole reply when one of several attachments is invalid, inserting none", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", ownerCookie)
      .send({
        body: "One good, one bad.",
        attachments: [
          {
            objectPath: `/objects/uploads/${randomUUID()}`,
            fileName: "ok.png",
            fileSize: 2048,
            contentType: "image/png",
          },
          {
            objectPath: `/objects/uploads/${randomUUID()}`,
            fileName: "bad.exe",
            fileSize: 2048,
            contentType: "application/x-msdownload",
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(await countAttachments()).toBe(0);
  });

  it("accepts a valid attachment within the cap and persists exactly one row", async () => {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", ownerCookie)
      .send({
        body: "A valid attachment.",
        attachments: [
          {
            objectPath,
            fileName: "fine.pdf",
            fileSize: TICKET_ATTACHMENT_MAX_BYTES,
            contentType: "application/pdf",
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(await countAttachments()).toBe(1);
  });
});
