import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Configurable fake object-storage metadata keyed by objectPath. Tests set the
// size/contentType the "stored" object should report, so the compliance route
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
vi.mock("../lib/ghl-queue", () => ({ queueGHLSync: vi.fn(async () => "job") }));
vi.mock("../lib/ticketdesk-queue", () => ({ queueTicketDeskDelivery: vi.fn(async () => undefined) }));
vi.mock("../lib/webhook-events", () => ({ emitWebhookEvent: vi.fn(async () => undefined) }));
vi.mock("../lib/communication-service", () => ({
  CommunicationService: { queueEmail: vi.fn(async () => undefined) },
}));
vi.mock("../lib/sla", () => ({
  createSlaForTicket: vi.fn(async () => undefined),
  resumeSla: vi.fn(async () => undefined),
  recordFirstResponse: vi.fn(async () => undefined),
}));
vi.mock("../lib/ticket-routing", () => ({ autoRouteTicket: vi.fn(async () => undefined) }));

import { db, usersTable, ticketsTable, ticketMessagesTable, ticketAttachmentsTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";
import { COMPLIANCE_MAX_FILES } from "../lib/attachment-validation";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@workspace/support-config";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `compliance-limits-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie = "";
let memberId = 0;
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

const baseBody = {
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
      name: "Compliance Member",
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

describe("POST /tickets/compliance — attachment limits", () => {
  it("accepts a valid submission and persists verified metadata", async () => {
    const objectPath = seedObject(2048, "image/png");
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({
        ...baseBody,
        attachments: [
          // Client-declared size is a lie; the server must store the verified 2048.
          { objectPath, fileName: "creative.png", fileSize: 1, contentType: "image/png" },
        ],
      });

    expect(res.status).toBe(201);
    const ticketId = res.body.ticketId as number;
    expect(typeof ticketId).toBe("number");
    seededTicketIds.push(ticketId);

    const rows = await db
      .select()
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.ticketId, ticketId));
    expect(rows.length).toBe(1);
    expect(rows[0].fileSize).toBe(2048);
    expect(rows[0].contentType).toBe("image/png");
  });

  it("rejects an attachment whose actual stored size exceeds the per-file limit", async () => {
    const objectPath = seedObject(TICKET_ATTACHMENT_MAX_BYTES + 1, "application/zip");
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({
        ...baseBody,
        // Member spoofs a tiny declared size, but the server checks real size.
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

  it("rejects an attachment with a disallowed content type", async () => {
    const objectPath = seedObject(1024, "application/x-msdownload");
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({
        ...baseBody,
        // Spoofed allowed contentType, but the stored object is an executable.
        attachments: [{ objectPath, fileName: "malware.exe", fileSize: 1024, contentType: "application/pdf" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't be attached/i);
  });

  it("rejects more files than the per-submission cap", async () => {
    const attachments = Array.from({ length: COMPLIANCE_MAX_FILES + 1 }, (_, i) => ({
      objectPath: `/objects/uploads/never-checked-${i}`,
      fileName: `f${i}.png`,
      fileSize: 1,
      contentType: "image/png",
    }));
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({ ...baseBody, attachments });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too many files/i);
  });

  it("rejects an attachment pointing at a non-existent object", async () => {
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({
        ...baseBody,
        attachments: [{ objectPath: "/objects/uploads/does-not-exist", fileName: "ghost.png", fileSize: 100, contentType: "image/png" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't verify/i);
  });

  it("accepts a submission with no attachments", async () => {
    const res = await request(app)
      .post("/api/tickets/compliance")
      .set("Cookie", memberCookie)
      .send({ ...baseBody });

    expect(res.status).toBe(201);
    seededTicketIds.push(res.body.ticketId as number);
  });
});
