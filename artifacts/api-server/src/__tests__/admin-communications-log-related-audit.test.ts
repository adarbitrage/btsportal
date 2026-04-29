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
  commsLogId?: number;
}): Promise<number> {
  const meta: Record<string, unknown> = { channel: args.channel };
  if (args.recipient !== null) meta.recipient = args.recipient;
  if (args.reason) meta.reason = args.reason;
  if (args.commsLogId != null) meta.commsLogId = args.commsLogId;
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

  it("links a fallback by exact commsLogId even when it's outside the ±2 minute window", async () => {
    // The whole point of the commsLogId stamp: a slow direct-send that took
    // 10 minutes to finish would never link via the time-window heuristic,
    // but it does link via the exact-id match.
    const recipient = `${TEST_TAG}-exact-far@example.test`;
    const sendAt = new Date();
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });
    const fallbackId = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      commsLogId: logId,
      createdAt: new Date(sendAt.getTime() - 10 * 60 * 1000),
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).toContain(fallbackId);
  });

  it("prefers exact commsLogId match over a time-window heuristic match for a different send", async () => {
    // Back-to-back sends to the same recipient on the same channel: under
    // the heuristic both fallbacks would link to both logs. With commsLogId
    // stamping, each log only links to its own fallback.
    const recipient = `${TEST_TAG}-back-to-back@example.test`;
    const sendAt = new Date();

    // Log A and its fallback (close together, both stamped with A's id).
    const logIdA = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });
    const fallbackForA = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      commsLogId: logIdA,
      createdAt: new Date(sendAt.getTime() - 500),
    });

    // Log B fired ~30 seconds later (well within the heuristic window) with
    // its own fallback stamped with B's id.
    const sendAtB = new Date(sendAt.getTime() + 30 * 1000);
    const logIdB = await insertCommsLog({ channel: "email", recipient, createdAt: sendAtB });
    const fallbackForB = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      commsLogId: logIdB,
      createdAt: new Date(sendAtB.getTime() - 500),
    });

    const resA = await request(app)
      .get(`/api/admin/communications/log/${logIdA}`)
      .set("Cookie", adminCookie);
    expect(resA.status).toBe(200);
    const idsA = resA.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(idsA).toContain(fallbackForA);
    // The other send's fallback carries a non-matching commsLogId, so the
    // heuristic branch (which requires commsLogId IS NULL) cannot pull it in
    // and pollute log A's relatedAudit.
    expect(idsA).not.toContain(fallbackForB);

    const resB = await request(app)
      .get(`/api/admin/communications/log/${logIdB}`)
      .set("Cookie", adminCookie);
    expect(resB.status).toBe(200);
    const idsB = resB.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(idsB).toContain(fallbackForB);
    expect(idsB).not.toContain(fallbackForA);
  });

  it("still links legacy fallback rows (no commsLogId) via the time-window heuristic", async () => {
    // Pre-existing fallback rows in the DB don't have metadata.commsLogId.
    // They must still surface for their corresponding comms-log row.
    const recipient = `${TEST_TAG}-legacy@example.test`;
    const sendAt = new Date();
    const legacyFallbackId = await insertFallback({
      channel: "email",
      recipient,
      reason: "queue_unavailable",
      createdAt: new Date(sendAt.getTime() - 1000),
      // commsLogId intentionally omitted to simulate a legacy row.
    });
    const logId = await insertCommsLog({ channel: "email", recipient, createdAt: sendAt });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).toContain(legacyFallbackId);
  });
});
