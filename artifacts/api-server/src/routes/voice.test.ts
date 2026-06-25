import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  voiceCallsTable,
  voiceDailyUsageTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// The backfill route reads RETELL_API_KEY into a module-level const at import
// time and only queries Retell when it is truthy. vi.hoisted runs before the
// router import (ES imports are hoisted), so set the key here to exercise the
// "Retell is reachable" code path.
// ---------------------------------------------------------------------------
const { retellRetrieveMock } = vi.hoisted(() => {
  process.env.RETELL_API_KEY = "test-retell-key";
  return {
    retellRetrieveMock: vi.fn<(callId: string) => Promise<unknown>>(),
  };
});

vi.mock("retell-sdk", () => ({
  default: class Retell {
    call = { retrieve: retellRetrieveMock };
    constructor(_opts: unknown) {}
  },
}));

import { buildTestAppWithRouters } from "../__tests__/test-app";
import voiceRouter from "./voice";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `voice-backfill-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededCallIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

function today(): string {
  return new Date().toISOString().split("T")[0];
}

async function seedUser(): Promise<{ id: number; cookie: string }> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const email = `${TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Voice Caller",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, {
    expiresIn: "1h",
  });
  return { id: row.id, cookie: `access_token=${token}` };
}

async function seedCall(opts: {
  userId: number;
  status?: string;
  endedAt?: Date | null;
  durationSeconds?: number | null;
}): Promise<{ id: number; retellCallId: string }> {
  const retellCallId = `${TAG}-call-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId: opts.userId,
      retellCallId,
      status: opts.status ?? "ongoing",
      endedAt: opts.endedAt ?? null,
      durationSeconds: opts.durationSeconds ?? null,
    })
    .returning({ id: voiceCallsTable.id });
  seededCallIds.push(row.id);
  return { id: row.id, retellCallId };
}

async function getCall(id: number) {
  const [row] = await db
    .select({
      endedAt: voiceCallsTable.endedAt,
      durationSeconds: voiceCallsTable.durationSeconds,
      status: voiceCallsTable.status,
    })
    .from(voiceCallsTable)
    .where(eq(voiceCallsTable.id, id))
    .limit(1);
  return row;
}

async function getUsage(userId: number): Promise<number> {
  const [row] = await db
    .select({ secondsUsed: voiceDailyUsageTable.secondsUsed })
    .from(voiceDailyUsageTable)
    .where(eq(voiceDailyUsageTable.userId, userId))
    .limit(1);
  return row?.secondsUsed ?? 0;
}

function backfill(callId: string, cookie: string) {
  return request(app)
    .post(`/api/voice/calls/${callId}/backfill`)
    .set("Cookie", cookie);
}

beforeAll(() => {
  app = buildTestAppWithRouters([voiceRouter]);
});

beforeEach(() => {
  retellRetrieveMock.mockReset();
});

afterAll(async () => {
  if (seededCallIds.length > 0) {
    await db
      .delete(voiceCallsTable)
      .where(inArray(voiceCallsTable.id, seededCallIds));
  }
  if (seededUserIds.length > 0) {
    await db
      .delete(voiceDailyUsageTable)
      .where(inArray(voiceDailyUsageTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /voice/calls/:callId/backfill", () => {
  it("happy path: terminal Retell call writes endedAt + durationSeconds and accrues daily usage", async () => {
    const user = await seedUser();
    const call = await seedCall({ userId: user.id });

    // Retell reports the call as terminal with a measured duration.
    retellRetrieveMock.mockResolvedValueOnce({
      end_timestamp: Date.now(),
      duration_ms: 120_000, // 120 seconds
    });

    const res = await backfill(call.retellCallId, user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.duration_seconds).toBe(120);

    const stored = await getCall(call.id);
    expect(stored.endedAt).not.toBeNull();
    expect(stored.durationSeconds).toBe(120);
    expect(stored.status).toBe("ended");

    expect(await getUsage(user.id)).toBe(120);
  });

  it("idempotency: calling backfill twice only accrues usage once", async () => {
    const user = await seedUser();
    const call = await seedCall({ userId: user.id });

    retellRetrieveMock.mockResolvedValue({
      end_timestamp: Date.now(),
      duration_ms: 90_000, // 90 seconds
    });

    const first = await backfill(call.retellCallId, user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("ok");
    expect(first.body.duration_seconds).toBe(90);

    const second = await backfill(call.retellCallId, user.cookie);
    expect(second.status).toBe(200);
    // Both endedAt and durationSeconds are now set, so the route short-circuits.
    expect(second.body.status).toBe("already_finalized");

    // Usage accrued exactly once despite two backfill calls.
    expect(await getUsage(user.id)).toBe(90);
  });

  it("webhook-beats-backfill race: returns already_finalized without double-counting", async () => {
    const user = await seedUser();
    // Simulate the call_ended webhook having already finalized the call:
    // both endedAt and durationSeconds are present, and usage is accrued.
    const call = await seedCall({
      userId: user.id,
      status: "ended",
      endedAt: new Date(),
      durationSeconds: 200,
    });
    await db.insert(voiceDailyUsageTable).values({
      userId: user.id,
      usageDate: today(),
      secondsUsed: 200,
    });

    const res = await backfill(call.retellCallId, user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("already_finalized");
    // The early-return guard means Retell is never queried.
    expect(retellRetrieveMock).not.toHaveBeenCalled();

    const stored = await getCall(call.id);
    expect(stored.durationSeconds).toBe(200);
    // Usage unchanged — no double-counting.
    expect(await getUsage(user.id)).toBe(200);
  });

  it("pending: a non-terminal Retell call writes only endedAt, leaving duration null", async () => {
    const user = await seedUser();
    const call = await seedCall({ userId: user.id });

    // Retell has not finalized the call yet (no end_timestamp).
    retellRetrieveMock.mockResolvedValueOnce({
      end_timestamp: null,
      duration_ms: null,
    });

    const res = await backfill(call.retellCallId, user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_webhook");
    expect(res.body.duration_seconds).toBeNull();

    const stored = await getCall(call.id);
    expect(stored.endedAt).not.toBeNull();
    expect(stored.durationSeconds).toBeNull();
    expect(stored.status).toBe("ended");

    // No usage accrued while the call is still pending finalization.
    expect(await getUsage(user.id)).toBe(0);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post(
      `/api/voice/calls/${TAG}-noauth/backfill`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the call does not belong to the caller", async () => {
    const owner = await seedUser();
    const intruder = await seedUser();
    const call = await seedCall({ userId: owner.id });

    const res = await backfill(call.retellCallId, intruder.cookie);
    expect(res.status).toBe(404);
  });
});
