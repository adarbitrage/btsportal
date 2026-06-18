// Pure matching logic for linking a pack private booking to its Google Drive
// artifacts (Meet recording video + Gemini "Take notes for me" summary doc +
// transcript doc). Deliberately IO-free so it is fully unit-testable without
// any live Google access: callers fetch candidate Drive files and pass them in.
//
// COACH/ADMIN context only — the URLs this produces are never shown to members.

// A Drive file as returned by the Drive v3 files.list endpoint (subset).
export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  // RFC 3339 timestamp string (Drive `createdTime`).
  createdTime: string;
  // Browser-openable link (Drive `webViewLink`).
  webViewLink: string | null;
}

export interface BookingMatchInput {
  // The meeting title used when the GHL appointment / Meet event was created,
  // e.g. "Private Coaching with Sasha". Null titles are never matched (avoids
  // attaching group/internal calls that happen to fall in the time window).
  title: string | null;
  scheduledAt: Date;
  endAt: Date;
}

export interface BookingMatchResult {
  recordingUrl: string | null;
  summaryUrl: string | null;
  transcriptUrl: string | null;
  // Ids of every file that contributed to the result, for logging/debugging.
  matchedFileIds: string[];
}

export interface MatchOptions {
  // How long before the scheduled start a matching file may have been created.
  // Recordings/notes are created at/after the call, but allow a small lead in
  // case of clock skew. Default 15 min.
  leadMs?: number;
  // How long after the call end a matching file may have been created. Google
  // takes time to process & save recordings/notes (minutes to a couple hours).
  // Default 6 hours.
  lagMs?: number;
}

const DEFAULT_LEAD_MS = 15 * 60 * 1000;
const DEFAULT_LAG_MS = 6 * 60 * 60 * 1000;

// Google Drive mime types we care about.
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const VIDEO_MIME_PREFIX = "video/";

// Normalize a string for fuzzy contains-matching: lowercase, strip everything
// that isn't a letter or digit, collapse to single spaces.
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameMatchesTitle(fileName: string, title: string): boolean {
  const normTitle = normalizeForMatch(title);
  if (!normTitle) return false;
  const normName = normalizeForMatch(fileName);
  return normName.includes(normTitle);
}

function isSummary(file: DriveFileMeta): boolean {
  if (file.mimeType !== GOOGLE_DOC_MIME) return false;
  const n = normalizeForMatch(file.name);
  // Gemini "Take notes for me" docs are named like
  // "<Meeting> - Notes by Gemini". Accept either keyword; exclude transcripts.
  if (n.includes("transcript")) return false;
  return n.includes("gemini") || n.includes("notes by") || n.includes("meeting notes");
}

function isTranscript(file: DriveFileMeta): boolean {
  if (file.mimeType !== GOOGLE_DOC_MIME) return false;
  return normalizeForMatch(file.name).includes("transcript");
}

function isRecording(file: DriveFileMeta): boolean {
  return file.mimeType.startsWith(VIDEO_MIME_PREFIX);
}

// Match a booking against a set of candidate Drive files. Files are filtered to
// those whose name contains the booking title AND whose createdTime falls in
// [scheduledAt - lead, endAt + lag]; the best (closest to the call end) file is
// chosen per artifact type. Non-matching files (group/internal calls) are
// ignored, so a no-match simply yields all-null.
export function matchBookingFiles(
  booking: BookingMatchInput,
  files: DriveFileMeta[],
  options: MatchOptions = {},
): BookingMatchResult {
  const empty: BookingMatchResult = {
    recordingUrl: null,
    summaryUrl: null,
    transcriptUrl: null,
    matchedFileIds: [],
  };

  if (!booking.title || !booking.title.trim()) return empty;

  const leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
  const lagMs = options.lagMs ?? DEFAULT_LAG_MS;
  const windowStart = booking.scheduledAt.getTime() - leadMs;
  const windowEnd = booking.endAt.getTime() + lagMs;
  const anchor = booking.endAt.getTime();

  const candidates = files.filter((f) => {
    if (!f.webViewLink) return false;
    if (!nameMatchesTitle(f.name, booking.title!)) return false;
    const created = Date.parse(f.createdTime);
    if (Number.isNaN(created)) return false;
    return created >= windowStart && created <= windowEnd;
  });

  // Among candidates of a given kind, pick the one created closest to call end.
  function pickClosest(kind: (f: DriveFileMeta) => boolean): DriveFileMeta | null {
    let best: DriveFileMeta | null = null;
    let bestDist = Infinity;
    for (const f of candidates) {
      if (!kind(f)) continue;
      const dist = Math.abs(Date.parse(f.createdTime) - anchor);
      if (dist < bestDist) {
        best = f;
        bestDist = dist;
      }
    }
    return best;
  }

  const recording = pickClosest(isRecording);
  const summary = pickClosest(isSummary);
  const transcript = pickClosest(isTranscript);

  const matchedFileIds = [recording, summary, transcript]
    .filter((f): f is DriveFileMeta => f !== null)
    .map((f) => f.id);

  return {
    recordingUrl: recording?.webViewLink ?? null,
    summaryUrl: summary?.webViewLink ?? null,
    transcriptUrl: transcript?.webViewLink ?? null,
    matchedFileIds,
  };
}
