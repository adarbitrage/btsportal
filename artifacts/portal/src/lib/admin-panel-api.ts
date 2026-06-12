import { authFetch } from "./auth";

/**
 * Pull a human-readable message out of an error response body, tolerating both
 * shapes the API emits: route handlers return `{ error: "string" }`, while the
 * shared `sendError`/RBAC layer returns `{ error: { code, message, requestId } }`.
 * Without this, `data.error` from the structured shape is an object and
 * `new Error(object)` renders as the useless "[object Object]" toast.
 */
function extractApiError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const err = (data as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return undefined;
}

export type StreamDownloadProgress = {
  bytesReceived: number;
  rowsReceived: number | null;
};

export type StreamDownloadResult = {
  blob: Blob;
  bytesReceived: number;
  rowsReceived: number | null;
};

/**
 * Stream a large download from the admin API while surfacing incremental
 * "still working, here's how much has arrived" feedback. Reading the body as
 * chunks (instead of `await res.blob()`) lets callers wire a progress hint
 * into the UI during a multi-second pull, which is what the audit-log /
 * communications-log / members exports use to disable their buttons + render
 * a transient "Downloading… N rows · K KB" line.
 *
 * - `format` should be one of "csv" | "json" so we can decide whether to
 *   approximate row count by counting newlines (CSV) or leave it null (JSON,
 *   where commas across chunk boundaries are brittle to count). Any other
 *   value just disables the row counter.
 * - `onProgress` is throttled to ~one call per 150ms so a fast connection
 *   doesn't thrash React with hundreds of setStates per second; the final
 *   sample is always force-emitted so the UI can surface the authoritative
 *   final byte/row count.
 * - On platforms (or test fakes) that don't expose `res.body.getReader`,
 *   we fall back to a plain `.blob()` read and still emit one final
 *   progress sample so the caller's UI cleanup paths run.
 */
export async function streamDownload(
  res: Response,
  format: "csv" | "json" | string,
  onProgress?: (progress: StreamDownloadProgress) => void,
): Promise<StreamDownloadResult> {
  const isCsv = format === "csv";
  const contentType = res.headers.get("content-type") ?? (isCsv ? "text/csv" : "application/json");

  const reader = res.body?.getReader?.();
  if (!reader) {
    const blob = await res.blob();
    const final = { bytesReceived: blob.size, rowsReceived: null as number | null };
    onProgress?.(final);
    return { blob, ...final };
  }

  const chunks: BlobPart[] = [];
  let bytesReceived = 0;
  let newlineCount = 0;
  let lastEmit = 0;
  const NEWLINE = 0x0a;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const emit = (force: boolean) => {
    if (!onProgress) return;
    const t = now();
    if (!force && t - lastEmit < 150) return;
    lastEmit = t;
    const rowsReceived = isCsv ? Math.max(0, newlineCount - 1) : null;
    onProgress({ bytesReceived, rowsReceived });
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        bytesReceived += value.byteLength;
        // For CSV we approximate rows-so-far by counting newlines on the
        // raw bytes — fast, no decoding, and ~accurate where row content is
        // mostly single-line. Descriptions that contain embedded LFs
        // (RFC 4180 wraps them in quotes) will slightly over-count, but
        // this value is only a "things are happening" hint during the
        // download; the final toast still reports an authoritative count
        // from the read endpoint. JSON exports leave rowsReceived null.
        if (isCsv) {
          for (let i = 0; i < value.byteLength; i++) {
            if (value[i] === NEWLINE) newlineCount++;
          }
        }
        emit(false);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }

  const blob = new Blob(chunks, { type: contentType });
  const rowsReceived = isCsv ? Math.max(0, newlineCount - 1) : null;
  emit(true);
  return { blob, bytesReceived, rowsReceived };
}

/**
 * Trigger a "Save As…" dialog in the browser for an in-memory blob. Used by
 * the streaming export buttons after `streamDownload` resolves.
 */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * RFC 4180-aware streaming CSV row counter. The audit-log export body has
 * a free-text `description` column whose value the server quotes whenever
 * it contains `\n`/`\r`/`,`/`"`, escaping inner `"` as `""`. A naive
 * newline counter would inflate row counts on multi-line descriptions and
 * cause false-positive (or missed) truncation warnings — this state
 * machine counts only the row-terminating LFs that appear OUTSIDE quoted
 * fields. State is held in the closure so it survives chunk boundaries:
 *
 *   - `inQuotes`: currently inside `"..."`.
 *   - `pendingQuote`: the previous in-quotes byte was `"`, so the next
 *     byte tells us whether this is an escaped `""` (stay in quotes) or
 *     the closing quote of the field (back to unquoted mode). This split
 *     lets the state survive a `"` byte that lands at the very end of
 *     one chunk followed by another `"` at the start of the next.
 *   - `headerLfSeen`: the header's terminating `\n` (which must be
 *     outside quotes) has been observed.
 *   - `sawDataAfterHeader`: at least one byte appeared past the header
 *     LF — used to add the implicit final row that has no trailing LF.
 *
 * Returned counts:
 *   - 0 rows: body is just `header\n` → `headerLfSeen=true`,
 *     `sawDataAfterHeader=false` → 0.
 *   - N rows: body is `header\nrow1\nrow2\n…rowN` → N−1 inter-row LFs
 *     counted, plus +1 for the no-trailing-LF tail → N.
 */
type CsvRowCounter = {
  feedByte(c: number): void;
  feedBytes(bytes: Uint8Array): void;
  getCount(): number;
};

function createCsvRowCounter(): CsvRowCounter {
  let interRow = 0;
  let inQuotes = false;
  let pendingQuote = false;
  let headerLfSeen = false;
  let sawDataAfterHeader = false;

  const feedByte = (c: number) => {
    if (pendingQuote) {
      pendingQuote = false;
      if (c === 0x22 /* " */) {
        // Escaped `""` inside a quoted field — stay in quotes.
        if (headerLfSeen) sawDataAfterHeader = true;
        return;
      }
      // The pending quote was the closing quote of a quoted field;
      // fall through to process this byte in unquoted mode.
      inQuotes = false;
    }
    if (inQuotes) {
      if (c === 0x22 /* " */) {
        pendingQuote = true;
      }
      // Any other byte (including `\n` or `\r`) is just data inside
      // the quoted field and must NOT terminate a row.
      if (headerLfSeen) sawDataAfterHeader = true;
      return;
    }
    // Unquoted state.
    if (c === 0x22 /* " */) {
      // A quote in unquoted mode opens a quoted field. (Strictly RFC
      // 4180 only allows this at the start of a field, but quoted
      // fields are the only legal source of a `"` byte in our server's
      // output, so accepting it anywhere is safe and forgiving.)
      inQuotes = true;
      if (headerLfSeen) sawDataAfterHeader = true;
      return;
    }
    if (c === 0x0a /* \n */) {
      if (!headerLfSeen) {
        headerLfSeen = true;
      } else {
        interRow++;
      }
      return;
    }
    if (headerLfSeen) sawDataAfterHeader = true;
  };

  const feedBytes = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.byteLength; i++) feedByte(bytes[i]);
  };

  const getCount = () =>
    headerLfSeen && sawDataAfterHeader ? interRow + 1 : 0;

  return { feedByte, feedBytes, getCount };
}

