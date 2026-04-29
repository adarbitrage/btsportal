import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `qfb-events-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const insertedAuditIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(role: "super_admin" | "member"): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${role}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedUser("super_admin");
  const member = await seedUser("member");
  adminCookie = admin.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  if (insertedAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, insertedAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

async function insertFallbackRow(args: {
  channel: "email" | "sms" | "carrier-pigeon";
  recipient?: string | null;
  reason?: string | null;
  entityType?: string;
  createdAt?: Date;
}): Promise<number> {
  const meta: Record<string, unknown> = { channel: args.channel };
  if (args.recipient !== undefined) meta.recipient = args.recipient;
  if (args.reason !== undefined) meta.reason = args.reason;

  const [row] = await db
    .insert(auditLogTable)
    .values({
      actionType: "queue_fallback",
      entityType: args.entityType ?? "queue",
      entityId: args.channel,
      description: `Test fallback for ${args.channel}`,
      metadata: meta,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning({ id: auditLogTable.id });
  insertedAuditIds.push(row.id);
  return row.id;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/queue-fallback-events", () => {
  it("returns recent queue-fallback rows ordered newest-first with channel/recipient/reason", async () => {
    const now = Date.now();
    const oldId = await insertFallbackRow({
      channel: "email",
      recipient: `${TEST_TAG}-old@example.test`,
      reason: "queue_unavailable",
      createdAt: new Date(now - 5 * 60 * 1000),
    });
    const newId = await insertFallbackRow({
      channel: "sms",
      recipient: `+1555${TEST_TAG.slice(-7)}`,
      reason: "redis_not_ready",
      createdAt: new Date(now - 30 * 1000),
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);

    const ours = res.body.events.filter((e: { id: number }) => e.id === oldId || e.id === newId);
    expect(ours).toHaveLength(2);

    // Newest-first within our two rows.
    const indexNew = ours.findIndex((e: { id: number }) => e.id === newId);
    const indexOld = ours.findIndex((e: { id: number }) => e.id === oldId);
    expect(indexNew).toBeLessThan(indexOld);

    const newRow = ours.find((e: { id: number }) => e.id === newId);
    expect(newRow).toMatchObject({
      channel: "sms",
      reason: "redis_not_ready",
    });
    expect(newRow.recipient).toContain("+1555");
    expect(typeof newRow.createdAt).toBe("string");
  });

  it("falls back to entityId when metadata.channel is missing, and yields null channel for unknown values", async () => {
    const okId = await insertFallbackRow({
      channel: "email",
      recipient: `${TEST_TAG}-no-meta@example.test`,
      reason: null,
    });
    // Manually overwrite metadata to drop the channel field; the endpoint
    // should fall back to entity_id ("email") for channel.
    await db.update(auditLogTable)
      .set({ metadata: { recipient: `${TEST_TAG}-no-meta@example.test` } })
      .where(eq(auditLogTable.id, okId));

    const weirdId = await insertFallbackRow({
      channel: "carrier-pigeon",
      recipient: null,
      reason: null,
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const okRow = res.body.events.find((e: { id: number }) => e.id === okId);
    const weirdRow = res.body.events.find((e: { id: number }) => e.id === weirdId);
    expect(okRow.channel).toBe("email");
    expect(weirdRow.channel).toBeNull();
  });

  it("ignores audit rows with entityType !== 'queue' so each fallback shows once", async () => {
    const queueId = await insertFallbackRow({
      channel: "email",
      recipient: `${TEST_TAG}-dedupe@example.test`,
      reason: "queue_unavailable",
      entityType: "queue",
    });
    const commsId = await insertFallbackRow({
      channel: "email",
      recipient: `${TEST_TAG}-dedupe@example.test`,
      reason: "queue_unavailable",
      entityType: "communication",
    });

    const res = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=200")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ids = res.body.events.map((e: { id: number }) => e.id);
    expect(ids).toContain(queueId);
    expect(ids).not.toContain(commsId);
  });

  it("clamps limit between 1 and 200 and defaults to 50", async () => {
    const okRes = await request(app)
      .get("/api/admin/system/queue-fallback-events")
      .set("Cookie", adminCookie);
    expect(okRes.status).toBe(200);
    expect(okRes.body.limit).toBe(50);

    const tooSmall = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=0")
      .set("Cookie", adminCookie);
    expect(tooSmall.body.limit).toBe(1);

    const tooBig = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=9999")
      .set("Cookie", adminCookie);
    expect(tooBig.body.limit).toBe(200);

    const garbage = await request(app)
      .get("/api/admin/system/queue-fallback-events?limit=abc")
      .set("Cookie", adminCookie);
    expect(garbage.body.limit).toBe(50);
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/queue-fallback-events")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});
