/**
 * Task #1630 (T7): GHL appointment status webhooks -> call_bookings.
 *
 * Extends POST /api/webhooks/ghl with an appointment-events branch that
 * keeps `call_bookings` — the single local truth for call state — in sync
 * with GHL-side status changes (completed/no_show/canceled). Covers:
 *  - completed on a matched partner booking flips status AND (for a
 *    member's FIRST completed partner call) advances onboarding via the
 *    shared markPartnerCallDone seam — exactly once.
 *  - no_show and canceled flip status without touching onboarding.
 *  - forward-only/idempotent: replayed/duplicate events never regress a
 *    terminal status or double-fire the onboarding advance.
 *  - unmatched appointment ids are no-ops (existing tag-trigger branch is
 *    untouched by this).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, partnersTable, callBookingsTable, sequenceEnrollmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// webhooks-ghl.ts captures GHL_WEBHOOK_SECRET into a module-level const at
// import time and uses it both as the signature-verification key and the
// "reject in production" gate. vi.hoisted runs before the static import
// below so the router signs/verifies against a known key.
const GHL_WEBHOOK_SECRET = vi.hoisted(() => {
  const key = "test-ghl-webhook-secret";
  process.env.GHL_WEBHOOK_SECRET = key;
  return key;
});

import webhooksGhlRouter from "../routes/webhooks-ghl";

const TEST_TAG = `webhooks-ghl-appt-${randomUUID().slice(0, 8)}`;

let app: Express;
let partnerId = 0;
const userIds: number[] = [];
const bookingIds: number[] = [];

// Mirror app.ts's webhook body handling: capture the raw bytes onto
// req.rawBody (used for HMAC verification) and parse JSON onto req.body.
function buildApp(): Express {
  const a = express();
  a.use(
    "/api/webhooks",
    express.raw({ type: "*/*" }),
    (req: Request, _res: Response, next: NextFunction) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body.toString("utf-8");
        try {
          req.body = JSON.parse(req.rawBody);
        } catch {
          req.body = {};
        }
      }
      next();
    },
  );
  a.use("/api", webhooksGhlRouter);
  return a;
}

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", GHL_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

async function makeMember(): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 8)}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "GHL Appt Webhook Member",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: false,
      onboardingStep: 6,
    })
    .returning({ id: usersTable.id });
  userIds.push(row.id);
  return row.id;
}