/**
 * Count CSV data rows in a fully-assembled audit-log export body.
 * Thin wrapper around the shared `CsvRowCounter` state machine so the
 * `.blob()` fallback path returns the exact same count as the streaming
 * path for the same body — including bodies whose `description` column
 * has embedded newlines wrapped in RFC 4180 quotes.
 */
function countCsvRowsFromText(text: string): number {
  if (text.length === 0) return 0;
  const counter = createCsvRowCounter();
  for (let i = 0; i < text.length; i++) counter.feedByte(text.charCodeAt(i));
  return counter.getCount();
}

/**
 * Count top-level objects in a JSON-array audit-log export body, using a
 * tiny brace-depth state machine that correctly skips braces inside
 * strings and escapes. Mirrors the streaming counter in `exportAuditLog`
 * so both paths produce the same value. Used by the `.blob()` fallback.
 */
function countJsonRowsFromText(text: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === 0x5c) {
        escape = true;
      } else if (c === 0x22) {
        inString = false;
      }
      continue;
    }
    if (c === 0x22) {
      inString = true;
    } else if (c === 0x7b) {
      if (depth === 0) count++;
      depth++;
    } else if (c === 0x7d) {
      depth--;
    }
  }
  return count;
}

export type AuthRateLimitAlertConfig = {
  threshold: number;
  windowMinutes: number;
  dominantIpRatio: number;
};

export type AuthRateLimitAlertConfigStatus = {
  config: AuthRateLimitAlertConfig;
  sources: Record<keyof AuthRateLimitAlertConfig, "db" | "default">;
  defaults: AuthRateLimitAlertConfig;
  bounds: {
    threshold: { min: number; max: number };
    windowMinutes: { min: number; max: number };
    dominantIpRatio: { min: number; max: number };
  };
};

export type AuthRateLimitAlertTrafficPreview = {
  lookbackDays: number;
  lookbackStart: string;
  generatedAt: string;
  totalHits: number;
  dailyBuckets: Array<{ dayStart: string; hits: number }>;
  eventTimestampsMs: number[] | null;
  truncated: boolean;
};

export type ModerationFailureAlertConfig = {
  threshold: number;
  windowMinutes: number;
};

export type ModerationFailureAlertConfigStatus = {
  config: ModerationFailureAlertConfig;
  sources: Record<keyof ModerationFailureAlertConfig, "db" | "default">;
  defaults: ModerationFailureAlertConfig;
  bounds: {
    threshold: { min: number; max: number };
    windowMinutes: { min: number; max: number };
  };
};

export type MachineMismatchAlertConfig = {
  threshold: number;
  windowHours: number;
};

export type MachineMismatchAlertConfigStatus = {
  config: MachineMismatchAlertConfig;
  sources: Record<keyof MachineMismatchAlertConfig, "db" | "default">;
  defaults: MachineMismatchAlertConfig;
  bounds: {
    threshold: { min: number; max: number };
    windowHours: { min: number; max: number };
  };
};

export type DigestAlerterTuning = {
  thresholdMultiplier: number;
  notificationThrottleMs: number;
};

export type DigestAlerterTuningField = keyof DigestAlerterTuning;

export type DigestAlerterTuningStatus = {
  config: DigestAlerterTuning;
  sources: Record<DigestAlerterTuningField, "db" | "env" | "default">;
  defaults: DigestAlerterTuning;
  bounds: Record<DigestAlerterTuningField, { min: number; max: number }>;
};

export type DigestWatchdogState = {
  firing: boolean;
  enabled: boolean;
  evaluatedAt: string;
  health: {
    stale: boolean;
    failed: boolean;
    alerting: boolean;
    ageMs: number;
    thresholdMultiplier: number;
  };
  status: {
    intervalMs: number;
    lastRanAt: string | null;
    lastOutcome: string | null;
  };
};

export type AiModerationThresholdConfig = {
  flagThreshold: number;
};

export type AiModerationThresholdConfigStatus = {
  config: AiModerationThresholdConfig;
  sources: Record<keyof AiModerationThresholdConfig, "db" | "default">;
  defaults: AiModerationThresholdConfig;
  bounds: {
    flagThreshold: { min: number; max: number };
  };
};

export type AiModerationThresholdPreview = {
  threshold: number;
  currentThreshold: number;
  sampleWindowDays: number;
  sampleSize: number;
  wouldBeFlaggedByAi: number;
  currentlyFlaggedByAi: number;
};

export type ChangeHistoryRetentionConfig = {
  emailRetentionDays: number;
  phoneRetentionDays: number;
};

export type ChangeHistoryRetentionConfigStatus = {
  config: ChangeHistoryRetentionConfig;
  sources: Record<keyof ChangeHistoryRetentionConfig, "db" | "default">;
  defaults: ChangeHistoryRetentionConfig;
  bounds: {
    emailRetentionDays: { min: number; max: number };
    phoneRetentionDays: { min: number; max: number };
  };
};

