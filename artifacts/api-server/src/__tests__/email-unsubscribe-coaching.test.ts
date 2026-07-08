import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import emailRouter from "../routes/email";
import { buildTestApp } from "./test-app";
import { generateUnsubscribeToken } from "../lib/unsubscribe-token";

// GET /api/email/unsubscribe-coaching (Task #1770): one-click, tokenized,
// coaching-only unsubscribe. It flips ONLY users.coaching_email_opt_in and
// never touches the global marketing suppression list or other prefs.

const TAG = `unsub-coach-${randomUUID().slice(0, 8)}`;
const EMAIL = `${TAG}@example.test`;

const seededUserIds: number[] = [];
let userId = 0;

const app = buildTestApp({ routers: [emailRouter] });

async function fetchPrefs() {
  const [row] = await db
    .select({
      coachingEmailOptIn: usersTable.coachingEmailOptIn,
      marketingOptIn: usersTable.marketingOptIn,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: EMAIL,
      name: "Unsub Coaching Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      marketingOptIn: true,
      coachingEmailOptIn: true,
    })
    .returning({ id: usersTable.id });
  userId = user.id;
  seededUserIds.push(user.id);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /api/email/unsubscribe-coaching", () => {
  it("rejects a missing token without changing anything", async () => {
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL });
    expect(res.status).toBe(400);
    expect((await fetchPrefs()).coachingEmailOptIn).toBe(true);
  });

  it("rejects a bad token without changing anything", async () => {
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL, token: "not-a-real-token" });
    expect(res.status).toBe(400);
    expect((await fetchPrefs()).coachingEmailOptIn).toBe(true);
  });

  it("rejects a token minted for a DIFFERENT email address", async () => {
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL, token: generateUnsubscribeToken("someone-else@example.test") });
    expect(res.status).toBe(400);
    expect((await fetchPrefs()).coachingEmailOptIn).toBe(true);
  });

  it("is reachable without authentication (email links are clicked logged-out) and flips ONLY coachingEmailOptIn", async () => {
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL, token: generateUnsubscribeToken(EMAIL) });
    expect(res.status).toBe(200);
    expect(res.text).toContain("coaching call reminder emails");

    const prefs = await fetchPrefs();
    expect(prefs.coachingEmailOptIn).toBe(false);
    // Marketing opt-in (and the global suppression list) are untouched.
    expect(prefs.marketingOptIn).toBe(true);
  });

  it("is idempotent — a second click confirms again with 200", async () => {
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL, token: generateUnsubscribeToken(EMAIL) });
    expect(res.status).toBe(200);
    expect((await fetchPrefs()).coachingEmailOptIn).toBe(false);
  });

  it("matches the email case-insensitively (link built from a mixed-case address)", async () => {
    // Reset, then unsubscribe with an upper-cased query email; the route
    // lowercases before verifying + matching.
    await db.update(usersTable).set({ coachingEmailOptIn: true }).where(eq(usersTable.id, userId));
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: EMAIL.toUpperCase(), token: generateUnsubscribeToken(EMAIL) });
    expect(res.status).toBe(200);
    expect((await fetchPrefs()).coachingEmailOptIn).toBe(false);
  });

  it("shows an enumeration-safe success page for a valid token with no matching account", async () => {
    const ghost = `${TAG}-ghost@example.test`;
    const res = await request(app)
      .get("/api/email/unsubscribe-coaching")
      .query({ email: ghost, token: generateUnsubscribeToken(ghost) });
    expect(res.status).toBe(200);
    expect(res.text).toContain("coaching call reminder emails");
  });
});
