// Recording-ingest service for pack private coaching calls. For a finished
// booking it searches Google Drive for the call's Meet recording + Gemini
// "Take notes for me" summary/transcript, matches them by meeting title and
// scheduled-time window, and writes the links onto the booking row.
//
// COACH/ADMIN context only — the links written here are excluded from every
// member-facing projection (see MEMBER_BOOKING_COLUMNS in coaching-sessions.ts).

import { db, sessionPackBookingsTable } from "@workspace/db";
import { and, eq, lt, ne, gt, sql } from "drizzle-orm";
import {
  matchBookingFiles,
  type DriveFileMeta,
} from "./coaching-recording-matcher";
import { searchDriveFiles, hasAnyDriveSource } from "./google-drive-client";

// Don't start looking until a session has had time to end + Google to process.
export const INGEST_DELAY_MS = 30 * 60 * 1000; // 30 min after endAt
// Give up (status -> not_found) after this many attempts so we stop scanning.
export const MAX_INGEST_ATTEMPTS = 8;
// Never scan ancient bookings — recordings are long gone / never coming.
export const INGEST_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// How wide to search Drive around the call (mirrors matcher lead/lag).
const SEARCH_LEAD_MS = 30 * 60 * 1000;
const SEARCH_LAG_MS = 6 * 60 * 60 * 1000;

export interface IngestableBooking {
  id: number;
  title: string | null;
  scheduledAt: Date;
  endAt: Date;
  recordingIngestAttempts: number;
}

// Run one ingest attempt for a single booking. Returns the resulting status.
// Pure-ish: all Drive IO goes through the injected/real searchDriveFiles.
export async function ingestBookingRecording(
  booking: IngestableBooking,
): Promise<"found" | "not_found" | "pending" | "error"> {
  const attempts = booking.recordingIngestAttempts + 1;
  try {
    // Search Drive around the call window. We anchor the name search on the
    // coach portion of the title (everything after "with ") when present, else
    // the whole title, so Meet's "<title> (date)" file names still match.
    const nameNeedle = deriveSearchNeedle(booking.title);
    let files: DriveFileMeta[] = [];
    if (nameNeedle) {
      files = await searchDriveFiles({
        nameContains: nameNeedle,
        createdAfter: new Date(booking.scheduledAt.getTime() - SEARCH_LEAD_MS),
        createdBefore: new Date(booking.endAt.getTime() + SEARCH_LAG_MS),
      });
    }

    const match = matchBookingFiles(
      { title: booking.title, scheduledAt: booking.scheduledAt, endAt: booking.endAt },
      files,
    );

    const foundRecording = !!match.recordingUrl;
    // We consider the call "found" once the recording is present; notes/
    // transcript may lag and get filled in on a later attempt while still
    // pending. If nothing at all is found and attempts are exhausted, mark
    // not_found; otherwise stay pending to retry on the next tick.
    let status: "found" | "not_found" | "pending";
    if (foundRecording) {
      status = "found";
    } else if (attempts >= MAX_INGEST_ATTEMPTS) {
      status = "not_found";
    } else {
      status = "pending";
    }

    await db
      .update(sessionPackBookingsTable)
      .set({
        // Only overwrite a link when we actually found one — never clobber a
        // previously-found link with null on a later partial scan.
        ...(match.recordingUrl ? { recordingUrl: match.recordingUrl } : {}),
        ...(match.summaryUrl ? { summaryUrl: match.summaryUrl } : {}),
        ...(match.transcriptUrl ? { transcriptUrl: match.transcriptUrl } : {}),
        recordingIngestStatus: status,
        recordingIngestAt: new Date(),
        recordingIngestAttempts: attempts,
      })
      .where(eq(sessionPackBookingsTable.id, booking.id));

    // A linked recording is strong evidence the call actually happened, so
    // auto-complete the booking. Guarded to booked -> completed only and
    // idempotent: the status='booked' filter means we never override an
    // existing terminal status (completed / no_show / cancelled), so a manual
    // admin outcome always wins and a later partial re-scan is a no-op.
    if (foundRecording) {
      await db
        .update(sessionPackBookingsTable)
        .set({ status: "completed", outcomeAt: new Date() })
        .where(
          and(
            eq(sessionPackBookingsTable.id, booking.id),
            eq(sessionPackBookingsTable.status, "booked"),
          ),
        );
    }

    return status;
  } catch (err) {
    console.error(
      `[CoachingRecordingIngest] booking ${booking.id} attempt ${attempts} failed:`,
      err,
    );
    // Record the failed attempt but keep status retryable until attempts run
    // out, so a transient Drive hiccup doesn't permanently park the booking.
    const status = attempts >= MAX_INGEST_ATTEMPTS ? "error" : "pending";
    await db
      .update(sessionPackBookingsTable)
      .set({
        recordingIngestStatus: status,
        recordingIngestAt: new Date(),
        recordingIngestAttempts: attempts,
      })
      .where(eq(sessionPackBookingsTable.id, booking.id))
      .catch(() => undefined);
    return status === "error" ? "error" : "pending";
  }
}

