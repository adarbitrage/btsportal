import { db, coachAvailabilityTable, coachAvailabilityOverridesTable, coachingSessionsTable, coachingCallsTable, coachesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addMinutes, format, parseISO, addDays, isBefore, isAfter } from "date-fns";

export interface TimeSlot {
  startTime: string;
  endTime: string;
  coachId: number;
}

const SESSION_DURATION = 60;
const SLOT_INCREMENT = 60;

export async function getAvailableSlots(
  coachId: number,
  startDate: string,
  endDate: string,
  memberTimezone: string = "America/New_York"
): Promise<TimeSlot[]> {
  const coach = await db.select().from(coachesTable).where(eq(coachesTable.id, coachId)).then(r => r[0]);
  if (!coach || !coach.oneOnOneEnabled) return [];

  const coachTz = coach.timezone;

  const rangeStart = parseISO(startDate);
  const rangeEnd = parseISO(endDate);

  const availability = await db
    .select()
    .from(coachAvailabilityTable)
    .where(eq(coachAvailabilityTable.coachId, coachId));

  const overrides = await db
    .select()
    .from(coachAvailabilityOverridesTable)
    .where(
      and(
        eq(coachAvailabilityOverridesTable.coachId, coachId),
        gte(coachAvailabilityOverridesTable.overrideDate, startDate),
        lte(coachAvailabilityOverridesTable.overrideDate, endDate)
      )
    );

  const utcStart = fromZonedTime(rangeStart, memberTimezone);
  const utcEnd = fromZonedTime(addDays(rangeEnd, 1), memberTimezone);

  const existingBookings = await db
    .select({ scheduledAt: coachingSessionsTable.scheduledAt, durationMinutes: coachingSessionsTable.durationMinutes })
    .from(coachingSessionsTable)
    .where(
      and(
        eq(coachingSessionsTable.coachId, coachId),
        eq(coachingSessionsTable.status, "scheduled"),
        gte(coachingSessionsTable.scheduledAt, utcStart),
        lte(coachingSessionsTable.scheduledAt, utcEnd)
      )
    );

  const groupCalls = await db
    .select({ scheduledAt: coachingCallsTable.scheduledAt, durationMinutes: coachingCallsTable.durationMinutes })
    .from(coachingCallsTable)
    .where(
      and(
        eq(coachingCallsTable.coachId, coachId),
        gte(coachingCallsTable.scheduledAt, utcStart),
        lte(coachingCallsTable.scheduledAt, utcEnd)
      )
    );

  const blockedRanges = [
    ...existingBookings.map(b => ({
      start: new Date(b.scheduledAt).getTime(),
      end: addMinutes(new Date(b.scheduledAt), b.durationMinutes).getTime(),
    })),
    ...groupCalls.map(c => ({
      start: new Date(c.scheduledAt).getTime(),
      end: addMinutes(new Date(c.scheduledAt), c.durationMinutes).getTime(),
    })),
  ];

  const overrideMap = new Map<string, typeof overrides[0][]>();
  for (const o of overrides) {
    const dateStr = typeof o.overrideDate === 'string' ? o.overrideDate : format(new Date(o.overrideDate), "yyyy-MM-dd");
    if (!overrideMap.has(dateStr)) overrideMap.set(dateStr, []);
    overrideMap.get(dateStr)!.push(o);
  }

  const slots: TimeSlot[] = [];
  const now = new Date();
  const minBookingTime = addMinutes(now, 120);

  let currentDate = new Date(rangeStart);
  while (!isAfter(currentDate, rangeEnd)) {
    const dateStr = format(currentDate, "yyyy-MM-dd");
    const coachDate = toZonedTime(fromZonedTime(currentDate, memberTimezone), coachTz);
    const coachDateStr = format(coachDate, "yyyy-MM-dd");
    const dayOfWeek = coachDate.getDay();

    const dateOverrides = overrideMap.get(coachDateStr) || [];
    const hasBlockedOverride = dateOverrides.some(o => (o as any).isBlocked);

    if (hasBlockedOverride) {
      currentDate = addDays(currentDate, 1);
      continue;
    }

    const customOverrides = dateOverrides.filter(o => !(o as any).isBlocked && o.startTime && o.endTime);

    let dayWindows: { startTime: string; endTime: string }[] = [];

    if (customOverrides.length > 0) {
      dayWindows = customOverrides.map(o => ({ startTime: o.startTime!, endTime: o.endTime! }));
    } else {
      const recurringSlots = availability.filter(a => a.dayOfWeek === dayOfWeek);
      dayWindows = recurringSlots.map(a => ({ startTime: a.startTime, endTime: a.endTime }));
    }

    for (const window of dayWindows) {
      const [startH, startM] = window.startTime.split(":").map(Number);
      const [endH, endM] = window.endTime.split(":").map(Number);

      const windowStartCoach = fromZonedTime(
        new Date(coachDate.getFullYear(), coachDate.getMonth(), coachDate.getDate(), startH, startM),
        coachTz
      );
      const windowEndCoach = fromZonedTime(
        new Date(coachDate.getFullYear(), coachDate.getMonth(), coachDate.getDate(), endH, endM),
        coachTz
      );

      let slotStart = windowStartCoach;
      while (addMinutes(slotStart, SESSION_DURATION).getTime() <= windowEndCoach.getTime()) {
        const slotEnd = addMinutes(slotStart, SESSION_DURATION);

        if (isBefore(slotStart, minBookingTime)) {
          slotStart = addMinutes(slotStart, SLOT_INCREMENT);
          continue;
        }

        const slotStartMs = slotStart.getTime();
        const slotEndMs = slotEnd.getTime();
        const hasConflict = blockedRanges.some(
          br => slotStartMs < br.end && slotEndMs > br.start
        );

        if (!hasConflict) {
          slots.push({
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            coachId,
          });
        }

        slotStart = addMinutes(slotStart, SLOT_INCREMENT);
      }
    }

    currentDate = addDays(currentDate, 1);
  }

  slots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const dailyCounts = new Map<string, number>();
  const filteredSlots: TimeSlot[] = [];

  for (const slot of slots) {
    const coachDay = format(toZonedTime(new Date(slot.startTime), coachTz), "yyyy-MM-dd");
    const count = dailyCounts.get(coachDay) || 0;

    const existingOnDay = existingBookings.filter(b => {
      const bDay = format(toZonedTime(new Date(b.scheduledAt), coachTz), "yyyy-MM-dd");
      return bDay === coachDay;
    }).length;

    if (existingOnDay + count < coach.maxDailySessions) {
      filteredSlots.push(slot);
      dailyCounts.set(coachDay, count + 1);
    }
  }

  return filteredSlots;
}
