import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, voiceCallsTable, voiceDailyUsageTable, auditLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import voiceRouter from "../routes/voice";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-voice-usage-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

// Build the same UTC "today"-based date string the route uses (getTodayDate),
// shifted by `offsetDays`, so seeded usage rows land in the right rolling window.
function utcDateStr(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

// A timestamp at noon UTC on the given date string — avoids midnight boundary
// flakiness when the route buckets voice_calls by started_at::date.
function noonOn(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

async function seedUser(role: "member" | "admin"): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: role === "admin" ? "Admin Voice Test" : "Member Voice Test",
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

// Seeds a member with a caller-supplied display name so the `q` search tests
// can match on a name fragment (the default seedUser uses a fixed name shared
// across rows). The email still carries TEST_TAG + a random suffix so it stays
// unique and searchable on its own.
async function seedNamedUser(name: string): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, email, cookie: `access_token=${token}` };
}

async function insertUsage(userId: number, usageDate: string, secondsUsed: number): Promise<void> {
  await db.insert(voiceDailyUsageTable).values({ userId, usageDate, secondsUsed });
}

async function insertCall(userId: number, startedAt: Date): Promise<number> {
  const [row] = await db
    .insert(voiceCallsTable)
    .values({
      userId,
      retellCallId: `${TEST_TAG}-${randomUUID()}`,
      status: "ended",
      startedAt,
      endedAt: new Date(startedAt.getTime() + 60_000),
      durationSeconds: 60,
      summary: "seeded summary",
      transcript: "seeded transcript",
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
    await db.delete(voiceDailyUsageTable).where(inArray(voiceDailyUsageTable.userId, seededUserIds));
    // The CSV export test triggers logAdminAction, which writes audit_log rows
    // referencing the seeded admin via actor_id; clear them before deleting
    // users or the FK constraint blocks the delete.
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("admin voice usage — permission gate", () => {
  it("rejects a non-admin member with 403 on every admin voice route", async () => {
    const member = await seedUser("member");

    const usage = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", member.cookie);
    expect(usage.status).toBe(403);

    const calls = await request(app)
      .get("/api/admin/voice/calls")
      .set("Cookie", member.cookie);
    expect(calls.status).toBe(403);

    const detail = await request(app)
      .get("/api/admin/voice/calls/1")
      .set("Cookie", member.cookie);
    expect(detail.status).toBe(403);
  });

  it("requires authentication (401 without a session cookie)", async () => {
    const usage = await request(app).get("/api/admin/voice/usage");
    expect(usage.status).toBe(401);
  });
});

describe("GET /admin/voice/usage — rolling-window totals", () => {
  it("buckets seconds and call counts correctly across today/week/month", async () => {
    const admin = await seedUser("admin");
    const usageUser = await seedUser("member");

    // Baseline before seeding: the totals query is global, so we assert on the
    // delta our seeded rows introduce rather than absolute numbers.
    const before = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", admin.cookie);
    expect(before.status).toBe(200);
    const base = before.body.totals;

    // today: in today + week + month windows
    await insertUsage(usageUser.id, utcDateStr(0), 100);
    await insertCall(usageUser.id, noonOn(utcDateStr(0)));
    // 3 days ago: in week + month, not today
    await insertUsage(usageUser.id, utcDateStr(-3), 200);
    await insertCall(usageUser.id, noonOn(utcDateStr(-3)));
    // 15 days ago: in month only
    await insertUsage(usageUser.id, utcDateStr(-15), 300);
    await insertCall(usageUser.id, noonOn(utcDateStr(-15)));
    // 40 days ago: outside every window — must not contribute
    await insertUsage(usageUser.id, utcDateStr(-40), 400);
    await insertCall(usageUser.id, noonOn(utcDateStr(-40)));

    const after = await request(app)
      .get("/api/admin/voice/usage")
      .set("Cookie", admin.cookie);
    expect(after.status).toBe(200);
    const totals = after.body.totals;

    expect(totals.today.seconds - base.today.seconds).toBe(100);
    expect(totals.week.seconds - base.week.seconds).toBe(300);
    expect(totals.month.seconds - base.month.seconds).toBe(600);

    expect(totals.today.calls - base.today.calls).toBe(1);
    expect(totals.week.calls - base.week.calls).toBe(2);
    expect(totals.month.calls - base.month.calls).toBe(3);

    expect(after.body.dailyCapSeconds).toBeGreaterThan(0);

    // topMembers defaults to the month period: our user should be present with
    // the month-window seconds (600) and call count (3, the 40-day row excluded).
    const me = (after.body.topMembers.members as Array<{ userId: number; secondsUsed: number; callCount: number }>)
      .find((m) => m.userId === usageUser.id);
    expect(after.body.topMembers.period).toBe("month");
    expect(me).toBeDefined();
    expect(me!.secondsUsed).toBe(600);
    expect(me!.callCount).toBe(3);
  });
});

describe("GET /admin/voice/usage — topMembers ranking", () => {
  it("orders top members by seconds DESC with user id ASC tie-break", async () => {
    const admin = await seedUser("admin");
    // Seeded in order, so userTieA.id < userTieB.id — the tie-break decider.
    const userHigh = await seedUser("member");
    const userTieA = await seedUser("member");
    const userTieB = await seedUser("member");

    // All in the current (today) window; userHigh has the most seconds while the
    // two tie users have identical seconds so ordering falls to user id ASC.
    const today = utcDateStr(0);
    await insertUsage(userHigh.id, today, 500);
    await insertUsage(userTieA.id, today, 100);
    await insertUsage(userTieB.id, today, 100);

    // limit=100 so our small-second seeds aren't pushed off the leaderboard by
    // pre-existing heavy users in the shared DB.
    const res = await request(app)
      .get("/api/admin/voice/usage?limit=100")
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);

    const ids = new Set([userHigh.id, userTieA.id, userTieB.id]);
    const ordered = (res.body.topMembers.members as Array<{ userId: number }>)
      .map((m) => m.userId)
      .filter((id) => ids.has(id));

    // Filtering to our seeded ids preserves the route's relative ordering:
    // seconds DESC puts userHigh first; the equal-seconds pair tie-breaks on id ASC.
    expect(ordered).toEqual([userHigh.id, userTieA.id, userTieB.id]);
  });
});

describe("GET /admin/voice/usage — period window switching", () => {
  it("narrows topMembers by period and echoes the requested period", async () => {
    const admin = await seedUser("admin");
    const monthOnlyUser = await seedUser("member");

    // A usage row 15 days ago lands only in the month window — outside today/week.
    await insertUsage(monthOnlyUser.id, utcDateStr(-15), 250);

    const inMembers = (body: { topMembers: { members: Array<{ userId: number }> } }, id: number): boolean =>
      body.topMembers.members.some((m) => m.userId === id);

    // month: the user is present and the period echoes back.
    const month = await request(app)
      .get("/api/admin/voice/usage?period=month&limit=100")
      .set("Cookie", admin.cookie);
    expect(month.status).toBe(200);
    expect(month.body.topMembers.period).toBe("month");
    expect(inMembers(month.body, monthOnlyUser.id)).toBe(true);

    // today: the 15-day-old row drops out; period echoes "today".
    const today = await request(app)
      .get("/api/admin/voice/usage?period=today&limit=100")
      .set("Cookie", admin.cookie);
    expect(today.status).toBe(200);
    expect(today.body.topMembers.period).toBe("today");
    expect(inMembers(today.body, monthOnlyUser.id)).toBe(false);

    // week: still outside the trailing-7-day window; period echoes "week".
    const week = await request(app)
      .get("/api/admin/voice/usage?period=week&limit=100")
      .set("Cookie", admin.cookie);
    expect(week.status).toBe(200);
    expect(week.body.topMembers.period).toBe("week");
    expect(inMembers(week.body, monthOnlyUser.id)).toBe(false);
  });
});

describe("GET /admin/voice/calls — pagination & userId filter", () => {
  it("filters by userId and paginates newest-first", async () => {
    const admin = await seedUser("admin");
    const userA = await seedUser("member");
    const userB = await seedUser("member");

    const base = Date.now();
    // Three calls for A (newest-first a1, a2, a3), two for B.
    const a1 = await insertCall(userA.id, new Date(base - 1000));
    const a2 = await insertCall(userA.id, new Date(base - 2000));
    const a3 = await insertCall(userA.id, new Date(base - 3000));
    await insertCall(userB.id, new Date(base - 1500));
    await insertCall(userB.id, new Date(base - 2500));

    // Filtered to A: total is exactly 3 and only A's calls come back.
    const filtered = await request(app)
      .get(`/api/admin/voice/calls?userId=${userA.id}`)
      .set("Cookie", admin.cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(3);
    const filteredCalls = filtered.body.calls as Array<{ id: number; userId: number }>;
    expect(filteredCalls.every((c) => c.userId === userA.id)).toBe(true);
    expect(filteredCalls.map((c) => c.id)).toEqual([a1, a2, a3]);

    // Page 1 (limit 2): newest two.
    const page1 = await request(app)
      .get(`/api/admin/voice/calls?userId=${userA.id}&page=1&limit=2`)
      .set("Cookie", admin.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.page).toBe(1);
    expect(page1.body.limit).toBe(2);
    expect((page1.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a1, a2]);

    // Page 2 (limit 2): the remaining one.
    const page2 = await request(app)
      .get(`/api/admin/voice/calls?userId=${userA.id}&page=2&limit=2`)
      .set("Cookie", admin.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);
    expect((page2.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a3]);
  });
});

describe("GET /admin/voice/calls — search by name/email (q param)", () => {
  it("filters by member name and email, combines with userId, and paginates", async () => {
    const admin = await seedUser("admin");
    // A run-unique token embedded in both seeded names so the search matches
    // only our rows and never pre-existing data in the shared DB.
    const tag = `qsearch${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const alice = await seedNamedUser(`Alice ${tag} Anderson`);
    const bob = await seedNamedUser(`Bob ${tag} Brown`);

    const base = Date.now();
    // started_at DESC ordering across both members: a1, b1, a2, b2, a3.
    const a1 = await insertCall(alice.id, new Date(base - 1000));
    const b1 = await insertCall(bob.id, new Date(base - 1500));
    const a2 = await insertCall(alice.id, new Date(base - 2000));
    const b2 = await insertCall(bob.id, new Date(base - 2500));
    const a3 = await insertCall(alice.id, new Date(base - 3000));

    // Search on a name fragment unique to Alice -> only her 3 calls.
    const byName = await request(app)
      .get(`/api/admin/voice/calls?q=${encodeURIComponent(`Alice ${tag}`)}`)
      .set("Cookie", admin.cookie);
    expect(byName.status).toBe(200);
    expect(byName.body.total).toBe(3);
    const byNameCalls = byName.body.calls as Array<{ id: number; userId: number }>;
    expect(byNameCalls.every((c) => c.userId === alice.id)).toBe(true);
    expect(byNameCalls.map((c) => c.id)).toEqual([a1, a2, a3]);

    // Search on Alice's email (the OR branch of the LIKE) -> same 3 calls.
    const byEmail = await request(app)
      .get(`/api/admin/voice/calls?q=${encodeURIComponent(alice.email)}`)
      .set("Cookie", admin.cookie);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.total).toBe(3);
    expect((byEmail.body.calls as Array<{ userId: number }>).every((c) => c.userId === alice.id)).toBe(
      true,
    );

    // The shared tag matches both members' names -> all 5 calls, newest-first.
    const byTag = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}`)
      .set("Cookie", admin.cookie);
    expect(byTag.status).toBe(200);
    expect(byTag.body.total).toBe(5);
    expect((byTag.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a1, b1, a2, b2, a3]);

    // q combined with userId: both filters AND together -> only Alice's 3 calls
    // even though the tag alone matched 5. This guards the COUNT/rows JOIN +
    // filter composition staying in lockstep.
    const combined = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}&userId=${alice.id}`)
      .set("Cookie", admin.cookie);
    expect(combined.status).toBe(200);
    expect(combined.body.total).toBe(3);
    expect((combined.body.calls as Array<{ userId: number }>).every((c) => c.userId === alice.id)).toBe(
      true,
    );

    // Pagination stays correct under a q filter: total is the full match count
    // (5) on every page while rows are sliced newest-first.
    const page1 = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}&page=1&limit=2`)
      .set("Cookie", admin.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(5);
    expect(page1.body.page).toBe(1);
    expect(page1.body.limit).toBe(2);
    expect((page1.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a1, b1]);

    const page2 = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}&page=2&limit=2`)
      .set("Cookie", admin.cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.total).toBe(5);
    expect((page2.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a2, b2]);

    const page3 = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}&page=3&limit=2`)
      .set("Cookie", admin.cookie);
    expect(page3.status).toBe(200);
    expect(page3.body.total).toBe(5);
    expect((page3.body.calls as Array<{ id: number }>).map((c) => c.id)).toEqual([a3]);
  });

  it("clearing q broadens results back to the unfiltered list", async () => {
    const admin = await seedUser("admin");
    const tag = `qclear${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const matching = await seedNamedUser(`Match ${tag} Member`);
    // A second member whose name/email do NOT contain the tag — they must be
    // excluded while q is set but reappear once q is cleared.
    const other = await seedNamedUser("Unrelated Member");

    await insertCall(matching.id, new Date(Date.now() - 1000));
    const otherCall = await insertCall(other.id, new Date(Date.now() - 2000));

    // With q set, only the tagged member is returned.
    const withQ = await request(app)
      .get(`/api/admin/voice/calls?q=${tag}`)
      .set("Cookie", admin.cookie);
    expect(withQ.status).toBe(200);
    expect(withQ.body.total).toBe(1);
    expect((withQ.body.calls as Array<{ userId: number }>).every((c) => c.userId === matching.id)).toBe(
      true,
    );

    // Clearing q returns the full (unfiltered) list: the non-matching member's
    // call is now counted, so the total strictly exceeds the filtered total.
    const noQ = await request(app)
      .get(`/api/admin/voice/calls?userId=${other.id}`)
      .set("Cookie", admin.cookie);
    expect(noQ.status).toBe(200);
    expect(noQ.body.total).toBe(1);
    expect((noQ.body.calls as Array<{ id: number }>)[0].id).toBe(otherCall);

    // And an entirely unfiltered request counts both members' calls (>= the
    // filtered total), confirming q is the only thing narrowing the list.
    const all = await request(app)
      .get("/api/admin/voice/calls?limit=100")
      .set("Cookie", admin.cookie);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.total).toBeGreaterThan(withQ.body.total);

    // An explicit empty q (what the UI sends when the search box is cleared)
    // must behave identically to omitting q entirely — not filter to nothing.
    const emptyQ = await request(app)
      .get("/api/admin/voice/calls?q=&limit=100")
      .set("Cookie", admin.cookie);
    expect(emptyQ.status).toBe(200);
    expect(emptyQ.body.total).toBe(all.body.total);
  });
});

describe("GET /admin/voice/calls/export — CSV export", () => {
  it("rejects a non-admin member with 403", async () => {
    const member = await seedUser("member");
    const res = await request(app)
      .get("/api/admin/voice/calls/export")
      .set("Cookie", member.cookie);
    expect(res.status).toBe(403);
  });

  it("streams a member-filtered CSV with header + one row per call", async () => {
    const admin = await seedUser("admin");
    const user = await seedUser("member");

    const base = Date.now();
    await insertCall(user.id, new Date(base - 1000));
    await insertCall(user.id, new Date(base - 2000));

    const res = await request(app)
      .get(`/api/admin/voice/calls/export?userId=${user.id}`)
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(
      `voice-calls-member-${user.id}-export.csv`,
    );

    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe(
      "member,email,status,started_at,ended_at,duration_seconds,has_transcript,has_summary",
    );
    // Two seeded calls => two data rows.
    expect(lines.length).toBe(3);
    // Seeded calls have a transcript + summary, status "ended", duration 60.
    for (const line of lines.slice(1)) {
      expect(line).toContain("Member Voice Test");
      expect(line).toContain("ended");
      expect(line).toContain("60");
      expect(line).toContain("true,true");
    }
  });

  it("does not collide with the /:id detail route (export is not parsed as an id)", async () => {
    const admin = await seedUser("admin");
    const res = await request(app)
      .get("/api/admin/voice/calls/export")
      .set("Cookie", admin.cookie);
    // If "export" fell through to /:id it would 400 (invalid id). It must 200.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});

describe("GET /admin/voice/calls/:id — call detail", () => {
  it("returns 400 for an invalid id", async () => {
    const admin = await seedUser("admin");
    const res = await request(app)
      .get("/api/admin/voice/calls/not-a-number")
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed but missing call id", async () => {
    const admin = await seedUser("admin");
    const res = await request(app)
      .get("/api/admin/voice/calls/2000000000")
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(404);
  });

  it("returns the call with member identity for a valid id", async () => {
    const admin = await seedUser("admin");
    const user = await seedUser("member");
    const callId = await insertCall(user.id, new Date());

    const res = await request(app)
      .get(`/api/admin/voice/calls/${callId}`)
      .set("Cookie", admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.call.id).toBe(callId);
    expect(res.body.call.userId).toBe(user.id);
    expect(res.body.call.transcript).toBe("seeded transcript");
    expect(res.body.call.summary).toBe("seeded summary");
  });
});
