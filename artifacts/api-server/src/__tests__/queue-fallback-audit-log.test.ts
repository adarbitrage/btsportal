import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, auditLogTable, emailTemplatesTable, smsTemplatesTable, usersTable } from "@workspace/db";
import { eq, and, gt, inArray, desc } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  isRedisReady: vi.fn(() => false),
  getRedisConnection: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    status: "end",
  })),
  createRedisConnection: vi.fn(),
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(async () => false),
}));

import { CommunicationService } from "../lib/communication-service";

const TEST_TAG = `qfb-audit-${randomUUID().slice(0, 8)}`;
const EMAIL_TEMPLATE_SLUG = `${TEST_TAG}-email`;
const SMS_TEMPLATE_SLUG = `${TEST_TAG}-sms`;
const seededUserIds: number[] = [];
let baselineAuditId = 0;

beforeAll(async () => {
  const [maxRow] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.id))
    .limit(1);
  baselineAuditId = maxRow?.id ?? 0;

  await db.insert(emailTemplatesTable).values({
    slug: EMAIL_TEMPLATE_SLUG,
    name: "Queue Fallback Audit Test",
    subject: "Test Subject",
    htmlBody: "<p>Hi</p>",
    textBody: "Hi",
    category: "transactional",
    active: true,
  });

  await db.insert(smsTemplatesTable).values({
    slug: SMS_TEMPLATE_SLUG,
    name: "Queue Fallback Audit SMS Test",
    body: "Test SMS body",
    active: true,
  });
});

afterAll(async () => {
  await db
    .delete(auditLogTable)
    .where(
      and(
        gt(auditLogTable.id, baselineAuditId),
        eq(auditLogTable.actionType, "queue_fallback"),
      ),
    );
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.slug, EMAIL_TEMPLATE_SLUG));
  await db.delete(smsTemplatesTable).where(eq(smsTemplatesTable.slug, SMS_TEMPLATE_SLUG));
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

async function findRecentFallbackEntry(channel: "email" | "sms", recipient: string) {
  // Give the fire-and-forget audit insert a moment to land.
  for (let i = 0; i < 20; i++) {
    const rows = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          gt(auditLogTable.id, baselineAuditId),
          eq(auditLogTable.actionType, "queue_fallback"),
          eq(auditLogTable.entityType, "communication"),
        ),
      );
    const match = rows.find((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return meta.channel === channel && meta.recipient === recipient;
    });
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

describe("queueEmail / queueSms write a queue_fallback row to the audit log", () => {
  it("writes an audit_log row with channel/recipient/reason metadata when the email queue is unavailable", async () => {
    const recipient = `${TEST_TAG}-email-recipient@example.test`;

    const outcome = await CommunicationService.queueEmail({
      templateSlug: EMAIL_TEMPLATE_SLUG,
      to: recipient,
    });

    // Without SendGrid configured the direct send is reported as skipped, but
    // the fallback-into-direct path was still taken — that's what we audit.
    expect(["sent_direct", "skipped", "failed"]).toContain(outcome.result);

    const entry = await findRecentFallbackEntry("email", recipient);
    expect(entry).not.toBeNull();
    expect(entry!.entityType).toBe("communication");
    expect(entry!.description).toMatch(/Email queue unavailable/);
    expect(entry!.description).toContain(recipient);
    const meta = entry!.metadata as Record<string, unknown>;
    expect(meta.channel).toBe("email");
    expect(meta.recipient).toBe(recipient);
    expect(meta.reason).toBe("queue_unavailable");
  });

  it("writes an audit_log row when the sms queue is unavailable", async () => {
    const recipient = `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

    const outcome = await CommunicationService.queueSms({
      templateSlug: SMS_TEMPLATE_SLUG,
      to: recipient,
    });
    expect(["sent_direct", "skipped", "failed"]).toContain(outcome.result);

    const entry = await findRecentFallbackEntry("sms", recipient);
    expect(entry).not.toBeNull();
    expect(entry!.entityType).toBe("communication");
    expect(entry!.description).toMatch(/SMS queue unavailable/);
    expect(entry!.description).toContain(recipient);
    const meta = entry!.metadata as Record<string, unknown>;
    expect(meta.channel).toBe("sms");
    expect(meta.recipient).toBe(recipient);
    expect(meta.reason).toBe("queue_unavailable");
  });
});
