import { db, ticketSlaTable, ticketsTable } from "@workspace/db";
import { eq, and, isNull, lt, sql } from "drizzle-orm";
import { getUserEntitlements } from "./entitlements";
import { getHighestProductLabel } from "./entitlements";

interface SlaTargets {
  tierSlug: string;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export function getSlaTargetsForTier(tierSlug: string): SlaTargets {
  switch (tierSlug) {
    case "lifetime":
      return { tierSlug, firstResponseMinutes: 120, resolutionMinutes: 720 };
    case "1year":
      return { tierSlug, firstResponseMinutes: 240, resolutionMinutes: 1440 };
    case "6month":
      return { tierSlug, firstResponseMinutes: 240, resolutionMinutes: 1440 };
    case "3month":
      return { tierSlug, firstResponseMinutes: 480, resolutionMinutes: 2880 };
    case "launchpad":
      return { tierSlug, firstResponseMinutes: 480, resolutionMinutes: 2880 };
    case "frontend":
      return { tierSlug, firstResponseMinutes: 720, resolutionMinutes: 4320 };
    case "free":
    default:
      return { tierSlug: "free", firstResponseMinutes: 1440, resolutionMinutes: 7200 };
  }
}

export async function createSlaForTicket(ticketId: number, userId: number): Promise<void> {
  const entitlements = await getUserEntitlements(userId);
  const highest = getHighestProductLabel(entitlements);
  const targets = getSlaTargetsForTier(highest.slug);

  await db.insert(ticketSlaTable).values({
    ticketId,
    tierSlug: targets.tierSlug,
    firstResponseTargetMinutes: targets.firstResponseMinutes,
    resolutionTargetMinutes: targets.resolutionMinutes,
  });
}

export function isBusinessHour(date: Date): boolean {
  const et = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const hour = et.getHours();
  if (day === 0 || day === 6) return false;
  if (hour < 9 || hour >= 18) return false;
  return true;
}

function toET(date: Date): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
}

export function calculateBusinessMinutesFast(start: Date, end: Date): number {
  if (end <= start) return 0;

  let minutes = 0;
  const current = new Date(start);
  const BIZ_START = 9;
  const BIZ_END = 18;
  const MINUTES_PER_BIZ_DAY = (BIZ_END - BIZ_START) * 60;

  const et = toET(current);
  const day = et.getDay();
  const hour = et.getHours();
  const min = et.getMinutes();

  if (day >= 1 && day <= 5 && hour >= BIZ_START && hour < BIZ_END) {
    const remainingToday = (BIZ_END * 60) - (hour * 60 + min);
    const endOfBizToday = new Date(current.getTime() + remainingToday * 60000);

    if (end <= endOfBizToday) {
      return Math.floor((end.getTime() - current.getTime()) / 60000);
    }

    minutes += remainingToday;
    current.setTime(endOfBizToday.getTime());
  } else {
    const nextBizStart = getNextBusinessStart(current);
    if (end <= nextBizStart) return 0;
    current.setTime(nextBizStart.getTime());
  }

  while (current < end) {
    const currentET = toET(current);
    const currentDay = currentET.getDay();

    if (currentDay === 0 || currentDay === 6) {
      const nextBizStart = getNextBusinessStart(current);
      if (nextBizStart >= end) break;
      current.setTime(nextBizStart.getTime());
      continue;
    }

    const currentHour = currentET.getHours();
    if (currentHour < BIZ_START) {
      const todayBizStart = new Date(current);
      todayBizStart.setTime(current.getTime() + (BIZ_START - currentHour) * 3600000 - currentET.getMinutes() * 60000);
      current.setTime(todayBizStart.getTime());
      continue;
    }

    if (currentHour >= BIZ_END) {
      const nextBizStart = getNextBusinessStart(current);
      if (nextBizStart >= end) break;
      current.setTime(nextBizStart.getTime());
      continue;
    }

    const remainingToday = (BIZ_END * 60) - (currentHour * 60 + currentET.getMinutes());
    const endOfBizToday = new Date(current.getTime() + remainingToday * 60000);

    if (end <= endOfBizToday) {
      minutes += Math.floor((end.getTime() - current.getTime()) / 60000);
      break;
    }

    minutes += remainingToday;
    current.setTime(endOfBizToday.getTime());
  }

  return minutes;
}

