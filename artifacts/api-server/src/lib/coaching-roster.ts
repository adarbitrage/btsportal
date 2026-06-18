import { db, coachesTable, coachingCallsTable, sessionPackBookingsTable } from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";
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
}

export const COACHING_ROSTER: RosterCoach[] = [
  { name: "Sasha", ghlCalendarId: "BdBxOw8kL1aF7VfJR5cc", sortOrder: 1, photoUrl: "/coaching-photos/sasha.png" },
  { name: "Bruce", ghlCalendarId: "0feHbG6YfH2apzvdmR3U", sortOrder: 2, photoUrl: "/coaching-photos/bruce.jpg" },
  { name: "Michael", ghlCalendarId: "JF7LYxF5KRQImZpvSrHo", sortOrder: 3, photoUrl: "/coaching-photos/michael.png" },
  { name: "Todd", ghlCalendarId: "JiTLouUKzGeYrsPtEmK5", sortOrder: 4, photoUrl: "/coaching-photos/todd.jpeg" },
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
    await db
      .insert(coachesTable)
      .values({
        name: c.name,
        ghlCalendarId: c.ghlCalendarId,
        ghlLocationId: COACHING_LOCATION_ID,
        sortOrder: c.sortOrder,
        photoUrl: c.photoUrl,
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
