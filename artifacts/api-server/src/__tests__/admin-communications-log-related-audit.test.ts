import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable, communicationLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Toggle the result of `members:pii` checks at runtime so we can exercise
// both the unredacted (admin with PII) and redacted (admin without PII)
// paths through the same role configuration. Other permission checks keep
// their real behavior so requirePermission middleware still authorizes.
const piiState = vi.hoisted(() => ({ allowPii: true }));

vi.mock("@workspace/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/auth")>("@workspace/auth");
  return {
    ...actual,
    hasPermission: (role: unknown, perm: unknown) => {
      if (perm === "members:pii" && !piiState.allowPii) return false;
      return actual.hasPermission(role as never, perm as never);
    },
  };
});

import adminCommunicationsRouter from "../routes/admin-communications";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `comms-related-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedAuditIds: number[] = [];
const insertedCommsLogIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCommunicationsRouter]);
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Comms Related Audit Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(admin.id);
  adminCookie = signCookie(admin.id, email);
});

afterAll(async () => {
  if (insertedCommsLogIds.length > 0) {
    await db.delete(communicationLogTable).where(inArray(communicationLogTable.id, insertedCommsLogIds));
  }
  if (insertedAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, insertedAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  piiState.allowPii = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function insertCommsLog(args: {
  channel: "email" | "sms";
  recipient: string;
  createdAt?: Date;
}): Promise<number> {
  const [row] = await db
    .insert(communicationLogTable)
    .values({
      channel: args.channel,
      recipientEmail: args.channel === "email" ? args.recipient : null,
      recipientPhone: args.channel === "sms" ? args.recipient : null,
      status: "sent",
      subject: "Test send",
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: communicationLogTable.id });
  insertedCommsLogIds.push(row.id);
  return row.id;
}

async function insertFallback(args: {
  channel: "email" | "sms";
  recipient: string | null;
  reason?: string;
  createdAt?: Date;
  entityType?: string;
}): Promise<number> {
  const meta: Record<string, unknown> = { channel: args.channel };
  if (args.recipient !== null) meta.recipient = args.recipient;
  if (args.reason) meta.reason = args.reason;
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: "queue_fallback",
      entityType: args.entityType ?? "queue",
      entityId: args.channel,
      description: args.recipient
        ? `Email queue unavailable — direct-send fallback to ${args.recipient}`
        : `Email queue unavailable — direct-send fallback`,
      metadata: meta,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: auditLogTable.id });
  insertedAuditIds.push(row.id);
  return row.id;
}

describe("GET /api/admin/communications/log/:id relatedAudit", () => {
  it("includes a queue_fallback row that matches channel + recipient + close in time", async () => {
    const recipient = `${TEST_TAG}-match@example.test`;
    const sendAt = new Date();
    // Fallback fired one second before the comms_log row landed.
    const fallbackId = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      createdAt: new Date(sendAt.getTime() - 1000),
    });
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.relatedAudit)).toBe(true);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).toContain(fallbackId);
    const matched = res.body.relatedAudit.find((r: { id: number }) => r.id === fallbackId);
    expect(matched).toMatchObject({
      actionType: "queue_fallback",
      entityType: "queue",
    });
    // PII admin sees the recipient inline so the dialog can show context.
    expect(matched.metadata?.recipient).toBe(recipient);
  });

  it("excludes fallback rows for the wrong channel or wrong recipient", async () => {
    const recipient = `${TEST_TAG}-exclusion@example.test`;
    const otherRecipient = `${TEST_TAG}-other@example.test`;
    const sendAt = new Date();
    // Same time + recipient but on the other channel — must not link.
    const wrongChannelId = await insertFallback({
      channel: "sms",
      recipient,
      createdAt: new Date(sendAt.getTime() - 500),
    });
    // Same channel + time but different recipient — must not link.
    const wrongRecipientId = await insertFallback({
      channel: "email",
      recipient: otherRecipient,
      createdAt: new Date(sendAt.getTime() - 500),
    });
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(wrongChannelId);
    expect(ids).not.toContain(wrongRecipientId);
  });

  it("excludes fallback rows outside the ±2 minute window", async () => {
    const recipient = `${TEST_TAG}-window@example.test`;
    const sendAt = new Date();
    const tooOldId = await insertFallback({
      channel: "email",
      recipient,
      createdAt: new Date(sendAt.getTime() - 10 * 60 * 1000),
    });
    const tooNewId = await insertFallback({
      channel: "email",
      recipient,
      createdAt: new Date(sendAt.getTime() + 10 * 60 * 1000),
    });
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(tooOldId);
    expect(ids).not.toContain(tooNewId);
  });

  it("redacts the recipient from related audit rows when the viewer lacks members:pii", async () => {
    const recipient = `${TEST_TAG}-redact@example.test`;
    const sendAt = new Date();
    const fallbackId = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      createdAt: new Date(sendAt.getTime() - 500),
    });
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });

    piiState.allowPii = false;
    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const matched = res.body.relatedAudit.find((r: { id: number }) => r.id === fallbackId);
    expect(matched).toBeDefined();
    // The PII redactor strips `recipient` from metadata and rewrites the
    // description so the email never reaches a non-PII viewer.
    expect(matched.metadata?.recipient).toBeUndefined();
    expect(matched.description).not.toContain(recipient);
  });

  it("returns relatedAudit: [] when no audit rows match", async () => {
    const recipient = `${TEST_TAG}-empty@example.test`;
    const logId = await insertCommsLog({ channel: "email", recipient });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.relatedAudit)).toBe(true);
    expect(res.body.relatedAudit).toHaveLength(0);
  });
});
