import {
  db,
  coachesTable,
  coachCallCalendarsTable,
  coachingCallsTable,
  sessionPackBookingsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { COACHING_LOCATION_ID, COACHING_TIMEZONE } from "./ghl-coaching-calendar";

// Single source of truth for the live coaching roster. Every coach here does
// BOTH group calls and private (credit-pack) coaching. Keyed by their
// GoHighLevel calendar id (sub-account JI6HzFwkNIr5VA2QUWUL).
export interface RosterCoach {
  name: string;
  ghlCalendarId: string;
  sortOrder: number;
  // Root-relative path to a headshot shipped in the portal's public dir. The
  // portal resolves this through resolveCoachPhotoUrl so it stays base-path aware.
  photoUrl: string;
  // Email of this coach's portal login (usersTable.role === "coach"), if they
  // have one. The seed resolves it to a user id and stamps coaches.userId, which
  // is how a signed-in coach is mapped to their coach record (coach-facing
  // surfaces scope to "their own" calls). Omit for coaches with no portal account.
  userEmail?: string;
}

export const COACHING_ROSTER: RosterCoach[] = [
  { name: "Sasha", ghlCalendarId: "BdBxOw8kL1aF7VfJR5cc", sortOrder: 1, photoUrl: "/coaching-photos/sasha.png", userEmail: "sasha+coach@cherringtonmedia.com" },
  { name: "Bruce", ghlCalendarId: "0feHbG6YfH2apzvdmR3U", sortOrder: 2, photoUrl: "/coaching-photos/bruce.jpg" },
  { name: "Michael", ghlCalendarId: "JF7LYxF5KRQImZpvSrHo", sortOrder: 3, photoUrl: "/coaching-photos/michael.png" },
  { name: "Todd", ghlCalendarId: "JiTLouUKzGeYrsPtEmK5", sortOrder: 4, photoUrl: "/coaching-photos/todd.jpeg" },
];

// Virtual-assistant roster. VAs live in the SAME `coaches` table (type === "va")
// but do NOT do group or private coaching — they run their own bookable call
// types (today: 1-on-1 VA calls). Keyed by name (VAs have no private-coaching
// ghl_calendar_id to key on; their booking calendars live in
// coach_call_calendars). Only Neil is wired for 1-on-1 VA calls for now.
interface RosterVa {
  name: string;
  sortOrder: number;
  // Whether this VA offers free 1-on-1 VA calls. When true, oneOnOneVaCalendar
  // must be set so there's something to book against.
  doesOneOnOneVaCalls: boolean;
  // GoHighLevel booking calendar for the VA's 1-on-1 call (callType
  // "one_on_one_va"), seeded into coach_call_calendars. Omit when the VA offers
  // no 1-on-1 calls.
  oneOnOneVaCalendar?: { bookingCalendarId: string; bookingLocationId: string };
  // Email of this VA's portal login, resolved to coaches.userId like the
  // strategic roster. Omit for VAs with no portal account.
  userEmail?: string;
}

export const VA_ROSTER: RosterVa[] = [
  { name: "John", sortOrder: 5, doesOneOnOneVaCalls: false },
  {
    name: "Neil",
    sortOrder: 6,
    doesOneOnOneVaCalls: true,
    oneOnOneVaCalendar: {
      bookingCalendarId: "x7BqsXymYCRmojmiORPq",
      bookingLocationId: "r9hM0kL1vtRvIf3mtjgF",
    },
  },
  { name: "Mikha", sortOrder: 7, doesOneOnOneVaCalls: false },
];

// Legacy demo profiles seeded before the real roster existed. Removed by exact
// name (their demo coaching calls are deleted first to satisfy the FK), unless
// they carry real bookings — then they are deactivated for history.
const LEGACY_PLACEHOLDER_NAMES = ["Sarah Mitchell", "David Chen", "Amara Williams"];

// Recurring weekly group Q&A schedule (placeholder cadence, all wall-clock times
// in COACHING_TIMEZONE). weekday: 0=Sun ... 6=Sat. Each entry is a 1-hour
// weekly_qa call. Member-facing times are derived from the stored UTC instant,
// so the portal renders them in each member's local timezone.
interface WeeklySlot {
  coachName: string;
  weekday: number;
  hour: number;
}

export const WEEKLY_QA_SCHEDULE: WeeklySlot[] = [
  { coachName: "Todd", weekday: 1, hour: 8 },
  { coachName: "Bruce", weekday: 1, hour: 15 },
  { coachName: "Sasha", weekday: 1, hour: 18 },
  { coachName: "Bruce", weekday: 2, hour: 15 },
  { coachName: "Michael", weekday: 2, hour: 18 },
  { coachName: "Sasha", weekday: 3, hour: 18 },
  { coachName: "Michael", weekday: 4, hour: 18 },
  { coachName: "Todd", weekday: 5, hour: 8 },
  { coachName: "Bruce", weekday: 6, hour: 10 },
];

// ONE shared Google Meet room for every weekly group call (single config value).
export const GROUP_COACHING_MEET_LINK =
  process.env.COACHING_GROUP_MEET_LINK ?? "https://meet.google.com/bts-weekly-qa";

const WEEKLY_QA_DURATION_MINUTES = 60;
const WEEKLY_QA_ENTITLEMENT = "coaching:group";
// How many weeks of upcoming weekly_qa calls to keep populated ahead of now.
const WEEKS_AHEAD = 4;

// --- timezone helpers -------------------------------------------------------

// Offset (timeZone - UTC) in ms for the given instant, via Intl.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second,
  );
  return asUTC - date.getTime();
}

// Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
function zonedWallClockToUtc(
  y: number,
  m: number,
  d: number,
  hour: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const off = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - off);
}

// --- seeding ----------------------------------------------------------------

// Idempotently reconcile the `coaches` table to the real roster. Safe to run on
// every boot and from the dev seed: existing rows (keyed by ghl_calendar_id) are
// updated to both-capabilities-on; legacy demo coaches are cleaned up.
export async function seedCoachRoster(): Promise<void> {
  for (const c of COACHING_ROSTER) {
    // Resolve the coach's portal login (if any) to a user id so we can stamp
    // coaches.userId. Looked up by email rather than hard-coded so adding a new
    // coach account is a one-line roster edit. A missing/typo'd email simply
    // leaves userId null (the coach just can't reach their coach-only surfaces yet).
    let userId: number | null = null;
    if (c.userEmail) {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, c.userEmail))
        .limit(1);
      userId = u?.id ?? null;
    }
    await db
      .insert(coachesTable)
      .values({
        name: c.name,
        ghlCalendarId: c.ghlCalendarId,
        ghlLocationId: COACHING_LOCATION_ID,
        sortOrder: c.sortOrder,
        photoUrl: c.photoUrl,
        userId,
        isActive: true,
        doesGroupCalls: true,
        doesPrivateCoaching: true,
      })
      .onConflictDoUpdate({
        target: coachesTable.ghlCalendarId,
        set: {
          name: c.name,
          ghlLocationId: COACHING_LOCATION_ID,
          sortOrder: c.sortOrder,
          photoUrl: c.photoUrl,
          // Only overwrite userId when we resolved one; never clobber an
          // existing link with null because the user row hasn't been created yet
          // on this particular boot.
          ...(userId !== null ? { userId } : {}),
          isActive: true,
          doesGroupCalls: true,
          doesPrivateCoaching: true,
        },
      });
  }

  const placeholders = await db
    .select({ id: coachesTable.id, name: coachesTable.name })
    .from(coachesTable)
    .where(inArray(coachesTable.name, LEGACY_PLACEHOLDER_NAMES));

  for (const ph of placeholders) {
    const [booking] = await db
      .select({ id: sessionPackBookingsTable.id })
      .from(sessionPackBookingsTable)
      .where(eq(sessionPackBookingsTable.coachId, ph.id))
      .limit(1);
    if (booking) {
      await db.update(coachesTable).set({ isActive: false }).where(eq(coachesTable.id, ph.id));
      console.log(`[Seed] Deactivated legacy coach "${ph.name}" (has bookings, kept for history)`);
      continue;
    }
    await db.delete(coachingCallsTable).where(eq(coachingCallsTable.coachId, ph.id));
    await db.delete(coachesTable).where(eq(coachesTable.id, ph.id));
    console.log(`[Seed] Removed legacy demo coach "${ph.name}" and its demo calls`);
  }

  // Move the deprecated coach-row private-coaching calendars into the new
  // per-call-type table, then reconcile the VA roster. Order matters: the
  // strategic upserts above set coaches.ghl* first so the migration copies the
  // current values.
  await migratePrivateCoachingCalendars();
  await seedVaRoster();
}

// Backfill a `private_coaching` row in coach_call_calendars for every coach that
// still carries a private-coaching booking calendar on the deprecated
// coaches.ghl* columns. The new table is the source of truth the booking flow
// reads from; the coach-row columns are kept only as the seed identity key and
// as the migration source. Idempotent: ON CONFLICT DO NOTHING means a row an
// admin has since edited is never clobbered.
async function migratePrivateCoachingCalendars(): Promise<void> {
  const coaches = await db
    .select({
      id: coachesTable.id,
      ghlCalendarId: coachesTable.ghlCalendarId,
      ghlLocationId: coachesTable.ghlLocationId,
      conflictGhlCalendarId: coachesTable.conflictGhlCalendarId,
      conflictGhlLocationId: coachesTable.conflictGhlLocationId,
      isActive: coachesTable.isActive,
    })
    .from(coachesTable)
    .where(isNotNull(coachesTable.ghlCalendarId));

  for (const c of coaches) {
    await db
      .insert(coachCallCalendarsTable)
      .values({
        coachId: c.id,
        callType: "private_coaching",
        bookingCalendarId: c.ghlCalendarId,
        bookingLocationId: c.ghlLocationId,
        conflictCalendarId: c.conflictGhlCalendarId,
        conflictLocationId: c.conflictGhlLocationId,
        isActive: c.isActive,
      })
      // Any conflict (the (coachId, callType) pair OR the unique booking
      // calendar) means it's already migrated — leave the existing row alone.
      .onConflictDoNothing();
  }
}

