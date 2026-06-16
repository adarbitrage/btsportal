/**
 * Shared query for listing pack 1-on-1 bookings with the member/coach join,
 * status stats and coach-facing fields (coachNotes + actionItems). Used by both
 * the admin sessions list and the coach dashboard so the two stay in lockstep.
 */

import {
  db,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
  usersTable,
  type SessionPackActionItem,
} from "@workspace/db";
import { eq, and, or, desc, ilike, gte, lte, sql, type SQL } from "drizzle-orm";

export const VALID_PACK_STATUSES = new Set([
  "booked",
  "cancelled",
  "completed",
  "no_show",
]);

export interface PackBookingFilters {
  status?: string;
  coachId?: number;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface PackBookingRow {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  coachId: number;
  coachName: string;
  scheduledAt: Date;
  endAt: Date;
  durationMinutes: number;
  meetLink: string | null;
  status: string;
  title: string | null;
  coachNotes: string | null;
  actionItems: SessionPackActionItem[];
  outcomeAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface PackBookingsResult {
  bookings: PackBookingRow[];
  total: number;
  limit: number;
  offset: number;
  stats: Record<string, number>;
}

function buildConditions(filters: PackBookingFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.status && VALID_PACK_STATUSES.has(filters.status)) {
    conditions.push(eq(sessionPackBookingsTable.status, filters.status));
  }
  if (filters.coachId) {
    conditions.push(eq(sessionPackBookingsTable.coachId, filters.coachId));
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(or(ilike(usersTable.name, like), ilike(usersTable.email, like))!);
  }
  if (filters.from) {
    const fromMs = Date.parse(`${filters.from}T00:00:00Z`);
    if (!Number.isNaN(fromMs)) {
      conditions.push(gte(sessionPackBookingsTable.scheduledAt, new Date(fromMs)));
    }
  }
  if (filters.to) {
    const toMs = Date.parse(`${filters.to}T23:59:59.999Z`);
    if (!Number.isNaN(toMs)) {
      conditions.push(lte(sessionPackBookingsTable.scheduledAt, new Date(toMs)));
    }
  }
  return conditions;
}

export async function queryPackBookings(
  filters: PackBookingFilters,
): Promise<PackBookingsResult> {
  const limit = Number.isInteger(filters.limit)
    ? Math.min(Math.max(filters.limit as number, 1), 200)
    : 50;
  const offset =
    Number.isInteger(filters.offset) && (filters.offset as number) > 0
      ? (filters.offset as number)
      : 0;

  const conditions = buildConditions(filters);
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRows, statRows] = await Promise.all([
    db
      .select({
        id: sessionPackBookingsTable.id,
        memberId: sessionPackBookingsTable.memberId,
        memberName: usersTable.name,
        memberEmail: usersTable.email,
        coachId: sessionPackBookingsTable.coachId,
        coachName: sessionPackCoachesTable.name,
        scheduledAt: sessionPackBookingsTable.scheduledAt,
        endAt: sessionPackBookingsTable.endAt,
        durationMinutes: sessionPackBookingsTable.durationMinutes,
        meetLink: sessionPackBookingsTable.meetLink,
        status: sessionPackBookingsTable.status,
        title: sessionPackBookingsTable.title,
        coachNotes: sessionPackBookingsTable.coachNotes,
        actionItems: sessionPackBookingsTable.actionItems,
        outcomeAt: sessionPackBookingsTable.outcomeAt,
        cancelledAt: sessionPackBookingsTable.cancelledAt,
        createdAt: sessionPackBookingsTable.createdAt,
      })
      .from(sessionPackBookingsTable)
      .innerJoin(usersTable, eq(sessionPackBookingsTable.memberId, usersTable.id))
      .innerJoin(
        sessionPackCoachesTable,
        eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
      )
      .where(where)
      .orderBy(desc(sessionPackBookingsTable.scheduledAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionPackBookingsTable)
      .innerJoin(usersTable, eq(sessionPackBookingsTable.memberId, usersTable.id))
      .where(where),
    db
      .select({
        status: sessionPackBookingsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(sessionPackBookingsTable)
      .innerJoin(usersTable, eq(sessionPackBookingsTable.memberId, usersTable.id))
      .where(where)
      .groupBy(sessionPackBookingsTable.status),
  ]);

  const stats: Record<string, number> = {
    booked: 0,
    cancelled: 0,
    completed: 0,
    no_show: 0,
  };
  for (const s of statRows) {
    if (s.status) stats[s.status] = Number(s.count);
  }

  return {
    bookings: rows as PackBookingRow[],
    total: Number(countRows[0]?.count ?? 0),
    limit,
    offset,
    stats,
  };
}
