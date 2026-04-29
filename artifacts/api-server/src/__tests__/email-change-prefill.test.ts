import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async () => ({ success: true })),
    queueEmail: vi.fn(async () => ({ result: "queued" })),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

import { buildTestApp } from "./test-app";
import membersRouter from "../routes/members";
import {
  signEmailChangePrefillToken,
  verifyEmailChangePrefillToken,
  buildEmailChangeRestartUrl,
} from "../lib/email-change-prefill-token";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `email-change-prefill-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestApp>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("Whatever1!", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(() => {
  app = buildTestApp({ routers: [membersRouter] });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("email-change-prefill-token helpers", () => {
  it("round-trips a valid payload via sign/verify", () => {
    const token = signEmailChangePrefillToken({
      userId: 4242,
      prefillEmail: "Alice@Example.test",
    });
    const payload = verifyEmailChangePrefillToken(token);
    expect(payload).toEqual({
      userId: 4242,
      // Verifier returns the lower-cased form so callers can compare without
      // normalizing again.
      prefillEmail: "alice@example.test",
    });
  });

  it("returns null for a malformed/garbage token", () => {
    expect(verifyEmailChangePrefillToken("not-a-jwt")).toBeNull();
    expect(verifyEmailChangePrefillToken("")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign(
      { userId: 1, prefillEmail: "x@y.test", purpose: "email_change_prefill" },
      "some-other-secret",
      { expiresIn: "1h" },
    );
    expect(verifyEmailChangePrefillToken(forged)).toBeNull();
  });

  it("rejects a token signed with the right secret but the wrong purpose", () => {
    // Critical: a JWT issued for some other flow (e.g. password reset) must
    // not be reusable as a prefill token even though the secret is shared.
    const wrongPurpose = jwt.sign(
      { userId: 1, prefillEmail: "x@y.test", purpose: "password_reset" },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    expect(verifyEmailChangePrefillToken(wrongPurpose)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = signEmailChangePrefillToken(
      { userId: 7, prefillEmail: "old@example.test" },
      { expiresIn: -10 },
    );
    expect(verifyEmailChangePrefillToken(expired)).toBeNull();
  });

  it("buildEmailChangeRestartUrl trims trailing slashes and url-encodes the token", () => {
    const url = buildEmailChangeRestartUrl(
      "https://portal.example.test///",
      "abc.def+/=",
    );
    expect(url).toBe(
      "https://portal.example.test/account?email_change_prefill=abc.def%2B%2F%3D",
    );
  });
});

describe("GET /api/members/me/email/prefill", () => {
  it("returns the prefill address when the token is valid for the signed-in user", async () => {
    const user = await insertUser("happy");
    const previouslyRequested = `${TEST_TAG}-happy-new@example.test`;
    const token = signEmailChangePrefillToken({
      userId: user.id,
      prefillEmail: previouslyRequested,
    });

    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .query({ token })
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prefillEmail: previouslyRequested.toLowerCase() });
  });

  it("returns 400 when the token query param is missing", async () => {
    const user = await insertUser("missing");
    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .set("Cookie", signCookie(user.id, user.email));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/i);
  });

  it("returns 410 when the token is expired", async () => {
    const user = await insertUser("expired");
    const token = signEmailChangePrefillToken(
      { userId: user.id, prefillEmail: "stale@example.test" },
      { expiresIn: -5 },
    );

    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .query({ token })
      .set("Cookie", signCookie(user.id, user.email));

    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/no longer valid|expired/i);
  });

  it("returns 410 when the token is malformed/forged", async () => {
    const user = await insertUser("forged");
    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .query({ token: "not-a-real-jwt" })
      .set("Cookie", signCookie(user.id, user.email));
    expect(res.status).toBe(410);
  });

  it("returns 403 when the token was signed for a different user (anti-phishing)", async () => {
    // Critical security check: a forwarded/leaked link must NOT pre-seed the
    // recipient's email-change form with an attacker-chosen address. The
    // token's `userId` claim must match the authenticated session.
    const owner = await insertUser("token-owner");
    const intruder = await insertUser("token-intruder");
    const tokenForOwner = signEmailChangePrefillToken({
      userId: owner.id,
      prefillEmail: "attacker-controlled@evil.test",
    });

    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .query({ token: tokenForOwner })
      .set("Cookie", signCookie(intruder.id, intruder.email));

    expect(res.status).toBe(403);
    // The body must never disclose the attacker-supplied prefill address —
    // doing so would echo it back to the unintended viewer.
    expect(res.body.prefillEmail).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("attacker-controlled");
  });

  it("returns 401 when the caller is not authenticated", async () => {
    const owner = await insertUser("unauth");
    const token = signEmailChangePrefillToken({
      userId: owner.id,
      prefillEmail: "x@example.test",
    });

    const res = await request(app)
      .get("/api/members/me/email/prefill")
      .query({ token });

    // No cookie set — the global authenticate middleware short-circuits.
    expect(res.status).toBe(401);
  });
});
