/**
 * Tracks failures of the audit-write hook (`onLimitExceeded`) inside the
 * abuse-rate-limit middleware. When the audit insert throws (e.g. a database
 * outage during a credential-stuffing wave), the middleware still serves a
 * 429 to the client — but the audit trail security on-callers rely on to
 * notice the attack silently disappears. This tracker increments an
 * in-memory counter for each such failure and exposes the totals so the
 * System Health page can surface "audit writes are dropping" instead of
 * leaving operators to assume "no audit rows means no attack".
 *
 * Counts are intentionally kept in-memory and not persisted: the failure
 * mode we're tracking is "the audit table can't be written to right now",
 * so trying to persist the counter through the same audit pathway would be
 * self-defeating. Each api-server instance reports its own snapshot, which
 * is what an operator wants when correlating against per-pod dashboards.
 */

export interface RateLimitAuditFailureChannelStats {
  /** Number of failures observed for this limiter since process start. */
  count: number;
  /** ISO timestamp of the most recent failure for this limiter. */
  lastAt: string | null;
  /** Short, human-readable description of the most recent error. */
  lastError: string | null;
}

export interface RateLimitAuditFailureStats {
  /** Sum of `count` across every tracked limiter. */
  totalCount: number;
  /** ISO timestamp of the most recent failure across every limiter. */
  lastAt: string | null;
  /** Per-limiter breakdown keyed by `AbuseRateLimitOptions.name`. */
  byName: Record<string, RateLimitAuditFailureChannelStats>;
}

interface PerNameState {
  count: number;
  lastAt: number;
  lastError: string | null;
}

const state = new Map<string, PerNameState>();

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Increment the failure counter for `name` and emit a structured warning
 * line. Safe to call from any hot path — pure in-memory bookkeeping plus a
 * single `console.warn`.
 */
export function recordRateLimitAuditFailure(
  name: string,
  err: unknown,
): void {
  const now = Date.now();
  const message = describeError(err);
  const cur = state.get(name);
  if (cur) {
    cur.count++;
    cur.lastAt = now;
    cur.lastError = message;
  } else {
    state.set(name, { count: 1, lastAt: now, lastError: message });
  }
  // Distinct prefix from the generic `[AbuseRateLimit:*] onLimitExceeded
  // error:` line so log-based alerting can count this signal independently
  // — operators want a separate "audit writes are silently failing" alert
  // from the noisier per-error line.
  console.warn(
    `[AbuseRateLimit][AuditFailure] limiter=${name} error=${message} at=${new Date(now).toISOString()}`,
  );
}

/**
 * Snapshot of the current per-limiter failure counters. Returned shape is
 * stable so the System Health endpoint and UI can render it without further
 * massaging.
 */
export function getRateLimitAuditFailureStats(): RateLimitAuditFailureStats {
  let totalCount = 0;
  let lastAt = 0;
  const byName: Record<string, RateLimitAuditFailureChannelStats> = {};
  for (const [name, s] of state.entries()) {
    totalCount += s.count;
    if (s.lastAt > lastAt) lastAt = s.lastAt;
    byName[name] = {
      count: s.count,
      lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
      lastError: s.lastError,
    };
  }
  return {
    totalCount,
    lastAt: lastAt ? new Date(lastAt).toISOString() : null,
    byName,
  };
}

/** Test-only helper to reset internal counters between tests. */
export function __resetRateLimitAuditFailureTrackerForTests(): void {
  state.clear();
}
