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
  summary?: string | null;
  transcript?: string | null;
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
      summary: opts.summary ?? null,
      transcript: opts.transcript ?? null,
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

describe("GET /voice/calls — keyword search (q)", () => {
  it("matches against summary OR transcript, case-insensitively, scoped to the member", async () => {
    const memberA = await seedMember();
    const memberB = await seedMember();
    const base = Date.now();

    // Match on summary only.
    const summaryHit = await insertCall({
      userId: memberA.id,
      startedAt: new Date(base - 4000),
      endedAt: new Date(base - 3500),
      summary: "Discussed Funnel strategy and offers",
      transcript: "nothing relevant here",
    });
    // Match on transcript only.
    const transcriptHit = await insertCall({
      userId: memberA.id,
      startedAt: new Date(base - 3000),
      endedAt: new Date(base - 2500),
      summary: "general chat",
      transcript: "the FUNNEL needs work",
    });
    // No match at all.
    await insertCall({
      userId: memberA.id,
      startedAt: new Date(base - 2000),
      endedAt: new Date(base - 1500),
      summary: "weather talk",
      transcript: "small talk only",
    });
    // Member B has a matching call that must never leak.
    await insertCall({
      userId: memberB.id,
      startedAt: new Date(base - 1000),
      endedAt: new Date(base - 500),
      summary: "funnel for member B",
      transcript: "funnel funnel funnel",
    });

    // Lowercase query must match mixed-case content (case-insensitive ILIKE).
    const res = await request(app)
      .get("/api/voice/calls?q=funnel")
      .set("Cookie", memberA.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    // newest-first: transcriptHit then summaryHit; member B excluded.
    expect(ids).toEqual([transcriptHit, summaryHit]);
  });

  it("treats LIKE special characters (% and _) as literals, not wildcards", async () => {
    const member = await seedMember();
    const base = Date.now();

    // Contains a literal "50%" — should match a "50%" query.
    const literalPercent = await insertCall({
      userId: member.id,
      startedAt: new Date(base - 3000),
      endedAt: new Date(base - 2500),
      summary: "We hit a 50% conversion rate",
      transcript: "great results",
    });
    // Does NOT contain "50%" literally; only "50" followed by other chars.
    // If % were a wildcard this would wrongly match "50" + anything.
    await insertCall({
      userId: member.id,
      startedAt: new Date(base - 2000),
      endedAt: new Date(base - 1500),
      summary: "We had 50 leads today",
      transcript: "50 calls made",
    });

    const percentRes = await request(app)
      .get(`/api/voice/calls?q=${encodeURIComponent("50%")}`)
      .set("Cookie", member.cookie);
    expect(percentRes.status).toBe(200);
    const percentIds = (percentRes.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(percentIds).toEqual([literalPercent]);

    // Underscore must also be literal. Seed a row containing "a_b" and a row
    // containing "axb"; an "a_b" query must only match the literal one.
    const literalUnderscore = await insertCall({
      userId: member.id,
      startedAt: new Date(base - 1000),
      endedAt: new Date(base - 800),
      summary: "code path a_b reviewed",
      transcript: "details",
    });
    await insertCall({
      userId: member.id,
      startedAt: new Date(base - 700),
      endedAt: new Date(base - 500),
      summary: "code path axb reviewed",
      transcript: "details",
    });

    const underscoreRes = await request(app)
      .get(`/api/voice/calls?q=${encodeURIComponent("a_b")}`)
      .set("Cookie", member.cookie);
    expect(underscoreRes.status).toBe(200);
    const underscoreIds = (underscoreRes.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(underscoreIds).toEqual([literalUnderscore]);
  });
});

describe("GET /voice/calls — date range filter", () => {
  it("range=7d / range=30d exclude older rows while range=all returns everything", async () => {
    const member = await seedMember();
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    // Three ended calls at increasing age. ended_at kept recent so only
    // started_at drives the window filter.
    const recent = await insertCall({
      userId: member.id,
      startedAt: days(2),
      endedAt: days(2),
    });
    const midRange = await insertCall({
      userId: member.id,
      startedAt: days(20),
      endedAt: days(20),
    });
    const old = await insertCall({
      userId: member.id,
      startedAt: days(90),
      endedAt: days(90),
    });

    const sevenDay = await request(app)
      .get("/api/voice/calls?range=7d")
      .set("Cookie", member.cookie);
    expect(sevenDay.status).toBe(200);
    expect((sevenDay.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([recent]);

    const thirtyDay = await request(app)
      .get("/api/voice/calls?range=30d")
      .set("Cookie", member.cookie);
    expect(thirtyDay.status).toBe(200);
    expect((thirtyDay.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([
      recent,
      midRange,
    ]);

    // Default (no range) and explicit range=all both return everything.
    const all = await request(app)
      .get("/api/voice/calls?range=all")
      .set("Cookie", member.cookie);
    expect(all.status).toBe(200);
    expect((all.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([
      recent,
      midRange,
      old,
    ]);

    const defaultRange = await request(app)
      .get("/api/voice/calls")
      .set("Cookie", member.cookie);
    expect(defaultRange.status).toBe(200);
    expect((defaultRange.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([
      recent,
      midRange,
      old,
    ]);
  });
});

describe("GET /voice/calls — keyword + date range combined", () => {
  it("applies q AND range together, scoped to the member", async () => {
    const memberA = await seedMember();
    const memberB = await seedMember();
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    // Matches keyword AND inside the 7-day window — the only row that should
    // survive a q=funnel&range=7d query.
    const recentMatch = await insertCall({
      userId: memberA.id,
      startedAt: days(2),
      endedAt: days(2),
      summary: "Reviewed the funnel build",
      transcript: "details",
    });
    // Matches keyword but is OUTSIDE the 7-day window — excluded by range.
    await insertCall({
      userId: memberA.id,
      startedAt: days(20),
      endedAt: days(20),
      summary: "Older funnel discussion",
      transcript: "details",
    });
    // Inside the window but does NOT match the keyword — excluded by q.
    await insertCall({
      userId: memberA.id,
      startedAt: days(1),
      endedAt: days(1),
      summary: "weather talk",
      transcript: "small talk",
    });
    // Member B matches keyword AND window but must never leak across members.
    await insertCall({
      userId: memberB.id,
      startedAt: days(2),
      endedAt: days(2),
      summary: "funnel for member B",
      transcript: "funnel funnel",
    });

    const res = await request(app)
      .get("/api/voice/calls?q=funnel&range=7d")
      .set("Cookie", memberA.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([recentMatch]);

    // Widening the range to 30d while keeping the keyword must surface the
    // older keyword match too (newest-first), proving range is the only lever
    // that changed.
    const widened = await request(app)
      .get("/api/voice/calls?q=funnel&range=30d")
      .set("Cookie", memberA.cookie);
    expect(widened.status).toBe(200);
    expect((widened.body.calls as Array<{ id: number }>).map((c) => c.id)).toHaveLength(2);
    expect((widened.body.calls as Array<{ id: number }>).map((c) => c.id)[0]).toBe(recentMatch);
  });
});

describe("GET /voice/calls — custom from/to date range", () => {
  // Use fixed, far-past calendar dates so the test is deterministic and never
  // collides with NOW()-relative preset windows.
  it("AND-combines an explicit from/to range with the keyword, scoped to the member", async () => {
    const memberA = await seedMember();
    const memberB = await seedMember();

    const at = (iso: string) => new Date(iso);

    // Inside the [2025-03-05, 2025-03-15] window AND matches the keyword — the
    // only row that should survive q=funnel&from=2025-03-05&to=2025-03-15.
    const inWindowMatch = await insertCall({
      userId: memberA.id,
      startedAt: at("2025-03-10T12:00:00.000Z"),
      endedAt: at("2025-03-10T12:05:00.000Z"),
      summary: "Reviewed the funnel build",
      transcript: "details",
    });
    // Matches keyword but is BEFORE the window — excluded by `from`.
    await insertCall({
      userId: memberA.id,
      startedAt: at("2025-03-01T12:00:00.000Z"),
      endedAt: at("2025-03-01T12:05:00.000Z"),
      summary: "Earlier funnel chat",
      transcript: "details",
    });
    // Matches keyword but is AFTER the window — excluded by `to`.
    await insertCall({
      userId: memberA.id,
      startedAt: at("2025-03-20T12:00:00.000Z"),
      endedAt: at("2025-03-20T12:05:00.000Z"),
      summary: "Later funnel chat",
      transcript: "details",
    });
    // Inside the window but does NOT match the keyword — excluded by q.
    await insertCall({
      userId: memberA.id,
      startedAt: at("2025-03-12T12:00:00.000Z"),
      endedAt: at("2025-03-12T12:05:00.000Z"),
      summary: "weather talk",
      transcript: "small talk",
    });
    // Member B matches keyword AND window but must never leak across members.
    await insertCall({
      userId: memberB.id,
      startedAt: at("2025-03-11T12:00:00.000Z"),
      endedAt: at("2025-03-11T12:05:00.000Z"),
      summary: "funnel for member B",
      transcript: "funnel funnel",
    });

    const res = await request(app)
      .get("/api/voice/calls?q=funnel&from=2025-03-05&to=2025-03-15")
      .set("Cookie", memberA.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([inWindowMatch]);
  });

  it("treats `to` as an inclusive end-of-day boundary", async () => {
    const member = await seedMember();
    const at = (iso: string) => new Date(iso);

    // Late-evening call on the boundary day must be included by to=2025-06-10.
    const endOfDay = await insertCall({
      userId: member.id,
      startedAt: at("2025-06-10T23:30:00.000Z"),
      endedAt: at("2025-06-10T23:45:00.000Z"),
      summary: "boundary day call",
      transcript: "details",
    });
    // Next-day call must be excluded.
    await insertCall({
      userId: member.id,
      startedAt: at("2025-06-11T00:30:00.000Z"),
      endedAt: at("2025-06-11T00:45:00.000Z"),
      summary: "next day call",
      transcript: "details",
    });

    const res = await request(app)
      .get("/api/voice/calls?from=2025-06-10&to=2025-06-10")
      .set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([endOfDay]);
  });

  it("supports an open-ended range with only `from` set", async () => {
    const member = await seedMember();
    const at = (iso: string) => new Date(iso);

    const after = await insertCall({
      userId: member.id,
      startedAt: at("2025-09-15T12:00:00.000Z"),
      endedAt: at("2025-09-15T12:05:00.000Z"),
    });
    await insertCall({
      userId: member.id,
      startedAt: at("2025-09-01T12:00:00.000Z"),
      endedAt: at("2025-09-01T12:05:00.000Z"),
    });

    const res = await request(app)
      .get("/api/voice/calls?from=2025-09-10")
      .set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toEqual([after]);
  });

  it("ignores a malformed date param and falls back to no custom filter", async () => {
    const member = await seedMember();
    const at = (iso: string) => new Date(iso);

    const a = await insertCall({
      userId: member.id,
      startedAt: at("2025-01-05T12:00:00.000Z"),
      endedAt: at("2025-01-05T12:05:00.000Z"),
    });
    const b = await insertCall({
      userId: member.id,
      startedAt: at("2025-01-02T12:00:00.000Z"),
      endedAt: at("2025-01-02T12:05:00.000Z"),
    });

    // Invalid `from` (not YYYY-MM-DD) is ignored; both rows returned.
    const res = await request(app)
      .get("/api/voice/calls?from=not-a-date")
      .set("Cookie", member.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body.calls as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });
});
