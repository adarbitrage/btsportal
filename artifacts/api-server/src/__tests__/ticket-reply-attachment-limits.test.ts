import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Configurable fake object-storage metadata keyed by objectPath. Tests set the
// size/contentType the "stored" object should report, so the reply route
// validates against this (not the client-declared values).
const fakeObjectMeta = new Map<string, { size: number; contentType: string }>();

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }
  class ObjectStorageService {
    async getObjectEntityMetadata(objectPath: string) {
      const meta = fakeObjectMeta.get(objectPath);
      if (!meta) throw new ObjectNotFoundError();
      return meta;
    }
  }
  return { ObjectStorageService, ObjectNotFoundError };
});

// Silence the fire-and-forget side effects so the happy path doesn't depend on
// redis / external delivery config.
vi.mock("../lib/sla", () => ({
  createSlaForTicket: vi.fn(async () => undefined),
  resumeSla: vi.fn(async () => undefined),
  recordFirstResponse: vi.fn(async () => undefined),
}));

import { db, usersTable, ticketsTable, ticketMessagesTable, ticketAttachmentsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";
import {
  COMPLIANCE_MAX_FILE_SIZE_BYTES,
  COMPLIANCE_MAX_FILES,
} from "../lib/attachment-validation";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `reply-limits-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
let memberId = 0;
let ticketId = 0;
const seededUserIds: number[] = [];
const seededTicketIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

// Registers a fake stored object and returns its objectPath for use in the
// request body.
function seedObject(size: number, contentType: string): string {
  const objectPath = `/objects/uploads/${randomUUID()}`;
  fakeObjectMeta.set(objectPath, { size, contentType });
  return objectPath;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}@example.test`,
      name: "Reply Member",
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

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      userId: memberId,
      ticketNumber: `T-${randomUUID().slice(0, 8)}`,
      subject: "Reply attachment limits",
      status: "open",
      category: "general",
      priority: "normal",
    })
    .returning({ id: ticketsTable.id });
  ticketId = ticket.id;
  seededTicketIds.push(ticket.id);
});

afterAll(async () => {
  if (seededTicketIds.length > 0) {
    await db.delete(ticketAttachmentsTable).where(inArray(ticketAttachmentsTable.ticketId, seededTicketIds));
    await db.delete(ticketMessagesTable).where(inArray(ticketMessagesTable.ticketId, seededTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, seededTicketIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  fakeObjectMeta.clear();
});

describe("POST /tickets/:id/messages — reply attachment limits", () => {
  it("accepts a valid reply and persists verified metadata", async () => {
    const objectPath = seedObject(2048, "image/png");
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({
        body: "Here is my creative.",
        // Client-declared size is a lie; the server must store the verified 2048.
        attachments: [{ objectPath, fileName: "creative.png", fileSize: 1, contentType: "image/png" }],
      });

    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.objectPath, objectPath));
    expect(rows.length).toBe(1);
    expect(rows[0].fileSize).toBe(2048);
    expect(rows[0].contentType).toBe("image/png");
    expect(rows[0].messageId).toBe(res.body.id);
  });

  it("rejects a reply attachment whose actual stored size exceeds the per-file limit", async () => {
    const objectPath = seedObject(COMPLIANCE_MAX_FILE_SIZE_BYTES + 1, "application/zip");
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({
        body: "Big file",
        attachments: [{ objectPath, fileName: "huge.zip", fileSize: 10, contentType: "application/zip" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
    const rows = await db
      .select()
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.objectPath, objectPath));
    expect(rows.length).toBe(0);
  });

  it("rejects a reply attachment with a disallowed content type", async () => {
    const objectPath = seedObject(1024, "application/x-msdownload");
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({
        body: "Sketchy file",
        // Spoofed allowed contentType, but the stored object is an executable.
        attachments: [{ objectPath, fileName: "malware.exe", fileSize: 1024, contentType: "application/pdf" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported file type/i);
  });

  it("rejects more reply files than the per-reply cap", async () => {
    const attachments = Array.from({ length: COMPLIANCE_MAX_FILES + 1 }, (_, i) => ({
      objectPath: `/objects/uploads/never-checked-${i}`,
      fileName: `f${i}.png`,
      fileSize: 1,
      contentType: "image/png",
    }));
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Too many", attachments });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many files/i);
  });

  it("rejects a reply attachment pointing at a non-existent object", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({
        body: "Ghost file",
        attachments: [{ objectPath: "/objects/uploads/does-not-exist", fileName: "ghost.png", fileSize: 100, contentType: "image/png" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't verify/i);
  });

  it("accepts a reply with no attachments", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/messages`)
      .set("Cookie", memberCookie)
      .send({ body: "Just text." });

    expect(res.status).toBe(201);
  });
});
