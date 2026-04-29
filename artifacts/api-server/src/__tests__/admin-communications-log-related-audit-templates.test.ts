import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable, communicationLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import adminCommunicationsRouter from "../routes/admin-communications";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `comms-related-tpl-${randomUUID().slice(0, 8)}`;

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
      name: "Comms Related Audit Templates Admin",
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function insertCommsLog(args: {
  channel: "email" | "sms";
  recipient: string;
  templateSlug?: string | null;
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
      templateSlug: args.templateSlug ?? null,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: communicationLogTable.id });
  insertedCommsLogIds.push(row.id);
  return row.id;
}

async function insertTemplateAudit(args: {
  actionType: "template_create" | "template_update" | "template_delete";
  channel: "email" | "sms";
  templateSlug: string;
  changedFields?: string[];
  createdAt?: Date;
}): Promise<number> {
  const entityType = args.channel === "email" ? "email_template" : "sms_template";
  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: args.actionType,
      entityType,
      entityId: args.templateSlug,
      description: `${args.actionType} ${args.templateSlug}`,
      metadata: {
        templateSlug: args.templateSlug,
        templateName: `Name for ${args.templateSlug}`,
        channel: args.channel,
      },
      changeDiff: {
        before: { subject: "Old subject" },
        after: { subject: "New subject" },
        changedFields: args.changedFields ?? ["subject"],
      },
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: auditLogTable.id });
  insertedAuditIds.push(row.id);
  return row.id;
}

describe("GET /api/admin/communications/log/:id relatedAudit (template edits)", () => {
  it("includes template_update rows that match channel + slug within 24h before send", async () => {
    const slug = `${TEST_TAG}-slug-match`;
    const sendAt = new Date();
    // Edit happened ~6 hours before the send.
    const editId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: slug,
      changedFields: ["subject", "htmlBody"],
      createdAt: new Date(sendAt.getTime() - 6 * 60 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "email",
      recipient: `${TEST_TAG}-match@example.test`,
      templateSlug: slug,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).toContain(editId);
    const matched = res.body.relatedAudit.find((r: { id: number }) => r.id === editId);
    expect(matched).toMatchObject({
      actionType: "template_update",
      entityType: "email_template",
    });
    expect(matched.metadata?.templateSlug).toBe(slug);
    expect(matched.changeDiff?.changedFields).toEqual(["subject", "htmlBody"]);
  });

  it("includes template_create and template_delete rows when slug + channel match", async () => {
    const slug = `${TEST_TAG}-create-delete`;
    const sendAt = new Date();
    const createId = await insertTemplateAudit({
      actionType: "template_create",
      channel: "sms",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() - 60 * 60 * 1000),
    });
    const deleteId = await insertTemplateAudit({
      actionType: "template_delete",
      channel: "sms",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() - 30 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "sms",
      recipient: "+15555550100",
      templateSlug: slug,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).toContain(createId);
    expect(ids).toContain(deleteId);
  });

  it("excludes template edits for the wrong channel", async () => {
    const slug = `${TEST_TAG}-wrong-channel`;
    const sendAt = new Date();
    // Email template edit, but the comms log is an SMS send → must not link.
    const wrongChannelId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() - 60 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "sms",
      recipient: "+15555550101",
      templateSlug: slug,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(wrongChannelId);
  });

  it("excludes template edits for a different slug", async () => {
    const sendSlug = `${TEST_TAG}-send-slug`;
    const otherSlug = `${TEST_TAG}-other-slug`;
    const sendAt = new Date();
    const wrongSlugId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: otherSlug,
      createdAt: new Date(sendAt.getTime() - 60 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "email",
      recipient: `${TEST_TAG}-other@example.test`,
      templateSlug: sendSlug,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(wrongSlugId);
  });

  it("excludes template edits older than the 24h before-send window", async () => {
    const slug = `${TEST_TAG}-window`;
    const sendAt = new Date();
    // 2 days before the send — outside the 24h window.
    const tooOldId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() - 48 * 60 * 60 * 1000),
    });
    // 30 minutes after the send — outside the small after-grace window
    // (which is only 2 minutes), so must not link either.
    const tooNewId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() + 30 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "email",
      recipient: `${TEST_TAG}-window@example.test`,
      templateSlug: slug,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(tooOldId);
    expect(ids).not.toContain(tooNewId);
  });

  it("does not surface template edits when the comms log row has no templateSlug", async () => {
    const sendAt = new Date();
    const slug = `${TEST_TAG}-orphan`;
    const orphanEditId = await insertTemplateAudit({
      actionType: "template_update",
      channel: "email",
      templateSlug: slug,
      createdAt: new Date(sendAt.getTime() - 60 * 60 * 1000),
    });
    const logId = await insertCommsLog({
      channel: "email",
      recipient: `${TEST_TAG}-orphan@example.test`,
      templateSlug: null,
      createdAt: sendAt,
    });

    const res = await request(app)
      .get(`/api/admin/communications/log/${logId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.relatedAudit.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(orphanEditId);
  });
});
