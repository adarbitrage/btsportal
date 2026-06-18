import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, voiceCallsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import voiceRouter from "../routes/voice";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `voice-calls-history-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

async function seedMember(): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Voice Calls History Test",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

async function insertCall(opts: {
  userId: number;
  startedAt: Date;
  endedAt: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId: opts.userId,
      retellCallId: `${TEST_TAG}-${randomUUID()}`,
      status: opts.endedAt ? "ended" : "ongoing",
      startedAt: opts.startedAt,
      endedAt: opts.endedAt,
      durationSeconds: opts.endedAt ? 60 : null,
    })
    .returning({ id: voiceCallsTable.id });
  return row.id;
}

beforeAll(() => {
  app = buildTestAppWithRouters([voiceRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(voiceCallsTable).where(inArray(voiceCallsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /voice/calls — member call history", () => {
  it("returns only the authenticated member's own ended calls", async () => {
    const memberA = await seedMember();
    const memberB = await seedMember();

    const base = Date.now();
    const aCall1 = await insertCall({
      userId: memberA.id,
      startedAt: new Date(base - 3000),
      endedAt: new Date(base - 2000),
    });
    const aCall2 = await insertCall({
      userId: memberA.id,
      startedAt: new Date(base - 1000),
      endedAt: new Date(base - 500),
    });
    // Member B's call must never leak into member A's history.
    await insertCall({
      userId: memberB.id,
      startedAt: new Date(base - 1500),
      endedAt: new Date(base - 1200),
    });

    const res = await request(app)
      .get("/api/voice/calls")
      .set("Cookie", memberA.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([aCall2, aCall1]); // newest first
    expect(ids).toHaveLength(2);
  });

  it("excludes calls that have not ended (ended_at IS NULL)", async () => {
    const member = await seedMember();
    const base = Date.now();
    const endedId = await insertCall({
      userId: member.id,
      startedAt: new Date(base - 2000),
      endedAt: new Date(base - 1500),
    });
    // Ongoing (not ended) call must be excluded.
    await insertCall({
      userId: member.id,
      startedAt: new Date(base - 1000),
      endedAt: null,
    });

    const res = await request(app)
      .get("/api/voice/calls")
      .set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([endedId]);
    expect(res.body.has_more).toBe(false);
  });

  it("clamps the limit to the 1-50 range", async () => {
    const member = await seedMember();

    const tooHigh = await request(app)
      .get("/api/voice/calls?limit=999")
      .set("Cookie", member.cookie);
    expect(tooHigh.status).toBe(200);
    expect(tooHigh.body.limit).toBe(50);

    const tooLow = await request(app)
      .get("/api/voice/calls?limit=0")
      .set("Cookie", member.cookie);
    expect(tooLow.status).toBe(200);
    expect(tooLow.body.limit).toBe(1);

    const negative = await request(app)
      .get("/api/voice/calls?limit=-5")
      .set("Cookie", member.cookie);
    expect(negative.status).toBe(200);
    expect(negative.body.limit).toBe(1);
  });

  it("caps returned rows at 50 even when more exist and limit exceeds the max", async () => {
    const member = await seedMember();
    const base = Date.now();
    // Seed 55 ended calls so a limit=999 request must clamp to 50 rows.
    for (let i = 0; i < 55; i++) {
      await insertCall({
        userId: member.id,
        startedAt: new Date(base - i * 1000),
        endedAt: new Date(base - i * 1000 + 500),
      });
    }

    const res = await request(app)
      .get("/api/voice/calls?limit=999")
      .set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
    expect(res.body.calls).toHaveLength(50);
    expect(res.body.has_more).toBe(true);
  });

  it("sets has_more when more rows exist beyond the limit, and paginates via offset", async () => {
    const member = await seedMember();
    const base = Date.now();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Older startedAt for higher i so newest-first ordering is i=0 .. i=2.
      ids.push(
        await insertCall({
          userId: member.id,
          startedAt: new Date(base - i * 1000),
          endedAt: new Date(base - i * 1000 + 500),
        }),
      );
    }
    // newest-first: ids[0], ids[1], ids[2]

    const firstPage = await request(app)
      .get("/api/voice/calls?limit=2")
      .set("Cookie", member.cookie);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.limit).toBe(2);
    expect(firstPage.body.has_more).toBe(true);
    expect((firstPage.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([
      ids[0],
      ids[1],
    ]);

    const secondPage = await request(app)
      .get("/api/voice/calls?limit=2&offset=2")
      .set("Cookie", member.cookie);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.offset).toBe(2);
    expect(secondPage.body.has_more).toBe(false);
    expect((secondPage.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([ids[2]]);
  });
});
