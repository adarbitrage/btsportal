import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// The members router imports GHL/email side-effect helpers at module load.
// Stub them out so the profile GET/PATCH round-trip never touches Redis/GHL.
vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn(async () => ({ result: "queued" as const })),
    queueSms: vi.fn(async () => ({ result: "queued" as const })),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "ghl_job_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import membersRouter from "../routes/members";
import onboardingRouter from "../routes/onboarding";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

const TEST_TAG = `profile-sms-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let member: { id: number; email: string };

// The four new per-category SMS preference fields this task locks coverage on.
const NEW_PREF_FIELDS = [
  "securitySmsOptIn",
  "billingSmsOptIn",
  "coachingSmsOptIn",
  "contentSmsOptIn",
] as const;

beforeAll(async () => {
  app = buildTestAppWithRouters([membersRouter, onboardingRouter]);

  const email = `${TEST_TAG}-member@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Profile Pref Member",
      passwordHash,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
      // Seed with schema defaults flipped to a known starting point so the
      // PATCH below provably changes every field. A phone is required here
      // because smsOptIn is on — Task #1690 added a server-side gate
      // rejecting any save that would leave SMS on with no phone on file.
      phone: "+15550001111",
      smsOptIn: true,
      securitySmsOptIn: true,
      billingSmsOptIn: true,
      coachingSmsOptIn: true,
      contentSmsOptIn: false,
    })
    .returning({ id: usersTable.id });
  member = { id: row.id, email };
  seededUserIds.push(row.id);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(phoneChangeHistoryTable)
      .where(inArray(phoneChangeHistoryTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /api/members/me — per-category SMS preferences", () => {
  it("returns all four new preference fields", async () => {
    const res = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(member.id, member.email));

    expect(res.status).toBe(200);
    for (const field of NEW_PREF_FIELDS) {
      expect(res.body).toHaveProperty(field);
      expect(typeof res.body[field]).toBe("boolean");
    }
    // Mirrors the seeded starting state.
    expect(res.body).toMatchObject({
      securitySmsOptIn: true,
      billingSmsOptIn: true,
      coachingSmsOptIn: true,
      contentSmsOptIn: false,
    });
  });
});

describe("PATCH /api/members/me/profile — per-category SMS preferences round-trip", () => {
  it("saves all four new preference fields and returns the updated values", async () => {
    // Flip every field away from its seeded value.
    const update = {
      securitySmsOptIn: false,
      billingSmsOptIn: false,
      coachingSmsOptIn: false,
      contentSmsOptIn: true,
    };

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", signCookie(member.id, member.email))
      .send(update);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(update);

    // Persisted to the DB…
    const [row] = await db
      .select({
        securitySmsOptIn: usersTable.securitySmsOptIn,
        billingSmsOptIn: usersTable.billingSmsOptIn,
        coachingSmsOptIn: usersTable.coachingSmsOptIn,
        contentSmsOptIn: usersTable.contentSmsOptIn,
      })
      .from(usersTable)
      .where(eq(usersTable.id, member.id));
    expect(row).toMatchObject(update);

    // …and reflected back through GET /members/me.
    const getRes = await request(app)
      .get("/api/members/me")
      .set("Cookie", signCookie(member.id, member.email));
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject(update);
  });

  it("updates a single preference field without disturbing the others", async () => {
    // Reset to a known baseline.
    await db
      .update(usersTable)
      .set({
        securitySmsOptIn: true,
        billingSmsOptIn: true,
        coachingSmsOptIn: true,
        contentSmsOptIn: true,
      })
      .where(eq(usersTable.id, member.id));

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", signCookie(member.id, member.email))
      .send({ billingSmsOptIn: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      securitySmsOptIn: true,
      billingSmsOptIn: false,
      coachingSmsOptIn: true,
      contentSmsOptIn: true,
    });
  });
});

describe("PATCH /api/members/me/profile — SMS/phone gate (Task #1690)", () => {
  it("rejects clearing the phone while the master SMS opt-in AND a per-category opt-in (partner-call) remain on", async () => {
    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", signCookie(member.id, member.email))
      .send({ phone: "", smsOptIn: true, partnerCallSmsOptIn: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone number/i);

    const [row] = await db
      .select({ phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, member.id));
    // The reject must be atomic — phone stays at its prior (non-empty) value.
    expect(row.phone).not.toBe("");
  });

  it("does NOT block an unrelated save for a phone-less member whose per-category flags are still at their schema default (true) but whose master SMS opt-in is off", async () => {
    // A brand-new signup: no phone, master smsOptIn defaults false, but
    // ticketReply/security/billing/coaching/partnerCall all default true at
    // the DB level. None of those categories can ever fire a text without
    // the master flag also being on, so this must NOT be treated as an
    // "SMS-on + no-phone" violation — otherwise every phone-less member's
    // very first (or any later) unrelated profile edit would 400 forever.
    const email = `${TEST_TAG}-default-state@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [row] = await db
      .insert(usersTable)
      .values({
        email,
        name: "Default State Member",
        passwordHash,
        sourceProduct: "lifetime",
        emailVerified: true,
        onboardingComplete: true,
        // phone / smsOptIn intentionally left at their schema defaults.
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(row.id);

    const [before] = await db
      .select({ phone: usersTable.phone, smsOptIn: usersTable.smsOptIn, partnerCallSmsOptIn: usersTable.partnerCallSmsOptIn })
      .from(usersTable)
      .where(eq(usersTable.id, row.id));
    expect(before.phone).toBeFalsy();
    expect(before.smsOptIn).toBe(false);
    expect(before.partnerCallSmsOptIn).toBe(true);

    const res = await request(app)
      .patch("/api/members/me/profile")
      .set("Cookie", signCookie(row.id, email))
      .send({ name: "Renamed" });

    expect(res.status).toBe(200);
  });
});