async function seedPartnerBooking(opts: {
  memberId: number;
  status?: string;
  ghlAppointmentId?: string;
}): Promise<{ id: number; ghlAppointmentId: string }> {
  const ghlAppointmentId = opts.ghlAppointmentId ?? `${TEST_TAG}-appt-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(callBookingsTable)
    .values({
      memberId: opts.memberId,
      staffType: "partner",
      staffId: partnerId,
      type: "partner",
      ghlCalendarId: `${TEST_TAG}-cal`,
      ghlAppointmentId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      durationMinutes: 30,
      status: opts.status ?? "booked",
    })
    .returning({ id: callBookingsTable.id });
  bookingIds.push(row.id);
  return { id: row.id, ghlAppointmentId };
}

async function getBooking(id: number) {
  const [row] = await db
    .select({ status: callBookingsTable.status, cancelledAt: callBookingsTable.cancelledAt })
    .from(callBookingsTable)
    .where(eq(callBookingsTable.id, id))
    .limit(1);
  return row;
}

async function onboardingOf(userId: number) {
  const [row] = await db
    .select({ step: usersTable.onboardingStep, complete: usersTable.onboardingComplete })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row;
}

// The route (like the existing tag-trigger branch) responds 200 immediately
// and processes the event asynchronously afterward — poll instead of a fixed
// sleep so this isn't flaky under load.
async function waitFor(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

function postAppointmentEvent(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return request(app)
    .post("/api/webhooks/ghl")
    .set("Content-Type", "application/json")
    .set("x-ghl-signature", sign(raw))
    .send(raw);
}

beforeAll(async () => {
  app = buildApp();
  const [partner] = await db
    .insert(partnersTable)
    .values({
      displayName: "GHL Webhook Test Partner",
      ghlCalendarId: `${TEST_TAG}-partner-cal`,
      isActive: true,
      maxDailyCalls: 5,
    })
    .returning({ id: partnersTable.id });
  partnerId = partner.id;
});

afterAll(async () => {
  if (userIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.memberId, userIds));
    // completeOnboardingAfterPartnerCallDone enrolls members in the
    // post-onboarding nurture sequence; that FK must be cleared before the
    // users row can be deleted.
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  } else if (bookingIds.length > 0) {
    await db.delete(callBookingsTable).where(inArray(callBookingsTable.id, bookingIds));
  }
  await db.delete(partnersTable).where(eq(partnersTable.id, partnerId));
});

describe("GHL appointment webhook -> call_bookings", () => {
  it("completed on a member's first partner call flips status and advances onboarding exactly once", async () => {
    const memberId = await makeMember();
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId });

    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "showed",
    });
    expect(res.status).toBe(200);
    await waitFor(async () => (await getBooking(bookingId))?.status === "completed");

    const onboarding = await onboardingOf(memberId);
    expect(onboarding.step).toBe(6);
    expect(onboarding.complete).toBe(true);

    // Replay the exact same event: must not re-fire the advance or throw.
    const replay = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "showed",
    });
    expect(replay.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    const afterReplay = await onboardingOf(memberId);
    expect(afterReplay.step).toBe(6);
    expect(afterReplay.complete).toBe(true);
  });

  it("does not advance onboarding for a SECOND completed partner call", async () => {
    const memberId = await makeMember();
    // Seed a prior completed partner call (id lower than the one under test).
    await seedPartnerBooking({ memberId, status: "completed" });
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId });

    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "completed",
    });
    expect(res.status).toBe(200);
    await waitFor(async () => (await getBooking(bookingId))?.status === "completed");

    // Member's FIRST completed partner call was seeded directly (not via a
    // webhook), so onboarding was never advanced by this member's calls at
    // all; the completed event under test is their SECOND completed call and
    // must not advance onboarding either.
    const onboarding = await onboardingOf(memberId);
    expect(onboarding.complete).toBe(false);
    expect(onboarding.step).toBe(6);
  });

  it("no_show flips status without touching onboarding", async () => {
    const memberId = await makeMember();
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId });

    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "noshow",
    });
    expect(res.status).toBe(200);
    await waitFor(async () => (await getBooking(bookingId))?.status === "no_show");

    const booking = await getBooking(bookingId);
    expect(booking?.status).toBe("no_show");

    const onboarding = await onboardingOf(memberId);
    expect(onboarding.complete).toBe(false);
    expect(onboarding.step).toBe(6);
  });

  it("canceled flips status and stamps cancelledAt", async () => {
    const memberId = await makeMember();
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId });

    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "cancelled",
    });
    expect(res.status).toBe(200);
    await waitFor(async () => (await getBooking(bookingId))?.status === "canceled");

    const booking = await getBooking(bookingId);
    expect(booking?.status).toBe("canceled");
    expect(booking?.cancelledAt).not.toBeNull();
  });

  it("never regresses a terminal status on a late/out-of-order replay", async () => {
    const memberId = await makeMember();
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId, status: "completed" });

    // A stale no_show event arrives after completion already landed.
    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "noshow",
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));

    const booking = await getBooking(bookingId);
    expect(booking?.status).toBe("completed");
  });

  it("unmatched appointment ids are ignored (no throw, no row changes)", async () => {
    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: `${TEST_TAG}-does-not-exist`,
      appointmentStatus: "showed",
    });
    expect(res.status).toBe(200);
  });

  it("unhandled statuses (e.g. confirmed) are ignored", async () => {
    const memberId = await makeMember();
    const { id: bookingId, ghlAppointmentId } = await seedPartnerBooking({ memberId });

    const res = await postAppointmentEvent({
      type: "AppointmentUpdate",
      appointmentId: ghlAppointmentId,
      appointmentStatus: "confirmed",
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const booking = await getBooking(bookingId);
    expect(booking?.status).toBe("booked");
  });

  it("non-appointment event types fall through to the existing tag branch untouched", async () => {
    const res = await postAppointmentEvent({
      type: "ContactTagUpdate",
      contact: { email: "nonexistent@example.test", tags: ["some_other_tag"] },
      tags: ["some_other_tag"],
    });
    expect(res.status).toBe(200);
  });
});