// Extract the portion of the title most likely to appear in Drive file names.
// "Private Coaching with Sasha" -> "Coaching with Sasha";
// "1-on-1 VA Call with Sasha" -> "VA Call with Sasha". Anchoring on a stable
// keyword keeps the Drive name search tight while still surviving Meet's
// "<title> (date)" file naming. Falls back to the full title. Returns null for
// empty titles (never match — avoids group/internal calls).
export function deriveSearchNeedle(title: string | null): string | null {
  if (!title || !title.trim()) return null;
  const t = title.trim();
  const lower = t.toLowerCase();
  const coachingIdx = lower.indexOf("coaching");
  if (coachingIdx >= 0) return t.slice(coachingIdx);
  const vaCallIdx = lower.indexOf("va call");
  if (vaCallIdx >= 0) return t.slice(vaCallIdx);
  return t;
}

// Select bookings due for an ingest attempt and process them. Skips entirely
// (no-op, no attempt increment) when Drive is not configured, so once the
// integration is connected the backlog is picked up automatically.
export async function runCoachingRecordingIngest(): Promise<void> {
  if (!(await hasAnyDriveSource())) {
    return;
  }

  const now = Date.now();
  const due = await db
    .select({
      id: sessionPackBookingsTable.id,
      title: sessionPackBookingsTable.title,
      scheduledAt: sessionPackBookingsTable.scheduledAt,
      endAt: sessionPackBookingsTable.endAt,
      recordingIngestAttempts: sessionPackBookingsTable.recordingIngestAttempts,
    })
    .from(sessionPackBookingsTable)
    .where(
      and(
        // The call has ended + processing delay elapsed.
        lt(sessionPackBookingsTable.endAt, new Date(now - INGEST_DELAY_MS)),
        // ...but isn't ancient.
        gt(sessionPackBookingsTable.endAt, new Date(now - INGEST_LOOKBACK_MS)),
        // Cancelled sessions never produced a recording.
        ne(sessionPackBookingsTable.status, "cancelled"),
        // Still looking, and attempts remain.
        eq(sessionPackBookingsTable.recordingIngestStatus, "pending"),
        lt(sessionPackBookingsTable.recordingIngestAttempts, MAX_INGEST_ATTEMPTS),
      ),
    )
    .orderBy(sql`${sessionPackBookingsTable.endAt} desc`)
    .limit(50);

  if (due.length === 0) return;

  let found = 0;
  for (const booking of due) {
    const status = await ingestBookingRecording(booking);
    if (status === "found") found += 1;
  }
  console.log(
    `[CoachingRecordingIngest] processed ${due.length} booking(s), ${found} recording(s) linked`,
  );
}
