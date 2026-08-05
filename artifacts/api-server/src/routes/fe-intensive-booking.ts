import { Router } from "express";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  db,
  pool,
  usersTable,
  feIntensiveBookingsTable,
} from "@workspace/db";
import { requirePageAccess } from "../middleware/require-page-access";
import { getFeIntensiveBookingConfig } from "../lib/fe-intensive-settings";
import {
  getFreeSlots,
  getCalendarDurationMinutes,
  upsertContact,
  createAppointment,
  cancelAppointment,
} from "../lib/ghl-coaching-calendar";

/**
 * FE-Intensive booking routes — the Welcome page's native booking surface
 * for front-end/funnel buyers.
 *
 * BORN ENFORCED: every route carries the frontend-welcome ownership check
 * (fail-closed, standard admin/coach bypass) via requirePageAccess — unlike
 * the legacy booking APIs, these launch gated from day one.
 *
 * DELIBERATELY NOT wired into kickoff step-advancement, partner assignment,
 * or pack-credit ledgers — those flows stay untouched. GHL is the booking
 * engine; fe_intensive_bookings is the local store of record the portal
 * reads (never re-derive state from GHL at render time).
 *
 * DORMANT until configured: the GHL calendar id is admin-configurable
 * (system_settings, see lib/fe-intensive-settings.ts). While unset, /status
 * reports configured:false and the Welcome page keeps its pending state.
 */

const router = Router();

router.use("/fe-intensive", requirePageAccess("frontend-welcome"));

const MIN_LEAD_TIME_MS = 60 * 60 * 1000; // 1 hour, same as kickoff booking
const AVAILABILITY_WINDOW_DAYS = 30;

// Distinct advisory-lock keyspace (must not collide with kickoff/partner or
// session-pack lock keys). Serializes concurrent book/cancel for one member.
function feIntensiveMemberLockKey(userId: number): number {
  return 971_000_000_000 + userId;
}

/**
 * Preserve the caller's UTC-offset style on a computed end time — GHL's
 * appointment API is picky about offset formats matching the calendar
 * timezone (same trick as call-bookings.ts).
 */
function isoWithMatchingOffset(date: Date, reference: string): string {
  const offsetMatch = reference.match(/([+-]\d{2}:\d{2}|Z)$/);
  if (!offsetMatch || offsetMatch[1] === "Z") return date.toISOString();
  const offset = offsetMatch[1];
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hh, mm] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * (hh * 60 + mm) * 60_000;
  const local = new Date(date.getTime() + offsetMs);
  return local.toISOString().replace(/\.\d{3}Z$/, "") + offset;
}

const MEMBER_BOOKING_COLUMNS = {
  id: feIntensiveBookingsTable.id,
  scheduledAt: feIntensiveBookingsTable.scheduledAt,
  endAt: feIntensiveBookingsTable.endAt,
  durationMinutes: feIntensiveBookingsTable.durationMinutes,
  status: feIntensiveBookingsTable.status,
  createdAt: feIntensiveBookingsTable.createdAt,
} as const;

async function loadUpcomingBooking(userId: number) {
  const [booking] = await db
    .select(MEMBER_BOOKING_COLUMNS)
    .from(feIntensiveBookingsTable)
    .where(
      and(
        eq(feIntensiveBookingsTable.memberId, userId),
        ne(feIntensiveBookingsTable.status, "canceled"),
        gt(feIntensiveBookingsTable.endAt, new Date()),
      ),
    )
    .orderBy(feIntensiveBookingsTable.scheduledAt)
    .limit(1);
  return booking ?? null;
}

// ── Status: config + member's upcoming booking in one round trip ────────────
router.get("/fe-intensive/status", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const config = await getFeIntensiveBookingConfig();
  if (!config) {
    res.json({ configured: false, booking: null });
    return;
  }
  const booking = await loadUpcomingBooking(userId);
  res.json({ configured: true, booking });
});

// ── Availability: free slots for the configured calendar ────────────────────
router.get("/fe-intensive/availability", async (_req, res): Promise<void> => {
  const config = await getFeIntensiveBookingConfig();
  if (!config) {
    res.json({ configured: false, slots: [] });
    return;
  }
  const now = Date.now();
  try {
    const [slots, durationMinutes] = await Promise.all([
      getFreeSlots(
        config.calendarId,
        now + MIN_LEAD_TIME_MS,
        now + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        config.locationId,
      ),
      getCalendarDurationMinutes(config.calendarId, config.locationId),
    ]);
    res.json({
      configured: true,
      slots: slots.map((s) => ({ startTime: s.startTime })),
      durationMinutes,
    });
  } catch (err) {
    console.error("[fe-intensive] availability fetch failed:", err);
    res.status(502).json({ error: "Could not load available times. Please try again." });
  }
});

