/**
 * Tests the Retell webhook receiver (POST /api/webhooks/retell) that keeps the
 * voice_calls / voice_daily_usage tables in sync with Retell's call lifecycle.
 *
 * Covers:
 *  - HMAC-SHA256 signature verification (rejects bad/missing signatures,
 *    accepts a correctly-signed body).
 *  - call_started → marks the row "ongoing".
 *  - call_ended → records status/endedAt/duration/disconnectReason AND
 *    increments voice_daily_usage for the owning member (upsert).
 *  - call_analyzed → backfills summary + transcript.
 *  - Unknown call_id / missing event are no-ops that still 200.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, voiceCallsTable, voiceDailyUsageTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

// webhooks-retell.ts captures RETELL_API_KEY into a module-level const at import
// time and uses it both as the gate (must be present in production) and as the
// HMAC key for signature verification. vi.hoisted runs before the static import
// below so the router authenticates against a known key.
const RETELL_API_KEY = vi.hoisted(() => {
  const key = "test-retell-api-key";
  process.env.RETELL_API_KEY = key;
  return key;
});

import webhooksRetellRouter from "../routes/webhooks-retell";

const TEST_TAG = `webhooks-retell-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const insertedCallIds: number[] = [];

let app: Express;

// Mirror app.ts's webhook body handling: capture the raw bytes onto req.rawBody
// (used for signature verification) and parse JSON onto req.body.
function buildRetellWebhookApp(): Express {
  const a = express();
  a.use("/api/webhooks", express.raw({ type: "*/*" }), (req: Request, _res: Response, next: NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body.toString("utf-8");
      try {
        req.body = JSON.parse(req.rawBody);
      } catch {
        req.body = {};
      }
    }
    next();
  });
  a.use("/api", webhooksRetellRouter);
  return a;
}

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", RETELL_API_KEY).update(rawBody).digest("hex");
}

// Send a correctly-signed webhook with an exact, self-controlled raw body so the
// server's HMAC over req.rawBody matches the signature we compute here.
function postSigned(payload: unknown) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post("/api/webhooks/retell")
    .set("Content-Type", "application/json")
    .set("x-retell-signature", sign(raw))
    .send(raw);
}

async function seedMember(): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Retell Webhook Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function insertCall(opts: {
  userId: number;
  retellCallId: string;
  status?: string;
}): Promise<number> {
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId: opts.userId,
      retellCallId: opts.retellCallId,
      status: opts.status ?? "registered",
      startedAt: new Date(),
    })
    .returning({ id: voiceCallsTable.id });
  insertedCallIds.push(row.id);
  return row.id;
}