function getNextBusinessStart(date: Date): Date {
  const et = toET(date);
  const day = et.getDay();
  const hour = et.getHours();

  let daysToAdd = 0;
  if (day === 6) daysToAdd = 2;
  else if (day === 0) daysToAdd = 1;
  else if (hour >= 18) daysToAdd = day === 5 ? 3 : 1;
  else daysToAdd = 0;

  if (daysToAdd === 0 && hour < 9) {
    const result = new Date(date);
    result.setTime(date.getTime() + (9 - hour) * 3600000 - et.getMinutes() * 60000 - et.getSeconds() * 1000);
    return result;
  }

  if (daysToAdd === 0) daysToAdd = day === 5 ? 3 : 1;

  const result = new Date(date);
  result.setTime(date.getTime() + daysToAdd * 86400000);
  const resultET = toET(result);
  result.setTime(result.getTime() + (9 - resultET.getHours()) * 3600000 - resultET.getMinutes() * 60000 - resultET.getSeconds() * 1000);
  return result;
}

export async function recordFirstResponse(ticketId: number): Promise<void> {
  const [sla] = await db.select().from(ticketSlaTable).where(eq(ticketSlaTable.ticketId, ticketId));
  if (!sla || sla.firstResponseAt) return;

  await db.update(ticketSlaTable)
    .set({ firstResponseAt: new Date() })
    .where(eq(ticketSlaTable.ticketId, ticketId));
}

export async function pauseSla(ticketId: number): Promise<void> {
  const [sla] = await db.select().from(ticketSlaTable).where(eq(ticketSlaTable.ticketId, ticketId));
  if (!sla || sla.pausedAt) return;

  await db.update(ticketSlaTable)
    .set({ pausedAt: new Date() })
    .where(eq(ticketSlaTable.ticketId, ticketId));
}

export async function resumeSla(ticketId: number): Promise<void> {
  const [sla] = await db.select().from(ticketSlaTable).where(eq(ticketSlaTable.ticketId, ticketId));
  if (!sla || !sla.pausedAt) return;

  const pausedMinutes = calculateBusinessMinutesFast(sla.pausedAt, new Date());

  await db.update(ticketSlaTable)
    .set({
      pausedAt: null,
      totalPausedMinutes: sla.totalPausedMinutes + pausedMinutes,
    })
    .where(eq(ticketSlaTable.ticketId, ticketId));
}

export async function checkSlaBreaches(): Promise<{ warnings: number; breaches: number }> {
  const now = new Date();
  let warnings = 0;
  let breaches = 0;

  const openSlas = await db
    .select({
      sla: ticketSlaTable,
      ticketStatus: ticketsTable.status,
    })
    .from(ticketSlaTable)
    .innerJoin(ticketsTable, eq(ticketSlaTable.ticketId, ticketsTable.id))
    .where(
      and(
        isNull(ticketSlaTable.pausedAt),
        sql`${ticketsTable.status} NOT IN ('resolved', 'closed')`
      )
    );

  for (const { sla, ticketStatus } of openSlas) {
    const effectiveStart = sla.createdAt;
    const elapsed = calculateBusinessMinutesFast(effectiveStart, now) - sla.totalPausedMinutes;

    if (!sla.firstResponseAt) {
      const firstResponsePct = elapsed / sla.firstResponseTargetMinutes;
      if (firstResponsePct >= 1 && !sla.firstResponseBreached) {
        await db.update(ticketSlaTable)
          .set({ firstResponseBreached: true })
          .where(eq(ticketSlaTable.id, sla.id));
        breaches++;
        console.log(`[SLA] First response BREACHED for ticket SLA ${sla.id} (ticket ${sla.ticketId})`);
      } else if (firstResponsePct >= 0.8 && !sla.firstResponseWarning) {
        await db.update(ticketSlaTable)
          .set({ firstResponseWarning: true })
          .where(eq(ticketSlaTable.id, sla.id));
        warnings++;
        console.log(`[SLA] First response WARNING (80%) for ticket SLA ${sla.id} (ticket ${sla.ticketId})`);
      }
    }

    const resolutionPct = elapsed / sla.resolutionTargetMinutes;
    if (resolutionPct >= 1 && !sla.resolutionBreached) {
      await db.update(ticketSlaTable)
        .set({ resolutionBreached: true })
        .where(eq(ticketSlaTable.id, sla.id));
      breaches++;
      console.log(`[SLA] Resolution BREACHED for ticket SLA ${sla.id} (ticket ${sla.ticketId})`);
    } else if (resolutionPct >= 0.8 && !sla.resolutionWarning) {
      await db.update(ticketSlaTable)
        .set({ resolutionWarning: true })
        .where(eq(ticketSlaTable.id, sla.id));
      warnings++;
      console.log(`[SLA] Resolution WARNING (80%) for ticket SLA ${sla.id} (ticket ${sla.ticketId})`);
    }
  }

  return { warnings, breaches };
}