// Idempotently reconcile the VA roster into the unified `coaches` table. VAs are
// keyed by (name, type === "va") since they have no private-coaching calendar to
// key on. Their bookable 1-on-1 calendars are upserted into coach_call_calendars.
async function seedVaRoster(): Promise<void> {
  for (const va of VA_ROSTER) {
    let userId: number | null = null;
    if (va.userEmail) {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, va.userEmail))
        .limit(1);
      userId = u?.id ?? null;
    }

    const [existing] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(and(eq(coachesTable.name, va.name), eq(coachesTable.type, "va")))
      .limit(1);

    let coachId: number;
    if (existing) {
      await db
        .update(coachesTable)
        .set({
          type: "va",
          sortOrder: va.sortOrder,
          isActive: true,
          doesGroupCalls: false,
          doesPrivateCoaching: false,
          doesOneOnOneVaCalls: va.doesOneOnOneVaCalls,
          // Never clobber an existing link with null because the user row hasn't
          // been created yet on this boot.
          ...(userId !== null ? { userId } : {}),
        })
        .where(eq(coachesTable.id, existing.id));
      coachId = existing.id;
    } else {
      const [ins] = await db
        .insert(coachesTable)
        .values({
          name: va.name,
          type: "va",
          sortOrder: va.sortOrder,
          userId,
          isActive: true,
          doesGroupCalls: false,
          doesPrivateCoaching: false,
          doesOneOnOneVaCalls: va.doesOneOnOneVaCalls,
        })
        .returning({ id: coachesTable.id });
      coachId = ins.id;
      console.log(`[Seed] Added VA "${va.name}"`);
    }

    if (va.oneOnOneVaCalendar) {
      await db
        .insert(coachCallCalendarsTable)
        .values({
          coachId,
          callType: "one_on_one_va",
          bookingCalendarId: va.oneOnOneVaCalendar.bookingCalendarId,
          bookingLocationId: va.oneOnOneVaCalendar.bookingLocationId,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [coachCallCalendarsTable.coachId, coachCallCalendarsTable.callType],
          set: {
            bookingCalendarId: va.oneOnOneVaCalendar.bookingCalendarId,
            bookingLocationId: va.oneOnOneVaCalendar.bookingLocationId,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }
  }
}

// Keep the upcoming weekly group Q&A calls populated from the placeholder
// schedule. Idempotent: never creates a duplicate for a (coach, time) that
// already has an upcoming weekly_qa call.
export async function generateWeeklyQaCalls(): Promise<void> {
  const coaches = await db
    .select({ id: coachesTable.id, name: coachesTable.name })
    .from(coachesTable)
    .where(eq(coachesTable.doesGroupCalls, true));
  const coachByName = new Map(coaches.map((c) => [c.name, c.id]));

  const now = new Date();
  const existing = await db
    .select({
      coachId: coachingCallsTable.coachId,
      scheduledAt: coachingCallsTable.scheduledAt,
    })
    .from(coachingCallsTable)
    .where(
      and(eq(coachingCallsTable.callType, "weekly_qa"), gte(coachingCallsTable.scheduledAt, now)),
    );
  const seen = new Set(existing.map((e) => `${e.coachId}|${e.scheduledAt.getTime()}`));

  // Today's calendar date in the coaching timezone (YYYY-MM-DD).
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: COACHING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [ty, tm, td] = todayStr.split("-").map(Number);

  const toInsert: Array<typeof coachingCallsTable.$inferInsert> = [];
  for (let i = 0; i < WEEKS_AHEAD * 7; i++) {
    const cursor = new Date(Date.UTC(ty, tm - 1, td));
    cursor.setUTCDate(cursor.getUTCDate() + i);
    const weekday = cursor.getUTCDay();
    for (const slot of WEEKLY_QA_SCHEDULE) {
      if (slot.weekday !== weekday) continue;
      const coachId = coachByName.get(slot.coachName);
      if (!coachId) continue;
      const scheduledAt = zonedWallClockToUtc(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
        slot.hour,
        COACHING_TIMEZONE,
      );
      if (scheduledAt.getTime() <= now.getTime()) continue;
      const key = `${coachId}|${scheduledAt.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toInsert.push({
        title: `Weekly Q&A with ${slot.coachName}`,
        description: "Live group Q&A — bring your questions.",
        callType: "weekly_qa",
        coachId,
        scheduledAt,
        durationMinutes: WEEKLY_QA_DURATION_MINUTES,
        requiredEntitlement: WEEKLY_QA_ENTITLEMENT,
        meetLink: GROUP_COACHING_MEET_LINK,
        registeredCount: 0,
      });
    }
  }

  if (toInsert.length > 0) {
    await db.insert(coachingCallsTable).values(toInsert);
    console.log(`[Seed] Generated ${toInsert.length} upcoming weekly Q&A call(s)`);
  }
}