async function getCall(id: number) {
  const [row] = await db
    .select({
      status: voiceCallsTable.status,
      endedAt: voiceCallsTable.endedAt,
      durationSeconds: voiceCallsTable.durationSeconds,
      disconnectReason: voiceCallsTable.disconnectReason,
      summary: voiceCallsTable.summary,
      transcript: voiceCallsTable.transcript,
    })
    .from(voiceCallsTable)
    .where(eq(voiceCallsTable.id, id))
    .limit(1);
  return row;
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

async function getUsageSeconds(userId: number): Promise<number> {
  const [row] = await db
    .select({ secondsUsed: voiceDailyUsageTable.secondsUsed })
    .from(voiceDailyUsageTable)
    .where(
      and(eq(voiceDailyUsageTable.userId, userId), eq(voiceDailyUsageTable.usageDate, todayUtc())),
    )
    .limit(1);
  return row?.secondsUsed ?? 0;
}

beforeAll(() => {
  app = buildRetellWebhookApp();
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(voiceDailyUsageTable).where(inArray(voiceDailyUsageTable.userId, seededUserIds));
  }
  if (insertedCallIds.length > 0) {
    await db.delete(voiceCallsTable).where(inArray(voiceCallsTable.id, insertedCallIds));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/retell — signature verification", () => {
  it("rejects a request with no signature header", async () => {
    const raw = JSON.stringify({ event: "call_started", call: { call_id: "x" } });
    const res = await request(app)
      .post("/api/webhooks/retell")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong signature", async () => {
    const raw = JSON.stringify({ event: "call_started", call: { call_id: "x" } });
    const res = await request(app)
      .post("/api/webhooks/retell")
      .set("Content-Type", "application/json")
      .set("x-retell-signature", sign("a different body"))
      .send(raw);
    expect(res.status).toBe(401);
  });

  it("accepts a correctly-signed request", async () => {
    const res = await postSigned({ event: "call_started", call: { call_id: "unknown-call" } });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

describe("POST /api/webhooks/retell — event handling", () => {
  it("call_started marks the matching row 'ongoing'", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-started-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "registered" });

    const res = await postSigned({ event: "call_started", call: { call_id: retellCallId } });
    expect(res.status).toBe(200);

    const row = await getCall(id);
    expect(row.status).toBe("ongoing");
  });

  it("call_ended records status/endedAt/duration/disconnectReason and increments daily usage", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-ended-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "ongoing" });

    const endTs = Date.UTC(2026, 0, 15, 12, 0, 0);
    const res = await postSigned({
      event: "call_ended",
      call: {
        call_id: retellCallId,
        call_status: "ended",
        end_timestamp: endTs,
        duration_ms: 90_000, // → 90 seconds
        disconnection_reason: "user_hangup",
      },
    });
    expect(res.status).toBe(200);

    const row = await getCall(id);
    expect(row.status).toBe("ended");
    expect(row.durationSeconds).toBe(90);
    expect(row.disconnectReason).toBe("user_hangup");
    expect(row.endedAt).toBeInstanceOf(Date);
    expect((row.endedAt as Date).getTime()).toBe(endTs);

    // Usage row for today is created with the call's duration.
    expect(await getUsageSeconds(userId)).toBe(90);
  });

  it("call_ended accumulates duration into an existing daily-usage row (upsert)", async () => {
    const userId = await seedMember();

    const firstId = `${TEST_TAG}-acc1-${randomUUID()}`;
    await insertCall({ userId, retellCallId: firstId, status: "ongoing" });
    await postSigned({
      event: "call_ended",
      call: { call_id: firstId, call_status: "ended", duration_ms: 30_000 },
    });

    const secondId = `${TEST_TAG}-acc2-${randomUUID()}`;
    await insertCall({ userId, retellCallId: secondId, status: "ongoing" });
    await postSigned({
      event: "call_ended",
      call: { call_id: secondId, call_status: "ended", duration_ms: 45_000 },
    });

    // 30s + 45s accumulated onto the same (user, today) row.
    expect(await getUsageSeconds(userId)).toBe(75);
  });

  it("re-delivered call_ended for the same call counts the duration only once", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-dupe-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "ongoing" });

    const endedPayload = {
      event: "call_ended",
      call: {
        call_id: retellCallId,
        call_status: "ended",
        duration_ms: 120_000, // → 120 seconds
        disconnection_reason: "user_hangup",
      },
    };

    // First delivery accrues the call's duration.
    const first = await postSigned(endedPayload);
    expect(first.status).toBe(200);
    expect(await getUsageSeconds(userId)).toBe(120);

    // Retell re-delivers the identical event (at-least-once delivery). The
    // second delivery must be a no-op for the usage ledger.
    const second = await postSigned(endedPayload);
    expect(second.status).toBe(200);

    const row = await getCall(id);
    expect(row.durationSeconds).toBe(120);
    // Still 120 — the duplicate did NOT double-count.
    expect(await getUsageSeconds(userId)).toBe(120);
  });

  it("two concurrent call_ended deliveries for the same call count the duration only once", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-race-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "ongoing" });

    const endedPayload = {
      event: "call_ended",
      call: {
        call_id: retellCallId,
        call_status: "ended",
        duration_ms: 60_000, // → 60 seconds
        disconnection_reason: "user_hangup",
      },
    };

    // Fire both deliveries in parallel to exercise the at-least-once race:
    // both can read "no duration yet" before either writes. The atomic
    // claim (conditional UPDATE ... WHERE duration_seconds IS NULL) must let
    // exactly one win, so usage accrues once.
    const [first, second] = await Promise.all([
      postSigned(endedPayload),
      postSigned(endedPayload),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const row = await getCall(id);
    expect(row.durationSeconds).toBe(60);
    expect(await getUsageSeconds(userId)).toBe(60);
  });

  it("call_ended with no/zero duration does not create a usage row", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-zero-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "ongoing" });

    const res = await postSigned({
      event: "call_ended",
      call: { call_id: retellCallId, call_status: "ended", duration_ms: 0 },
    });
    expect(res.status).toBe(200);

    const row = await getCall(id);
    expect(row.status).toBe("ended");
    expect(await getUsageSeconds(userId)).toBe(0);
  });

  it("call_analyzed backfills summary and transcript", async () => {
    const userId = await seedMember();
    const retellCallId = `${TEST_TAG}-analyzed-${randomUUID()}`;
    const id = await insertCall({ userId, retellCallId, status: "ended" });

    const res = await postSigned({
      event: "call_analyzed",
      call: {
        call_id: retellCallId,
        transcript: "Agent: hello\nUser: hi there",
        call_analysis: { call_summary: "A short friendly greeting exchange." },
      },
    });
    expect(res.status).toBe(200);

    const row = await getCall(id);
    expect(row.summary).toBe("A short friendly greeting exchange.");
    expect(row.transcript).toBe("Agent: hello\nUser: hi there");
  });

  it("returns 200 without touching any row for an unknown call_id", async () => {
    const res = await postSigned({
      event: "call_ended",
      call: { call_id: `${TEST_TAG}-nonexistent-${randomUUID()}`, duration_ms: 5000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("returns 200 for a payload with no event", async () => {
    const res = await postSigned({ call: { call_id: "whatever" } });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