export const adminPanelApi = {
  async getDashboardKpis() {
    const res = await authFetch("/admin/dashboard/kpis");
    if (!res.ok) throw new Error("Failed to fetch KPIs");
    return res.json();
  },

  async getActivityChart() {
    const res = await authFetch("/admin/dashboard/activity-chart");
    if (!res.ok) throw new Error("Failed to fetch activity chart");
    return res.json();
  },

  async getNeedsAttention() {
    const res = await authFetch("/admin/dashboard/needs-attention");
    if (!res.ok) throw new Error("Failed to fetch alerts");
    return res.json();
  },

  async getRecentActivity() {
    const res = await authFetch("/admin/dashboard/recent-activity");
    if (!res.ok) throw new Error("Failed to fetch recent activity");
    return res.json();
  },

  async search(q: string) {
    const res = await authFetch(`/admin/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error("Search failed");
    return res.json();
  },

  async getAuditLog(params: {
    page?: number;
    limit?: number;
    actionType?: string;
    entityType?: string;
    startDate?: string;
    endDate?: string;
    outcome?: string;
    expand?: number;
    cursor?: string;
    direction?: "forward" | "backward";
    jumpTo?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.actionType) qs.set("actionType", params.actionType);
    if (params.entityType) qs.set("entityType", params.entityType);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.outcome) qs.set("outcome", params.outcome);
    if (params.expand != null) qs.set("expand", String(params.expand));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.direction) qs.set("direction", params.direction);
    if (params.jumpTo) qs.set("jumpTo", params.jumpTo);
    const res = await authFetch(`/admin/audit-log?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch audit log");
    return res.json();
  },

  async exportAuditLog(
    format: string = "csv",
    filters: { actionType?: string; entityType?: string; startDate?: string; endDate?: string; outcome?: string } = {},
    onProgress?: (progress: StreamDownloadProgress) => void,
    // Optional AbortSignal so callers can cancel an in-flight export
    // (e.g. the admin realises the filters are wrong mid-download).
    // Aborting tears down the underlying fetch *and* the reader loop —
    // the streaming reader.read() rejects with AbortError, which the
    // caller is expected to recognise as a user-initiated cancellation
    // rather than an unexpected failure.
    signal?: AbortSignal,
  ): Promise<{
    blob: Blob;
    bytesReceived: number;
    rowsReceived: number | null;
    /**
     * Hard cap the server enforced on this export, read from the up-front
     * `X-Audit-Log-Hard-Cap` response header. Returned even when the body
     * stream is short of the cap so callers can render the cap value in
     * truncation warnings. `null` when the server did not advertise a cap
     * (older builds, test fakes that omit the header).
     */
    hardCap: number | null;
    /**
     * Server-authoritative truncation flag, when readable. Set from the
     * `X-Audit-Log-Truncated` HTTP trailer (well-behaved non-browser
     * clients) — browsers' fetch() does not expose trailers, so this is
     * almost always `null` in the portal and the caller must derive
     * truncation from `rowsReceived` and `hardCap` instead.
     */
    truncated: boolean | null;
  }> {
    const qs = new URLSearchParams();
    qs.set("format", format);
    if (filters.actionType) qs.set("actionType", filters.actionType);
    if (filters.entityType) qs.set("entityType", filters.entityType);
    if (filters.startDate) qs.set("startDate", filters.startDate);
    if (filters.endDate) qs.set("endDate", filters.endDate);
    if (filters.outcome) qs.set("outcome", filters.outcome);
    const res = await authFetch(`/admin/audit-log/export?${qs.toString()}`, { signal });
    if (!res.ok) throw new Error("Failed to export audit log");

    const isCsv = format === "csv";
    const contentType = res.headers.get("content-type") ?? (isCsv ? "text/csv" : "application/json");

    // Up-front header advertising the export's hard cap. We read it now
    // (before consuming the body) so the value is available regardless of
    // whether the body comes through the streaming path or the .blob()
    // fallback below. Parse defensively: a malformed value should fall
    // back to "unknown" rather than poisoning the truncation derivation.
    const hardCapRaw = res.headers.get("x-audit-log-hard-cap");
    const hardCapParsed = hardCapRaw != null ? Number.parseInt(hardCapRaw, 10) : NaN;
    const hardCap: number | null = Number.isInteger(hardCapParsed) && hardCapParsed > 0
      ? hardCapParsed
      : null;

    // Trailers are the server's source of truth for truncation, but
    // browsers' fetch() exposes neither `res.trailers` nor a way to read
    // them. Test fakes and non-browser fetch implementations sometimes
    // do, hence the defensive `(res as any).trailers` lookup. When
    // present we treat the trailer as authoritative; otherwise the caller
    // derives truncation from `rowsReceived` and `hardCap`.
    const readTrailerTruncated = (): boolean | null => {
      const trailersBag = (res as unknown as { trailers?: unknown }).trailers;
      if (!trailersBag) return null;
      const get =
        typeof (trailersBag as Headers).get === "function"
          ? (k: string) => (trailersBag as Headers).get(k)
          : (k: string) => {
              const obj = trailersBag as Record<string, string | undefined>;
              return obj[k] ?? obj[k.toLowerCase()] ?? null;
            };
      const raw = get("X-Audit-Log-Truncated") ?? get("x-audit-log-truncated");
      if (raw == null) return null;
      return raw === "true";
    };

    // The server streams the entire result set in chunks. Reading the body
    // through a ReadableStream lets us surface "still working, here's how much
    // has arrived" feedback during a multi-second download instead of the user
    // staring at a frozen button. Falls back to a plain `.blob()` read on
    // platforms (or test fakes) that don't expose a body stream — we still
    // return a final progress sample so callers can finalise their UI.
    const reader = res.body?.getReader?.();
    if (!reader) {
      const blob = await res.blob();
      // Best-effort row count from the assembled blob: CSV by counting
      // newlines, JSON by counting top-level objects via the same state
      // machine the streaming path uses. This keeps the truncation
      // detection working on platforms (e.g. some test fakes) that skip
      // the streaming path entirely.
      const text = await blob.text();
      const rowsReceived = isCsv
        ? countCsvRowsFromText(text)
        : countJsonRowsFromText(text);
      const final = {
        bytesReceived: blob.size,
        rowsReceived,
        hardCap,
        truncated: readTrailerTruncated(),
      };
      onProgress?.({ bytesReceived: final.bytesReceived, rowsReceived: final.rowsReceived });
      return { blob, ...final };
    }

    const chunks: BlobPart[] = [];
    let bytesReceived = 0;
    // RFC 4180-aware streaming CSV row counter. State is held in the
    // counter closure so it survives chunk boundaries (including a `"`
    // byte that lands at the very end of one chunk and is followed by
    // another `"` at the start of the next — the `pendingQuote` flag
    // resolves the escaped-quote / end-of-field ambiguity correctly).
    // See `createCsvRowCounter` for the full state machine.
    const csvCounter = isCsv ? createCsvRowCounter() : null;
    let lastEmit = 0;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Streaming JSON object counter. The export body is a JSON array of
    // row objects (`[{...},{...},...]`). We count top-level objects by
    // tracking brace depth, ignoring braces that appear inside strings or
    // are escaped. State carries across chunk boundaries via the closure
    // variables below. The counter increments on each top-level `{` so
    // the final value matches the array length.
    const jsonState = { depth: 0, inString: false, escape: false, count: 0 };
    const consumeJsonChunk = (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.byteLength; i++) {
        const c = bytes[i];
        if (jsonState.inString) {
          if (jsonState.escape) {
            jsonState.escape = false;
          } else if (c === 0x5c /* \ */) {
            jsonState.escape = true;
          } else if (c === 0x22 /* " */) {
            jsonState.inString = false;
          }
          continue;
        }
        if (c === 0x22 /* " */) {
          jsonState.inString = true;
        } else if (c === 0x7b /* { */) {
          if (jsonState.depth === 0) jsonState.count++;
          jsonState.depth++;
        } else if (c === 0x7d /* } */) {
          jsonState.depth--;
        }
      }
    };

    // Throttle progress callbacks so we don't thrash React with hundreds of
    // setStates per second on a fast connection. Force-emit on completion so
    // the final byte/row count is always surfaced.
    const emit = (force: boolean) => {
      if (!onProgress) return;
      const t = now();
      if (!force && t - lastEmit < 150) return;
      lastEmit = t;
      const rowsReceived = csvCounter ? csvCounter.getCount() : jsonState.count;
      onProgress({ bytesReceived, rowsReceived });
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          bytesReceived += value.byteLength;
          // For CSV we feed bytes through the RFC 4180-aware counter so
          // newlines inside quoted fields (e.g. multi-line audit
          // descriptions) don't inflate the row count — that count
          // drives our truncation toast and a wrong value would either
          // miss a real cap hit or fire a false "capped" warning.
          // For JSON we run the streaming brace-depth counter so the
          // row count is exact across chunk boundaries.
          if (csvCounter) {
            csvCounter.feedBytes(value);
          } else {
            consumeJsonChunk(value);
          }
          emit(false);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* no-op */ }
    }

    const blob = new Blob(chunks, { type: contentType });
    const rowsReceived = csvCounter ? csvCounter.getCount() : jsonState.count;
    emit(true);
    return {
      blob,
      bytesReceived,
      rowsReceived,
      hardCap,
      truncated: readTrailerTruncated(),
    };
  },

  async getMemberFull(id: number) {
    const res = await authFetch(`/admin/members/${id}/full`);
    if (!res.ok) throw new Error("Failed to fetch member details");
    return res.json();
  },

  async getAdminTicket(ticketId: number) {
    const res = await authFetch(`/admin/tickets/${ticketId}`);
    if (!res.ok) {
      const status = res.status;
      if (status === 404) {
        const err = new Error("Ticket not found") as Error & { status?: number };
        err.status = 404;
        throw err;
      }
      throw new Error("Failed to fetch ticket");
    }
    return res.json() as Promise<{
      id: number;
      ticketNumber: string;
      userId: number;
      category: string;
      priority: "urgent" | "high" | "normal" | "low";
      status: "open" | "in_progress" | "awaiting_response" | "resolved" | "closed";
      subject: string;
      source: string | null;
      sourceReferenceId: number | null;
      assignedTo: number | null;
      createdAt: string;
      updatedAt: string;
      resolvedAt: string | null;
      member: { id: number; name: string; email: string } | null;
      assignee: { id: number; name: string; email: string } | null;
      tier: string | null;
      messages: Array<{
        id: number;
        ticketId: number;
        senderType: "member" | "admin";
        senderName: string;
        body: string;
        isInternal: boolean;
        createdAt: string;
      }>;
    }>;
  },

  async getAdminTicketSla(ticketId: number) {
    const res = await authFetch(`/admin/tickets/${ticketId}/sla`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Failed to fetch ticket SLA");
    return res.json() as Promise<{
      tierSlug: string;
      firstResponseAt: string | null;
      firstResponseBreached: boolean;
      firstResponseWarning: boolean;
      resolutionBreached: boolean;
      resolutionWarning: boolean;
      pausedAt: string | null;
      elapsedBusinessMinutes: number;
      firstResponsePct: number | null;
      resolutionPct: number;
    }>;
  },

  async getAdminTickets(params: { status?: string; category?: string; assignedTo?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.category) qs.set("category", params.category);
    if (typeof params.assignedTo === "number") qs.set("assignedTo", String(params.assignedTo));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/tickets${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch tickets");
    return res.json() as Promise<Array<{
      id: number;
      ticketNumber: string;
      userId: number;
      category: string;
      priority: "urgent" | "high" | "normal" | "low";
      status: "open" | "in_progress" | "awaiting_response" | "resolved" | "closed";
      subject: string;
      assignedTo: number | null;
      createdAt: string;
      updatedAt: string;
      resolvedAt: string | null;
      member: { id: number; name: string; email: string } | null;
      assignee: { id: number; name: string; email: string } | null;
      // Service tier the SLA was sized against (e.g. "lifetime", "1year",
      // "free"). Null when the ticket has no SLA row yet — the UI renders
      // these as "—" rather than special-casing per-tier styling.
      tier: string | null;
      // Single SLA bucket derived server-side from the
      // firstResponse/resolution breached + warning flags so the Ticket
      // Queue can filter, sort, badge, and tint rows with one field
      // instead of recomputing the precedence on every render. Null when
      // the ticket has no SLA row.
      slaStatus: "breached" | "approaching" | "within" | null;
    }>>;
  },

  async getCannedResponses() {
    const res = await authFetch("/admin/canned-responses");
    if (!res.ok) throw new Error("Failed to fetch canned responses");
    return res.json() as Promise<Array<{
      id: number;
      title: string;
      category: string;
      body: string;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    }>>;
  },

  async createCannedResponse(input: { title: string; category: string; body: string; sortOrder?: number }) {
    const res = await authFetch("/admin/canned-responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("Failed to create canned response");
    return res.json() as Promise<{
      id: number;
      title: string;
      category: string;
      body: string;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    }>;
  },

  async updateCannedResponse(
    id: number,
    input: { title?: string; category?: string; body?: string; sortOrder?: number },
  ) {
    const res = await authFetch(`/admin/canned-responses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("Failed to update canned response");
    return res.json() as Promise<{
      id: number;
      title: string;
      category: string;
      body: string;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    }>;
  },

  async deleteCannedResponse(id: number) {
    const res = await authFetch(`/admin/canned-responses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete canned response");
    return res.json() as Promise<{ success: boolean }>;
  },

  async getTicketAssignees() {
    const res = await authFetch("/admin/tickets/assignees");
    if (!res.ok) throw new Error("Failed to fetch assignees");
    return res.json() as Promise<Array<{ id: number; name: string; email: string }>>;
  },

  async updateTicketStatus(ticketId: number, status: string) {
    const res = await authFetch(`/admin/tickets/${ticketId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error("Failed to update ticket status");
    return res.json();
  },

  async updateTicketPriority(ticketId: number, priority: string) {
    const res = await authFetch(`/admin/tickets/${ticketId}/priority`, {
      method: "PUT",
      body: JSON.stringify({ priority }),
    });
    if (!res.ok) throw new Error("Failed to update ticket priority");
    return res.json();
  },

  async updateTicketAssignee(ticketId: number, assignedTo: number | null) {
    const res = await authFetch(`/admin/tickets/${ticketId}/assign`, {
      method: "PUT",
      body: JSON.stringify({ assignedTo }),
    });
    if (!res.ok) throw new Error("Failed to update ticket assignee");
    return res.json();
  },

  async mergeTickets(primaryTicketId: number, ticketIds: number[]) {
    const res = await authFetch("/admin/tickets/merge", {
      method: "POST",
      body: JSON.stringify({ primaryTicketId, ticketIds }),
    });
    if (!res.ok) throw new Error("Failed to merge tickets");
    return res.json() as Promise<{
      primaryTicket: { id: number; ticketNumber: string };
      mergedCount: number;
      totalMessages: number;
    }>;
  },

  async getTicketAuditHistory(ticketId: number) {
    const res = await authFetch(`/admin/tickets/${ticketId}/audit-history`);
    if (!res.ok) throw new Error("Failed to fetch ticket audit history");
    return res.json() as Promise<{
      auditHistory: Array<{
        id: number;
        actionType: string;
        entityType: string;
        entityId: string | null;
        actorId: number | null;
        actorEmail: string | null;
        description: string;
        createdAt: string;
      }>;
      limit: number;
    }>;
  },

  async getMemberEmailAttempts(
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      // When set, the server filters classified rows to only this status
      // before paginating, so the "Show older" pager keeps surfacing
      // matching rows past the first page (used by the admin Member Detail
      // attempts card to narrow to e.g. cancelled-by-admin only).
      status?:
        | "pending"
        | "confirmed"
        | "expired"
        | "abandoned"
        | "cancelled_by_admin"
        | "cancelled_by_member";
    } = {},
  ) {
    const qs = new URLSearchParams();
    if (typeof options.limit === "number") qs.set("limit", String(options.limit));
    if (typeof options.offset === "number") qs.set("offset", String(options.offset));
    if (typeof options.status === "string") qs.set("status", options.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/members/${userId}/email-attempts${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch email-change attempts");
    return res.json() as Promise<{
      attempts: Array<{
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        // Populated when an admin cancelled this attempt via
        // /admin/members/:id/cancel-email-change. Admin-cancelled rows have a
        // longer (1-year) retention than the 90-day audit window, so older
        // pages of attempts may still include them for support investigation.
        cancelledAt: string | null;
        cancelledByAdminId: number | null;
        cancelledByAdminName: string | null;
        cancelledByAdminEmail: string | null;
        // True when the member cancelled or replaced their own pending
        // change. Set together with `cancelledAt` and lets the UI render
        // "Cancelled by member" without conflating it with admin cancels.
        cancelledByMember: boolean;
        // ISO timestamp of when the member dismissed the in-app banner
        // that surfaced this admin-cancelled attempt. Null when the row
        // is not admin-cancelled, or when the member has not yet dismissed
        // the banner. Surfaced on the admin Member Detail page so support
        // can confirm whether the member acknowledged the cancellation.
        dismissedByMemberAt: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin"
          | "cancelled_by_member";
      }>;
      total: number;
      offset: number;
      limit: number;
      hasMore: boolean;
      // Echoes the active filter so callers can sanity-check that the
      // server applied the requested status (or null when unfiltered).
      status?:
        | "pending"
        | "confirmed"
        | "expired"
        | "abandoned"
        | "cancelled_by_admin"
        | "cancelled_by_member"
        | null;
    }>;
  },

  async getMemberEmailAttemptDetail(userId: number, attemptId: number) {
    const res = await authFetch(
      `/admin/members/${userId}/email-attempts/${attemptId}`,
    );
    if (!res.ok) throw new Error("Failed to fetch email-change attempt detail");
    return res.json() as Promise<{
      attempt: {
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        cancelledAt: string | null;
        cancelledByAdminId: number | null;
        cancelledByAdminName: string | null;
        cancelledByAdminEmail: string | null;
        cancelledByMember: boolean;
        dismissedByMemberAt: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin"
          | "cancelled_by_member";
      };
      auditEntries: Array<{
        id: number;
        actorId: number | null;
        actorEmail: string | null;
        actionType: string;
        entityType: string;
        entityId: string | null;
        description: string;
        changeDiff: unknown;
        ipAddress: string | null;
        userAgent: string | null;
        metadata: unknown;
        createdAt: string;
      }>;
      nextAttempt: {
        id: number;
        newEmail: string | null;
        requestedAt: string;
        expiresAt: string | null;
        confirmedAt: string | null;
        cancelledAt: string | null;
        status:
          | "pending"
          | "confirmed"
          | "expired"
          | "abandoned"
          | "cancelled_by_admin"
          | "cancelled_by_member";
      } | null;
      subsequentConfirmation: {
        id: number;
        oldEmail: string;
        newEmail: string;
        changedAt: string;
      } | null;
    }>;
  },

  async addMemberNote(userId: number, content: string) {
    const res = await authFetch(`/admin/members/${userId}/notes`, { method: "POST", body: JSON.stringify({ content }) });
    if (!res.ok) throw new Error("Failed to add note");
    return res.json();
  },

  async grantProduct(userId: number, productId: number, expiresAt?: string) {
    const res = await authFetch(`/admin/members/${userId}/grant-product`, { method: "POST", body: JSON.stringify({ productId, expiresAt }) });
    if (!res.ok) throw new Error("Failed to grant product");
    return res.json();
  },

  async listProducts() {
    const res = await authFetch(`/admin/products`);
    if (!res.ok) throw new Error("Failed to fetch products");
    return res.json();
  },

  async revokeProduct(userId: number, userProductId: number) {
    const res = await authFetch(`/admin/members/${userId}/revoke-product`, { method: "POST", body: JSON.stringify({ userProductId }) });
    if (!res.ok) throw new Error("Failed to revoke product");
    return res.json();
  },

  async cancelMemberEmailChange(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/cancel-email-change`, { method: "POST" });
    if (!res.ok) {
      let message = "Failed to cancel pending email change";
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {}
      throw new Error(message);
    }
    return res.json();
  },

  async unlockMember(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/unlock`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to unlock account");
    }
    return res.json();
  },

  async resendMemberInvite(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/resend-invite`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to resend invite");
    }
    return res.json() as Promise<{ success: true; id: number }>;
  },

  async createMember(input: { email: string; name: string }) {
    const res = await authFetch(`/admin/members`, { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to create member");
    }
    return res.json() as Promise<{ success: true; id: number; email: string; name: string }>;
  },

  async createStaffAccount(input: { email: string; name: string; role: string }) {
    const res = await authFetch(`/admin/staff`, { method: "POST", body: JSON.stringify(input) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to create staff account");
    }
    return res.json() as Promise<{
      success: true;
      id: number;
      email: string;
      name: string;
      role: string;
      temporaryPassword: string;
    }>;
  },

  async forceVerifyMemberEmail(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/force-verify`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to force-verify email");
    }
    return res.json();
  },

  async forceMemberPasswordReset(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/force-password-reset`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to force password reset");
    }
    return res.json() as Promise<{ success: true; id: number; mustChangePassword: true; alreadySet: boolean; revokedSessionCount: number }>;
  },

  async sendMemberPasswordResetEmail(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/send-reset-email`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Failed to send password reset email");
    }
    return res.json() as Promise<{
      success: true;
      id: number;
      emailSent: boolean;
      emailConfigured: boolean;
      portalUrlMissing: boolean;
      emailStatus: string;
    }>;
  },

  async revokeMemberSession(userId: number, sessionId: number) {
    const res = await authFetch(`/admin/members/${userId}/sessions/${sessionId}/revoke`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to revoke session");
    }
    return res.json() as Promise<{ success: true; id: number; sessionId: number; revoked: boolean }>;
  },

  async revokeAllMemberSessions(userId: number) {
    const res = await authFetch(`/admin/members/${userId}/sessions/revoke-all`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to revoke sessions");
    }
    return res.json() as Promise<{ success: true; id: number; revokedSessionCount: number }>;
  },

  async startImpersonation(userId: number) {
    const res = await authFetch(`/admin/impersonate/${userId}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to start impersonation");
    }
    return res.json() as Promise<{ member: { id: number; name: string; email: string } }>;
  },

  async stopImpersonation() {
    const res = await authFetch("/admin/impersonate/stop", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to stop impersonation");
    }
    return res.json() as Promise<{ success: true }>;
  },

  async updateMemberRole(userId: number, role: string) {
    const res = await authFetch(`/admin/members/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractApiError(data) || "Failed to update role");
    }
    return res.json() as Promise<{ id: number; role: string; changed: boolean }>;
  },

  async getSystemHealth() {
    const res = await authFetch("/admin/system/health");
    if (!res.ok) throw new Error("Failed to fetch system health");
    return res.json();
  },

  async getLiveChatSupportConfig() {
    const res = await authFetch("/admin/system/live-chat-support");
    if (!res.ok) throw new Error("Failed to fetch live-chat support config");
    return res.json() as Promise<{
      probeUrl: string;
      probeUrlSource: "env" | "default";
      defaultUrl: string;
    }>;
  },

  async getQueueFallbackEvents(limit: number = 50) {
    const res = await authFetch(`/admin/system/queue-fallback-events?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch queue fallback events");
    return res.json();
  },

  async getQueueFallbackAlertEvents(
    limit: number = 20,
    filters?: {
      outcome?: "sent" | "failed" | "throttled" | "skipped" | null;
      deliveryChannel?: "pagerduty" | "email" | "slack" | null;
      statsWindowMs?: number | null;
    },
  ) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (filters?.outcome) params.set("outcome", filters.outcome);
    if (filters?.deliveryChannel) params.set("deliveryChannel", filters.deliveryChannel);
    if (filters?.statsWindowMs) params.set("statsWindowMs", String(filters.statsWindowMs));
    const res = await authFetch(`/admin/system/queue-fallback-alert-events?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch queue fallback alert events");
    return res.json();
  },

  async getQueueFallbackAlerterHealth() {
    const res = await authFetch("/admin/system/queue-fallback-alerter-health");
    if (!res.ok) throw new Error("Failed to fetch on-call alerter health");
    return res.json() as Promise<{
      alertingSource: "redis" | "memory";
      throttleSource: "redis" | "memory";
      channels: Array<{
        channel: "email" | "sms";
        alerting: boolean;
        lastFireAt: string | null;
        lastClearAt: string | null;
      }>;
      throttles: Array<{
        queueChannel: "email" | "sms";
        deliveryChannel: "pagerduty" | "email" | "slack";
        kind: "fire" | "clear";
        ttlMs: number;
        expiresAt: string;
      }>;
      serverTime: string;
    }>;
  },

  async getNotifications(limit?: number): Promise<{ notifications: any[]; total: number }> {
    // Pass `?limit=N` so the bell dropdown can cap how many items the API
    // materializes per 60s poll. The backend returns either:
    //   - `{ notifications, total }` when a limit was requested, or
    //   - a bare array (the legacy shape) when no limit is requested.
    // We normalize both into the wrapped shape so callers always get a
    // `total` they can use for the badge count even when items are truncated.
    const path = typeof limit === "number"
      ? `/admin/notifications?limit=${encodeURIComponent(String(limit))}`
      : "/admin/notifications";
    const res = await authFetch(path);
    if (!res.ok) throw new Error("Failed to fetch notifications");
    const data = await res.json();
    if (Array.isArray(data)) {
      return { notifications: data, total: data.length };
    }
    return data as { notifications: any[]; total: number };
  },

  async getSettings() {
    const res = await authFetch("/admin/settings");
    if (!res.ok) throw new Error("Failed to fetch settings");
    return res.json();
  },

  async updateSetting(key: string, value: any, category?: string, description?: string) {
    const res = await authFetch(`/admin/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value, category, description }) });
    if (!res.ok) throw new Error("Failed to update setting");
    return res.json();
  },

  async getOnCallDestinations() {
    const res = await authFetch("/admin/oncall-destinations");
    if (!res.ok) throw new Error("Failed to fetch on-call destinations");
    return res.json() as Promise<{
      pagerdutyConfigured: boolean;
      pagerdutySource: "db" | "env" | null;
      opsAlertEmail: string | null;
      opsAlertEmailSource: "db" | "env" | null;
      slackConfigured: boolean;
      slackSource: "db" | "env" | null;
    }>;
  },

  async updateOnCallDestinations(payload: {
    pagerdutyIntegrationKey?: string | null;
    opsAlertEmail?: string | null;
    opsAlertSlackWebhookUrl?: string | null;
  }) {
    const res = await authFetch("/admin/oncall-destinations", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update on-call destinations");
    }
    return res.json() as Promise<{
      pagerdutyConfigured: boolean;
      pagerdutySource: "db" | "env" | null;
      opsAlertEmail: string | null;
      opsAlertEmailSource: "db" | "env" | null;
      slackConfigured: boolean;
      slackSource: "db" | "env" | null;
      // Per-field reachability probe results from the save flow. Only the
      // fields that were updated to a non-null value appear here, so a save
      // that just clears a destination returns an empty `probes` object.
      probes: Partial<Record<
        "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl",
        { ok: boolean; skipped?: boolean; reason?: string }
      >>;
    }>;
  },

  /**
   * Re-run the per-channel reachability probe against the currently-stored
   * destination value, without requiring the admin to retype the secret.
   * Returns just the probe outcome — the value itself is never sent back.
   */
  async probeOnCallDestination(
    field: "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl",
  ) {
    const res = await authFetch(
      `/admin/oncall-destinations/${encodeURIComponent(field)}/probe`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to probe on-call destination");
    }
    return res.json() as Promise<{
      probe: { ok: boolean; skipped?: boolean; reason?: string };
    }>;
  },

  async sendOnCallTestAlert() {
    const res = await authFetch("/admin/oncall-destinations/test", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to send test alert");
    }
    return res.json() as Promise<{
      results: Array<{ channel: string; ok: boolean; skipped: boolean; reason?: string }>;
    }>;
  },

  async getOnCallDestinationsHistory(limit?: number) {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/oncall-destinations/history${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch on-call destinations history");
    return res.json() as Promise<{
      events: Array<{
        id: number;
        createdAt: string;
        actionType: "update_setting" | "send_test_alert" | string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        description: string;
        changedFields: Array<"pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl">;
        testResults: Array<{
          channel: "pagerduty" | "email" | "slack";
          ok: boolean;
          skipped: boolean;
          reason: string | null;
        }>;
      }>;
      limit: number;
    }>;
  },

  async getOnCallDestinationProbes(
    field: "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl",
    limit?: number,
  ) {
    const qs = new URLSearchParams({ field });
    if (limit) qs.set("limit", String(limit));
    const res = await authFetch(`/admin/oncall-destinations/probes?${qs.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to fetch on-call destination probe history");
    }
    return res.json() as Promise<{
      field: "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl";
      probes: Array<{
        id: number;
        createdAt: string;
        ok: boolean;
        skipped: boolean;
        reason: string | null;
      }>;
      limit: number;
    }>;
  },

  async getAuthRateLimitAlertConfig() {
    const res = await authFetch("/admin/auth-rate-limit-alert-config");
    if (!res.ok) throw new Error("Failed to fetch auth rate-limit alert config");
    return res.json() as Promise<AuthRateLimitAlertConfigStatus>;
  },

  async getAuthRateLimitAlertConfigHistory(limit?: number) {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/auth-rate-limit-alert-config/history${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch auth rate-limit alert config history");
    return res.json() as Promise<{
      events: Array<{
        id: number;
        createdAt: string;
        actionType: string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        description: string;
        changedFields: Array<"threshold" | "windowMinutes" | "dominantIpRatio">;
        diff: Array<{
          field: "threshold" | "windowMinutes" | "dominantIpRatio";
          from: number | null;
          to: number | null;
        }>;
      }>;
      limit: number;
    }>;
  },

  // A `null` value means "reset this field to its default" — the underlying
  // row is deleted server-side so per-field provenance flips back to
  // "default". Omit a field entirely to leave it untouched.
  async updateAuthRateLimitAlertConfig(payload: {
    threshold?: number | null;
    windowMinutes?: number | null;
    dominantIpRatio?: number | null;
  }) {
    const res = await authFetch("/admin/auth-rate-limit-alert-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update auth rate-limit alert config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<AuthRateLimitAlertConfigStatus & { changedFields: Array<"threshold" | "windowMinutes" | "dominantIpRatio"> }>;
  },

  async getAuthRateLimitAlertTrafficPreview(opts: { lookbackDays?: number } = {}) {
    const qs = opts.lookbackDays ? `?lookbackDays=${encodeURIComponent(opts.lookbackDays)}` : "";
    const res = await authFetch(`/admin/auth-rate-limit-alert-config/traffic-preview${qs}`);
    if (!res.ok) throw new Error("Failed to fetch auth rate-limit alert traffic preview");
    return res.json() as Promise<AuthRateLimitAlertTrafficPreview>;
  },

  async getModerationFailureAlertConfig() {
    const res = await authFetch("/admin/moderation-failure-alert-config");
    if (!res.ok) throw new Error("Failed to fetch moderation failure alert config");
    return res.json() as Promise<ModerationFailureAlertConfigStatus>;
  },

  async getModerationFailureAlertConfigHistory(limit?: number) {
    const qs = new URLSearchParams();
    if (limit) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authFetch(`/admin/moderation-failure-alert-config/history${suffix}`);
    if (!res.ok) throw new Error("Failed to fetch moderation failure alert config history");
    return res.json() as Promise<{
      events: Array<{
        id: number;
        createdAt: string;
        actionType: string;
        actorId: number | null;
        actorEmail: string | null;
        actorName: string | null;
        description: string;
        changedFields: Array<"threshold" | "windowMinutes">;
        diff: Array<{
          field: "threshold" | "windowMinutes";
          from: number | null;
          to: number | null;
        }>;
      }>;
      limit: number;
    }>;
  },

  async getAiModerationThresholdConfig() {
    const res = await authFetch("/admin/ai-moderation-threshold-config");
    if (!res.ok) throw new Error("Failed to fetch AI moderation threshold config");
    return res.json() as Promise<AiModerationThresholdConfigStatus>;
  },

  async getAiModerationThresholdPreview(threshold: number) {
    const qs = new URLSearchParams({ threshold: String(threshold) });
    const res = await authFetch(`/admin/ai-moderation-threshold-config/preview?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch AI moderation threshold preview");
    return res.json() as Promise<AiModerationThresholdPreview>;
  },

  async updateAiModerationThresholdConfig(payload: { flagThreshold?: number | null }) {
    const res = await authFetch("/admin/ai-moderation-threshold-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update AI moderation threshold config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      AiModerationThresholdConfigStatus & {
        changedFields: Array<"flagThreshold">;
      }
    >;
  },

  async updateModerationFailureAlertConfig(payload: {
    threshold?: number | null;
    windowMinutes?: number | null;
  }) {
    const res = await authFetch("/admin/moderation-failure-alert-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update moderation failure alert config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      ModerationFailureAlertConfigStatus & {
        changedFields: Array<"threshold" | "windowMinutes">;
      }
    >;
  },

  async getMachineMismatchAlertConfig() {
    const res = await authFetch("/admin/machine-mismatch-alert-config");
    if (!res.ok) throw new Error("Failed to fetch Machine order mismatch alert config");
    return res.json() as Promise<MachineMismatchAlertConfigStatus>;
  },

  // A `null` value means "reset this field to its default" — the
  // underlying row is deleted server-side so per-field provenance flips
  // back to "default". Omit a field entirely to leave it untouched.
  async updateMachineMismatchAlertConfig(payload: {
    threshold?: number | null;
    windowHours?: number | null;
  }) {
    const res = await authFetch("/admin/machine-mismatch-alert-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update Machine order mismatch alert config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      MachineMismatchAlertConfigStatus & {
        changedFields: Array<"threshold" | "windowHours">;
      }
    >;
  },

  async getMachineMismatchDigestAlertConfig() {
    const res = await authFetch("/admin/machine-mismatch-digest-alert-config");
    if (!res.ok) throw new Error("Failed to fetch Machine mismatch digest alert config");
    return res.json() as Promise<DigestAlerterTuningStatus>;
  },

  // A `null` value resets that field to its env/default; omit a field to
  // leave it untouched.
  async updateMachineMismatchDigestAlertConfig(payload: {
    thresholdMultiplier?: number | null;
    notificationThrottleMs?: number | null;
  }) {
    const res = await authFetch("/admin/machine-mismatch-digest-alert-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update Machine mismatch digest alert config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      DigestAlerterTuningStatus & {
        changedFields: Array<"thresholdMultiplier" | "notificationThrottleMs">;
      }
    >;
  },

  async getMachineMismatchDigestWatchdogState() {
    const res = await authFetch("/admin/machine-mismatch-digest-watchdog-state");
    if (!res.ok) throw new Error("Failed to fetch Machine mismatch digest watchdog state");
    return res.json() as Promise<DigestWatchdogState>;
  },

  async getChangeHistoryRetentionConfig() {
    const res = await authFetch("/admin/change-history-retention-config");
    if (!res.ok) throw new Error("Failed to fetch change-history retention config");
    return res.json() as Promise<ChangeHistoryRetentionConfigStatus>;
  },

  // A `null` value means "reset this field to its default" — the underlying
  // row is deleted server-side so per-field provenance flips back to
  // "default". Omit a field entirely to leave it untouched.
  async updateChangeHistoryRetentionConfig(payload: {
    emailRetentionDays?: number | null;
    phoneRetentionDays?: number | null;
  }) {
    const res = await authFetch("/admin/change-history-retention-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fieldErrors = Array.isArray(body.fieldErrors)
        ? (body.fieldErrors as Array<{ field: string; message: string }>)
        : [];
      const detail =
        fieldErrors.length > 0
          ? fieldErrors.map((e) => `${e.field}: ${e.message}`).join("; ")
          : body.error || "Failed to update change-history retention config";
      const err = new Error(detail) as Error & {
        fieldErrors?: Array<{ field: string; message: string }>;
      };
      if (fieldErrors.length > 0) err.fieldErrors = fieldErrors;
      throw err;
    }
    return res.json() as Promise<
      ChangeHistoryRetentionConfigStatus & {
        changedFields: Array<"emailRetentionDays" | "phoneRetentionDays">;
      }
    >;
  },

  async getYseOrders(params: {
    page?: number;
    limit?: number;
    search?: string;
    source?: string;
    btsRef?: string;
  }): Promise<{
    orders: Array<{
      externalOrderId: string;
      externalSource: string;
      userId: number;
      userEmail: string;
      userName: string | null;
      grantedAt: string | null;
      products: Array<{ name: string; slug: string }>;
      productCount: number;
      wasNewUser: boolean;
      btsRef: string | null;
      funnelSlug: string | null;
      portalProductKeys: string[];
      mismatch: boolean;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    mismatchSummary: {
      machineOrdersInView: number;
      machineOrdersWithMismatch: number;
    };
  }> {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.search) qs.set("search", params.search);
    if (params.source) qs.set("source", params.source);
    if (params.btsRef) qs.set("btsRef", params.btsRef);
    const res = await authFetch(
      `/admin/integrations/yse/orders?${qs.toString()}`,
    );
    if (!res.ok) throw new Error("Failed to fetch external orders");
    return res.json();
  },

  async exportYseOrders(
    filters: { search?: string; source?: string; btsRef?: string } = {},
    onProgress?: (progress: StreamDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<StreamDownloadResult> {
    const qs = new URLSearchParams();
    qs.set("format", "csv");
    if (filters.search) qs.set("search", filters.search);
    if (filters.source) qs.set("source", filters.source);
    if (filters.btsRef) qs.set("btsRef", filters.btsRef);
    const res = await authFetch(
      `/admin/integrations/yse/orders/export?${qs.toString()}`,
      { signal },
    );
    if (!res.ok) throw new Error("Failed to export external orders");
    return streamDownload(res, "csv", onProgress);
  },

  async getYsePendingGrants(limit = 100): Promise<{
    items: Array<{
      id: number;
      externalId: string;
      attempts: number;
      maxAttempts: number;
      status: string;
      errorMessage: string | null;
      lastAttemptAt: string | null;
      nextRetryAt: string | null;
      createdAt: string;
      customerEmail: string | null;
      externalOrderId: string | null;
      externalSource: string | null;
      productSlugs: string[];
      terminal: boolean;
      payloadPreview: string;
      alertSentAt: string | null;
    }>;
    status: {
      lastRanAt: string | null;
      lastSucceeded: number;
      lastFailed: number;
      lastError: { at: string; message: string } | null;
      intervalMs: number;
      maxAttempts: number;
    };
  }> {
    const qs = new URLSearchParams({ limit: String(limit) });
    const res = await authFetch(`/admin/yse-grants/pending?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch pending YSE grants");
    return res.json();
  },

  async retryYseGrant(id: number): Promise<{ ok: true }> {
    const res = await authFetch(`/admin/yse-grants/${id}/retry`, {
      method: "POST",
    });
    if (!res.ok) {
      let reason = "Manual retry failed";
      try {
        const body = await res.json();
        if (body?.error) reason = body.error;
      } catch {
        // ignore
      }
      throw new Error(reason);
    }
    return res.json();
  },

  async getMembers(params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    externalSource?: string;
    externalOrderId?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.search) qs.set("search", params.search);
    if (params.role) qs.set("role", params.role);
    if (params.externalSource) qs.set("externalSource", params.externalSource);
    if (params.externalOrderId) qs.set("externalOrderId", params.externalOrderId);
    const res = await authFetch(`/admin/members?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch members");
    return res.json();
  },

  async getMemberExternalSources(): Promise<{ sources: string[] }> {
    const res = await authFetch(`/admin/members/external-sources`);
    if (!res.ok) throw new Error("Failed to fetch external sources");
    return res.json();
  },

  async exportData(
    type: string,
    format: string = "csv",
    startDate?: string,
    endDate?: string,
    onProgress?: (progress: StreamDownloadProgress) => void,
  ): Promise<StreamDownloadResult> {
    const qs = new URLSearchParams({ format });
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);
    const res = await authFetch(`/admin/export/${type}?${qs.toString()}`);
    if (!res.ok) throw new Error("Failed to export data");
    return streamDownload(res, format, onProgress);
  },
};