// ── Book ─────────────────────────────────────────────────────────────────────
router.post("/fe-intensive/book", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const config = await getFeIntensiveBookingConfig();
  if (!config) {
    res.status(409).json({ error: "Booking is not open yet. Please check back soon." });
    return;
  }

  const { startTime } = req.body || {};
  if (typeof startTime !== "string" || Number.isNaN(Date.parse(startTime))) {
    res.status(400).json({ error: "Invalid start time" });
    return;
  }
  const scheduledAt = new Date(startTime);
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_TIME_MS) {
    res.status(400).json({ error: "Calls must be booked at least 1 hour in advance" });
    return;
  }

  // Idempotency outside the tx: an existing upcoming booking is handed back,
  // never duplicated (safe against double-submits/retries).
  const existing = await loadUpcomingBooking(userId);
  if (existing) {
    res.status(200).json({ booking: existing, alreadyBooked: true });
    return;
  }

  // Member identity — name/email prefilled from the account, no re-entry.
  const [member] = await db
    .select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  let durationMinutes: number;
  try {
    durationMinutes = await getCalendarDurationMinutes(config.calendarId, config.locationId);
  } catch (err) {
    console.error("[fe-intensive] failed to load calendar duration:", err);
    res.status(502).json({ error: "Could not load calendar configuration. Please try again." });
    return;
  }
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  const endTimeIso = isoWithMatchingOffset(endAt, startTime);

  const client = await pool.connect();
  let createdAppointmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);
    await txDb.execute(
      sql`SELECT pg_advisory_xact_lock(${feIntensiveMemberLockKey(userId)})`,
    );

    // Race-free re-check under the member lock.
    const [existingInTx] = await txDb
      .select(MEMBER_BOOKING_COLUMNS)
      .from(feIntensiveBookingsTable)
      .where(
        and(
          eq(feIntensiveBookingsTable.memberId, userId),
          ne(feIntensiveBookingsTable.status, "canceled"),
          gt(feIntensiveBookingsTable.endAt, new Date()),
        ),
      )
      .limit(1);
    if (existingInTx) {
      await client.query("ROLLBACK");
      res.status(200).json({ booking: existingInTx, alreadyBooked: true });
      return;
    }

    // Slot must still be free on the GHL calendar.
    const dayMs = scheduledAt.getTime();
    const recheck = await getFreeSlots(
      config.calendarId,
      dayMs - 60_000,
      dayMs + 60_000,
      config.locationId,
    );
    if (!recheck.some((s) => new Date(s.startTime).getTime() === scheduledAt.getTime())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "That time slot is no longer available" });
      return;
    }

    const nameParts = (member.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] || undefined;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
    const contactId = await upsertContact({
      email: member.email,
      firstName,
      lastName,
      locationId: config.locationId,
    });
    const appointment = await createAppointment({
      calendarId: config.calendarId,
      contactId,
      startTime,
      endTime: endTimeIso,
      title: `Intensive Coaching Session — ${member.name}`,
      locationId: config.locationId,
    });
    createdAppointmentId = appointment.id;

    const [booking] = await txDb
      .insert(feIntensiveBookingsTable)
      .values({
        memberId: userId,
        ghlCalendarId: config.calendarId,
        ghlLocationId: config.locationId ?? null,
        ghlAppointmentId: appointment.id,
        ghlContactId: contactId,
        scheduledAt,
        endAt,
        durationMinutes,
        status: "booked",
      })
      .returning(MEMBER_BOOKING_COLUMNS);

    await client.query("COMMIT");
    res.status(201).json({ booking });
  } catch (err) {
    await client.query("ROLLBACK");
    // Roll back the GHL side if the local insert failed after creation.
    if (createdAppointmentId) {
      try {
        await cancelAppointment(createdAppointmentId, config.locationId);
      } catch (cancelErr) {
        console.error("[fe-intensive] failed to roll back GHL appointment:", cancelErr);
      }
    }
    console.error("[fe-intensive] booking failed:", err);
    res.status(500).json({ error: "Could not complete booking. Please try again." });
  } finally {
    client.release();
  }
});

// ── Cancel (also the first half of rebook — the UI re-opens the grid) ───────
router.post("/fe-intensive/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { bookingId } = req.body || {};
  if (typeof bookingId !== "number" || !Number.isInteger(bookingId)) {
    res.status(400).json({ error: "Invalid booking" });
    return;
  }

  // Same per-member advisory lock as /book: serializes concurrent cancels
  // (and cancel-vs-book) so exactly one caller reaches GHL — a double-submit
  // sees the flipped row inside the lock and replays as alreadyCanceled.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client);
    await txDb.execute(
      sql`SELECT pg_advisory_xact_lock(${feIntensiveMemberLockKey(userId)})`,
    );

    const [booking] = await txDb
      .select()
      .from(feIntensiveBookingsTable)
      .where(
        and(
          eq(feIntensiveBookingsTable.id, bookingId),
          eq(feIntensiveBookingsTable.memberId, userId),
        ),
      )
      .limit(1);
    if (!booking) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    if (booking.status === "canceled") {
      await client.query("ROLLBACK");
      res.status(200).json({ canceled: true, alreadyCanceled: true });
      return;
    }

    // Cancel GHL first — if the upstream cancel fails, the local row stays
    // booked (never a phantom-canceled local record with a live appointment).
    if (booking.ghlAppointmentId) {
      try {
        await cancelAppointment(booking.ghlAppointmentId, booking.ghlLocationId ?? undefined);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[fe-intensive] GHL cancel failed:", err);
        res.status(502).json({ error: "Could not cancel with the scheduling system. Please try again." });
        return;
      }
    }

    await txDb
      .update(feIntensiveBookingsTable)
      .set({ status: "canceled", cancelledAt: new Date() })
      .where(eq(feIntensiveBookingsTable.id, bookingId));
    await client.query("COMMIT");
    res.status(200).json({ canceled: true, alreadyCanceled: false });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[fe-intensive] cancel failed:", err);
    res.status(500).json({ error: "Could not cancel. Please try again." });
  } finally {
    client.release();
  }
});

export default router;
