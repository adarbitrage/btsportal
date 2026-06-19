import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Mock the object-storage layer so the download endpoint can stream a file
// without real bucket credentials. getObjectEntityFile is identity-ish (returns
// a token we recognise), downloadObject returns a Response with a fixed body.
vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }
  class ObjectStorageService {
    async getObjectEntityFile(objectPath: string) {
      if (!objectPath || !objectPath.startsWith("/objects/")) {
        throw new ObjectNotFoundError();
      }
      return { __path: objectPath };
    }
    async downloadObject() {
      return new Response("FAKE_FILE_BYTES", {
        headers: { "Content-Type": "image/png" },
      });
    }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

import {
  db,
  usersTable,
  ticketsTable,
  ticketMessagesTable,
  ticketAttachmentsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `member-attach-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let ownerCookie = "";
let otherCookie = "";
let ownerId = 0;
let otherId = 0;
let ticketId = 0;
let attachmentId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [owner] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-owner@example.test`,
      name: "Attachment Owner",
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

  const [other] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-other@example.test`,
      name: "Other Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  otherId = other.id;
  seededUserIds.push(other.id);
  otherCookie = signCookie(other.id, other.email);

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: `BTS-${TEST_TAG}`,
      userId: ownerId,
      subject: "Compliance Review submission",
      category: "compliance_review",
      priority: "normal",
      status: "open",
    })
    .returning({ id: ticketsTable.id });
  ticketId = ticket.id;
  seededTicketIds.push(ticketId);

  await db.insert(ticketMessagesTable).values({
    ticketId,
    senderType: "member",
    body: "Please review my creative.",
    isInternal: false,
  });

  const [attachment] = await db
    .insert(ticketAttachmentsTable)
    .values({
      ticketId,
      objectPath: `/objects/uploads/${randomUUID()}`,
      fileName: "creative.png",
      fileSize: 2048,
      contentType: "image/png",
    })
    .returning({ id: ticketAttachmentsTable.id });
  attachmentId = attachment.id;
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

describe("GET /tickets/:id (member) — attachments", () => {
  it("includes attachment metadata without exposing the storage path", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attachments)).toBe(true);
    expect(res.body.attachments.length).toBe(1);
    const att = res.body.attachments[0];
    expect(att.id).toBe(attachmentId);
    expect(att.fileName).toBe("creative.png");
    expect(att.fileSize).toBe(2048);
    expect(att.contentType).toBe("image/png");
    // The raw object-storage path must never reach the client.
    expect(att.objectPath).toBeUndefined();
  });

  it("does not let another member read the ticket or its attachments", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });
});

describe("GET /tickets/:id/attachments/:attachmentId/download", () => {
  it("streams the file to the ticket owner", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("FAKE_FILE_BYTES");
  });

  it("returns 404 when a non-owner attempts the download", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`)
      .set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an attachment that does not belong to the ticket", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/99999999/download`)
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(
      `/api/tickets/${ticketId}/attachments/${attachmentId}/download`,
    );
    expect(res.status).toBe(401);
  });
});
