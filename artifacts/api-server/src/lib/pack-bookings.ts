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

// ---------------------------------------------------------------------------
// Manual recording-link override (coach/admin only).
//
// Auto-matching links a Meet recording to a booking by meeting title +
// scheduled-time window. When a call is renamed, started late, or recorded
// ad-hoc, nothing matches and the booking shows "No recording found". A coach
// or admin can then paste the recording / summary / transcript URLs by hand.
//
// Once any link is set manually the booking's ingest status is flipped to
// "manual" so the 15-min auto-ingest pass (which only selects rows in the
// "pending" state) never clobbers the hand-entered links. Clearing every link
// reverts the status to "pending" so auto-ingest can resume.
// ---------------------------------------------------------------------------

export const MANUAL_RECORDING_STATUS = "manual";

const RECORDING_URL_FIELDS = ["recordingUrl", "summaryUrl", "transcriptUrl"] as const;
type RecordingUrlField = (typeof RECORDING_URL_FIELDS)[number];

export type ManualRecordingLinks = Partial<Record<RecordingUrlField, string | null>>;

function isValidHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Parse + validate a manual recording-link payload. Each of recordingUrl /
 * summaryUrl / transcriptUrl may be:
 *   - omitted        → field left unchanged
 *   - "" or null     → field cleared
 *   - an http(s) URL → field set
 * At least one field must be present. Returns the normalized set of provided
 * fields, or a human-readable error message.
 */
export function parseManualRecordingLinks(
  body: unknown,
): { links: ManualRecordingLinks } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const links: ManualRecordingLinks = {};
  let provided = false;

  for (const field of RECORDING_URL_FIELDS) {
    if (!(field in b)) continue;
    provided = true;
    const raw = b[field];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      links[field] = null;
      continue;
    }
    if (typeof raw !== "string") {
      return { error: `${field} must be a URL string or null` };
    }
    const trimmed = raw.trim();
    if (trimmed.length > 2000) {
      return { error: `${field} is too long` };
    }
    if (!isValidHttpUrl(trimmed)) {
      return { error: `${field} must be a valid http(s) URL` };
    }
    links[field] = trimmed;
  }

  if (!provided) {
    return { error: "At least one of recordingUrl, summaryUrl, transcriptUrl is required" };
  }
  return { links };
}

/**
 * Given the booking's existing recording links and the validated set of
 * provided links, compute the ingest-bookkeeping fields to persist:
 *   - any link remains  → status "manual" (so the pending-only auto-ingest
 *     pass never overwrites the hand-entered links).
 *   - all links cleared → status "pending" AND recordingIngestAttempts reset to
 *     0 so the booking is eligible for auto-ingest again. Real "no recording
 *     found" rows typically sit at status="not_found" with attempts at the cap
 *     (MAX_INGEST_ATTEMPTS); without resetting attempts they would stay
 *     ineligible and auto-ingest would never resume.
 */
export function resolveManualRecordingFields(
  existing: ManualRecordingLinks,
  provided: ManualRecordingLinks,
): { recordingIngestStatus: typeof MANUAL_RECORDING_STATUS | "pending"; recordingIngestAttempts?: number } {
  const anyLink = RECORDING_URL_FIELDS.some((field) => {
    const next = field in provided ? provided[field] : existing[field];
    return !!next;
  });
  if (anyLink) {
    return { recordingIngestStatus: MANUAL_RECORDING_STATUS };
  }
  return { recordingIngestStatus: "pending", recordingIngestAttempts: 0 };
}

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
  recordingUrl: string | null;
  summaryUrl: string | null;
  transcriptUrl: string | null;
  recordingIngestStatus: string;
  // Derived (not a column): the session is over, ingest finished looking and
  // found no recording, yet the booking is still "booked". Strong "likely
  // no-show" signal for coach review — but deliberately NOT auto-set to
  // no_show, because no_show triggers a credit refund. Coaches confirm the
  // outcome via the manual mark-completed / no-show override.
  likelyNoShow: boolean;
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
        recordingUrl: sessionPackBookingsTable.recordingUrl,
        summaryUrl: sessionPackBookingsTable.summaryUrl,
        transcriptUrl: sessionPackBookingsTable.transcriptUrl,
        recordingIngestStatus: sessionPackBookingsTable.recordingIngestStatus,
        likelyNoShow: sql<boolean>`(
          ${sessionPackBookingsTable.status} = 'booked'
          AND ${sessionPackBookingsTable.endAt} < now()
          AND ${sessionPackBookingsTable.recordingUrl} IS NULL
          AND ${sessionPackBookingsTable.recordingIngestStatus} <> 'pending'
        )`,
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
