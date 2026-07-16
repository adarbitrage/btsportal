/**
 * Proactive health check for the GitHub mirror (scripts/github-sync.sh).
 *
 * Why this exists: the mirror push only runs from scripts/post-merge.sh, i.e.
 * after a task merge. If the GITHUB_TOKEN secret expires or loses repo write
 * access, the only signal today is a banner buried in the post-merge log — and
 * it only appears when a merge happens and after 3 failed merges in a row.
 * This probe surfaces a dead token WITHOUT waiting for a merge, on the admin
 * System Health page, and pages on-call after a streak of definitive auth
 * failures.
 *
 * What one probe run does (all read-only; it NEVER pushes):
 *   1. GET https://api.github.com/repos/<owner>/<repo> with the token.
 *      - HTTP 401                        → token expired/revoked  → `auth_failed`
 *      - HTTP 403/404                    → token lost repo access → `auth_failed`
 *        (GitHub returns 404 for private repos the token cannot see)
 *      - `permissions.push === false`    → token is read-only     → `auth_failed`
 *      - network error / timeout / 5xx   → inconclusive           → `unreachable`
 *   2. GET .../git/ref/heads/main to read GitHub main's SHA.
 *   3. Best-effort local comparison: `git rev-parse master` (falls back to
 *      HEAD). When both SHAs are known, `inSync` reports whether GitHub main
 *      matches the local commit. This is ADVISORY ONLY and never alerts:
 *      in a production deployment the local snapshot legitimately lags the
 *      workspace's master (deploys are point-in-time), and `.git` may not be
 *      present at all — so a mismatch is not proof the mirror is broken.
 *      In the dev workspace, healthy = `inSync: true`.
 *   4. Best-effort read of .local/github-sync-failcount (the consecutive
 *      merge-time push failures recorded by scripts/github-sync.sh) so the
 *      card also shows what the merge-time path has been seeing.
 *
 * Alerting: only definitive auth failures (`auth_failed`) increment the
 * failure streak; we page after `threshold` consecutive failures (default 3).
 * `unreachable` never increments the streak and never clears an active alert.
 * A successful auth probe clears the streak and resolves the alert.
 *
 * When GITHUB_TOKEN is unset (task-agent sandboxes, forks) the probe reports
 * `unconfigured` and the poll loop never starts — mirroring github-sync.sh's
 * quiet skip.
 *
 * Delivery, throttling, and SendGrid lazy init are owned by the shared
 * oncall-dispatcher (PAGERDUTY_INTEGRATION_KEY / OPS_ALERT_EMAIL /
 * OPS_ALERT_SLACK_WEBHOOK_URL).
 *
 * Tunables (env, all optional):
 *   - GITHUB_MIRROR_PROBE_ENABLED       (default: on whenever GITHUB_TOKEN is
 *                                        set and NODE_ENV !== "test")
 *   - GITHUB_MIRROR_PROBE_POLL_MS       (default 6 h)
 *   - GITHUB_MIRROR_PROBE_TIMEOUT_MS    (default 10 s)
 *   - GITHUB_MIRROR_FAIL_THRESHOLD      (default 3 consecutive auth failures)
 *   - GITHUB_MIRROR_ALERT_THROTTLE_MS   (default 6 h per channel)
 *   - GITHUB_MIRROR_REPO                (default adarbitrage/btsportal)
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createInMemoryThrottleStore,
  createOnCallDispatcher,
  createPollRunner,
  parseEnvInt,
  type AlertKind,
  type AlertMessages,
  type DeliveryChannel,
  type DeliveryFn,
  type DeliveryResult,
  type OnCallDestinations,
} from "./oncall-dispatcher";

export type { DeliveryResult };

export type GithubMirrorProbeStatus =
  | "ok"
  | "auth_failed"
  | "unreachable"
  | "unconfigured";

function getRepo(): string {
  const raw = process.env.GITHUB_MIRROR_REPO?.trim();
  return raw && raw.length > 0 ? raw : "adarbitrage/btsportal";
}

function getPollMs(): number {
  return parseEnvInt("GITHUB_MIRROR_PROBE_POLL_MS", 6 * 60 * 60 * 1000);
}

function getTimeoutMs(): number {
  return parseEnvInt("GITHUB_MIRROR_PROBE_TIMEOUT_MS", 10_000);
}

export function getGithubMirrorFailThreshold(): number {
  const raw = parseEnvInt("GITHUB_MIRROR_FAIL_THRESHOLD", 3);
  return raw > 0 ? raw : 3;
}

function getThrottleMs(): number {
  return parseEnvInt("GITHUB_MIRROR_ALERT_THROTTLE_MS", 6 * 60 * 60 * 1000);
}

/**
 * Whether the live poll loop should run. The probe is cheap and strictly
 * read-only, so it runs anywhere the token exists (dev workspace AND
 * production) — that's the whole point: catching an expired token before the
 * next merge. It stays off in tests and wherever the token is absent.
 * Force on/off with GITHUB_MIRROR_PROBE_ENABLED=true|false.
 */
function isProbeEnabled(): boolean {
  const raw = process.env.GITHUB_MIRROR_PROBE_ENABLED;
  if (raw !== undefined && raw.trim().length > 0) {
    return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
  }
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.GITHUB_TOKEN);
}

// ---------------------------------------------------------------------------
// Probe execution
// ---------------------------------------------------------------------------

export interface GithubMirrorProbeOutcome {
  status: GithubMirrorProbeStatus;
  /** Human-readable explanation for a non-ok status, else []. */
  reasons: string[];
  /** Short error description for an `unreachable` probe, else null. */
  error: string | null;
  /** HTTP status of the failing GitHub API call when one arrived, else null. */
  httpStatus: number | null;
  /** SHA of GitHub main when readable, else null. */
  remoteSha: string | null;
  /** SHA of the local master (or HEAD) when a git repo is present, else null. */
  localSha: string | null;
  /** true = mirror matches local; false = differs; null = one side unknown. */
  inSync: boolean | null;
}

let fetchOverride: typeof fetch | null = null;
let localShaOverride: (() => Promise<string | null>) | null = null;
let failcountOverride: (() => Promise<number | null>) | null = null;

/** Test-only: replace the network fetch used by the probe. */
export function __setGithubMirrorProbeFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn;
}

/** Test-only: replace the local-SHA reader. */
export function __setGithubMirrorLocalShaForTests(
  fn: (() => Promise<string | null>) | null,
): void {
  localShaOverride = fn;
}

/** Test-only: replace the merge-time failcount reader. */
export function __setGithubMirrorFailcountForTests(
  fn: (() => Promise<number | null>) | null,
): void {
  failcountOverride = fn;
}

/**
 * Resolve the SHA the mirror should be at: local `master`, falling back to
 * HEAD (production deployments are detached snapshots). Returns null when no
 * git repo/binary is available — common in deployments, and fine: the SHA
 * comparison is advisory only.
 */
async function readLocalSha(): Promise<string | null> {
  if (localShaOverride) return localShaOverride();
  for (const ref of ["master", "HEAD"]) {
    const sha = await new Promise<string | null>((resolve) => {
      execFile(
        "git",
        ["rev-parse", ref],
        { timeout: 5_000 },
        (err, stdout) => {
          if (err) return resolve(null);
          const s = stdout.trim();
          resolve(/^[0-9a-f]{40}$/i.test(s) ? s : null);
        },
      );
    });
    if (sha) return sha;
  }
  return null;
}

/**
 * Read the consecutive merge-time push-failure counter that
 * scripts/github-sync.sh maintains. Best-effort: returns null when the file
 * is absent (normal — any successful sync deletes it) or unreadable.
 */
async function readMergeFailcount(): Promise<number | null> {
  if (failcountOverride) return failcountOverride();
  const candidates = [
    path.resolve(process.cwd(), ".local/github-sync-failcount"),
    path.resolve(process.cwd(), "../../.local/github-sync-failcount"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(n)) return n;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function githubGet(
  pathPart: string,
  token: string,
): Promise<{ res: Response | null; error: string | null }> {
  const doFetch = fetchOverride ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const res = await doFetch(`https://api.github.com${pathPart}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "bts-portal-mirror-probe",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    return { res, error: null };
  } catch (err) {
    return {
      res: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run a single read-only probe of the GitHub mirror's token + branch state. */
export async function performGithubMirrorProbe(): Promise<GithubMirrorProbeOutcome> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      status: "unconfigured",
      reasons: ["GITHUB_TOKEN is not set — mirror sync is skipped here"],
      error: null,
      httpStatus: null,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }

  const repo = getRepo();
  const { res: repoRes, error: repoErr } = await githubGet(`/repos/${repo}`, token);
  if (!repoRes) {
    return {
      status: "unreachable",
      reasons: [],
      error: repoErr ?? "network error",
      httpStatus: null,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }
  if (repoRes.status === 401) {
    return {
      status: "auth_failed",
      reasons: ["http_401: GITHUB_TOKEN is expired or revoked"],
      error: null,
      httpStatus: 401,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }
  if (repoRes.status === 403 || repoRes.status === 404) {
    return {
      status: "auth_failed",
      reasons: [
        `http_${repoRes.status}: GITHUB_TOKEN can no longer access ${repo}`,
      ],
      error: null,
      httpStatus: repoRes.status,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }
  if (!repoRes.ok) {
    return {
      status: "unreachable",
      reasons: [],
      error: `GitHub API returned http ${repoRes.status}`,
      httpStatus: repoRes.status,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }

  let canPush: boolean | null = null;
  try {
    const body = (await repoRes.json()) as {
      permissions?: { push?: boolean };
    };
    if (typeof body?.permissions?.push === "boolean") {
      canPush = body.permissions.push;
    }
  } catch {
    canPush = null; // unparsable body — don't guess
  }
  if (canPush === false) {
    return {
      status: "auth_failed",
      reasons: [`no_push: GITHUB_TOKEN has read-only access to ${repo}`],
      error: null,
      httpStatus: repoRes.status,
      remoteSha: null,
      localSha: null,
      inSync: null,
    };
  }

  // Auth is good. Read GitHub main's SHA + local SHA (both best-effort).
  let remoteSha: string | null = null;
  const { res: refRes } = await githubGet(
    `/repos/${repo}/git/ref/heads/main`,
    token,
  );
  if (refRes?.ok) {
    try {
      const body = (await refRes.json()) as { object?: { sha?: string } };
      const s = body?.object?.sha;
      remoteSha = typeof s === "string" && /^[0-9a-f]{40}$/i.test(s) ? s : null;
    } catch {
      remoteSha = null;
    }
  }
  const localSha = await readLocalSha();
  const inSync =
    remoteSha !== null && localSha !== null ? remoteSha === localSha : null;

  return {
    status: "ok",
    reasons: [],
    error: null,
    httpStatus: repoRes.status,
    remoteSha,
    localSha,
    inSync,
  };
}

// ---------------------------------------------------------------------------
// State machine + alerting
// ---------------------------------------------------------------------------

export interface GithubMirrorAlertPayload {
  kind: AlertKind;
  now: number;
  repo: string;
  threshold: number;
  consecutiveAuthFailed: number;
  reasons: string[];
  lastAuthFailedAt: string | null;
}

interface ProbeState {
  lastStatus: GithubMirrorProbeStatus | "unknown";
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  lastAuthFailedAt: number | null;
  lastUnreachableAt: number | null;
  consecutiveAuthFailed: number;
  consecutiveUnreachable: number;
  reasons: string[];
  lastError: string | null;
  alerting: boolean;
  remoteSha: string | null;
  localSha: string | null;
  inSync: boolean | null;
  mergeFailcount: number | null;
}

const probeState: ProbeState = {
  lastStatus: "unknown",
  lastCheckedAt: null,
  lastOkAt: null,
  lastAuthFailedAt: null,
  lastUnreachableAt: null,
  consecutiveAuthFailed: 0,
  consecutiveUnreachable: 0,
  reasons: [],
  lastError: null,
  alerting: false,
  remoteSha: null,
  localSha: null,
  inSync: null,
  mergeFailcount: null,
};

function destinationsFromEnv(): OnCallDestinations {
  return {
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? null,
    opsAlertEmail: process.env.OPS_ALERT_EMAIL ?? null,
    opsAlertSlackWebhookUrl: process.env.OPS_ALERT_SLACK_WEBHOOK_URL ?? null,
  };
}

function buildMessages(p: GithubMirrorAlertPayload): AlertMessages {
  const reasonText = p.reasons.length > 0 ? p.reasons.join("; ") : "auth failed";
  const summary =
    p.kind === "fire"
      ? `GitHub mirror token BROKEN — cannot push to ${p.repo} (${reasonText})`
      : `GitHub mirror token recovered — ${p.repo} is reachable with write access again`;
  const emailText =
    p.kind === "fire"
      ? [
          `The GITHUB_TOKEN used to mirror Replit master to GitHub main`,
          `(${p.repo}) has failed authentication for ${p.consecutiveAuthFailed}`,
          `consecutive probe(s) (threshold ${p.threshold}).`,
          ``,
          `Last probe result: ${reasonText}.`,
          ``,
          `Until the token is fixed, every post-merge mirror push will fail and`,
          `GitHub main will silently fall behind Replit master.`,
          ``,
          `Fix: rotate the GITHUB_TOKEN secret (repo write access to ${p.repo}),`,
          `then run: bash scripts/github-sync.sh`,
          ``,
          `First detected at: ${p.lastAuthFailedAt ?? "n/a"}.`,
          `Confirm via /admin/system (GitHub mirror card).`,
        ].join("\n")
      : [
          `A probe of the GitHub mirror token succeeded — ${p.repo} is`,
          `accessible with push permission again. Marking the alert resolved.`,
          ``,
          `Confirm via /admin/system.`,
        ].join("\n");
  const slackText =
    p.kind === "fire"
      ? `:rotating_light: *GitHub mirror token BROKEN* — cannot authenticate to ${p.repo} (${reasonText}) ${p.consecutiveAuthFailed}× in a row (threshold ${p.threshold}). GitHub main will fall behind Replit master on the next merge. Rotate GITHUB_TOKEN. Check /admin/system.`
      : `:white_check_mark: *GitHub mirror token recovered* — ${p.repo} is pushable again.`;
  return {
    pagerduty: {
      dedupKey: "github-mirror:auth-failed",
      summary,
      severity: "warning",
      component: "github-mirror",
      class: "github_mirror_token_broken",
      custom_details: {
        repo: p.repo,
        threshold: p.threshold,
        consecutiveAuthFailed: p.consecutiveAuthFailed,
        reasons: p.reasons,
        lastAuthFailedAt: p.lastAuthFailedAt,
        link: "/admin/system",
      },
    },
    email: {
      subject:
        p.kind === "fire"
          ? "[ALERT] GitHub mirror token is broken (mirror will fall behind)"
          : "[RESOLVED] GitHub mirror token recovered",
      text: emailText,
    },
    slack: { text: slackText },
  };
}

const throttleStore = createInMemoryThrottleStore();

const dispatcher = createOnCallDispatcher<GithubMirrorAlertPayload, string>({
  name: "GithubMirrorProbe",
  destinations: destinationsFromEnv,
  throttleMs: getThrottleMs,
  throttleStore,
  throttleKey: (p, dc) => `${p.kind}:${dc}`,
  buildMessages,
  kindOf: (p) => p.kind,
});

/** Test-only: replace one or more delivery functions with stubs. */
export function __setGithubMirrorProbeDeliveriesForTests(
  overrides: Partial<
    Record<DeliveryChannel, DeliveryFn<GithubMirrorAlertPayload>>
  > | null,
): void {
  dispatcher.setDeliveryOverrides(overrides);
}

/** Test-only: reset all probe state, throttle slots, and overrides. */
export function __resetGithubMirrorProbeForTests(): void {
  probeState.lastStatus = "unknown";
  probeState.lastCheckedAt = null;
  probeState.lastOkAt = null;
  probeState.lastAuthFailedAt = null;
  probeState.lastUnreachableAt = null;
  probeState.consecutiveAuthFailed = 0;
  probeState.consecutiveUnreachable = 0;
  probeState.reasons = [];
  probeState.lastError = null;
  probeState.alerting = false;
  probeState.remoteSha = null;
  probeState.localSha = null;
  probeState.inSync = null;
  probeState.mergeFailcount = null;
  throttleStore.reset();
  dispatcher.setDeliveryOverrides(null);
  fetchOverride = null;
  localShaOverride = null;
  failcountOverride = null;
}

function iso(ms: number | null): string | null {
  return ms !== null ? new Date(ms).toISOString() : null;
}

/**
 * Run one probe, fold the result into the rolling state machine, and dispatch
 * any state-transition alert.
 *
 *   - `ok`           → reset the auth-failed streak; if alerting, clear.
 *   - `unreachable`  → inconclusive: bump the unreachable counter only.
 *   - `auth_failed`  → bump the streak; fire once it reaches threshold.
 *   - `unconfigured` → informational; never counts toward anything.
 */
export async function evaluateGithubMirrorProbe(
  now: number = Date.now(),
): Promise<{ outcome: GithubMirrorProbeOutcome; deliveries: DeliveryResult[] }> {
  const outcome = await performGithubMirrorProbe();
  probeState.lastCheckedAt = now;
  probeState.lastStatus = outcome.status;
  probeState.mergeFailcount = await readMergeFailcount();
  const threshold = getGithubMirrorFailThreshold();
  const repo = getRepo();

  if (outcome.status === "unconfigured") {
    probeState.reasons = outcome.reasons;
    probeState.lastError = null;
    return { outcome, deliveries: [] };
  }

  if (outcome.status === "ok") {
    probeState.lastOkAt = now;
    probeState.consecutiveAuthFailed = 0;
    probeState.consecutiveUnreachable = 0;
    probeState.reasons = [];
    probeState.lastError = null;
    probeState.remoteSha = outcome.remoteSha;
    probeState.localSha = outcome.localSha;
    probeState.inSync = outcome.inSync;
    if (probeState.alerting) {
      probeState.alerting = false;
      const deliveries = await dispatcher.dispatch(
        {
          kind: "clear",
          now,
          repo,
          threshold,
          consecutiveAuthFailed: 0,
          reasons: [],
          lastAuthFailedAt: iso(probeState.lastAuthFailedAt),
        },
        now,
      );
      return { outcome, deliveries };
    }
    return { outcome, deliveries: [] };
  }

  if (outcome.status === "unreachable") {
    probeState.consecutiveUnreachable += 1;
    probeState.lastUnreachableAt = now;
    probeState.lastError = outcome.error;
    return { outcome, deliveries: [] };
  }

  // auth_failed
  probeState.consecutiveAuthFailed += 1;
  probeState.consecutiveUnreachable = 0;
  probeState.lastAuthFailedAt = now;
  probeState.reasons = outcome.reasons;
  probeState.lastError = null;

  if (probeState.consecutiveAuthFailed >= threshold) {
    probeState.alerting = true;
    const deliveries = await dispatcher.dispatch(
      {
        kind: "fire",
        now,
        repo,
        threshold,
        consecutiveAuthFailed: probeState.consecutiveAuthFailed,
        reasons: outcome.reasons,
        lastAuthFailedAt: iso(probeState.lastAuthFailedAt),
      },
      now,
    );
    return { outcome, deliveries };
  }

  return { outcome, deliveries: [] };
}

export interface GithubMirrorProbeStateView {
  repo: string;
  status: GithubMirrorProbeStatus | "unknown";
  alerting: boolean;
  threshold: number;
  consecutiveAuthFailed: number;
  consecutiveUnreachable: number;
  reasons: string[];
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  lastAuthFailedAt: string | null;
  lastUnreachableAt: string | null;
  lastError: string | null;
  remoteSha: string | null;
  localSha: string | null;
  inSync: boolean | null;
  /** Consecutive merge-time push failures per scripts/github-sync.sh, or null. */
  mergeFailcount: number | null;
  /** Whether the poll loop is running here (false = token absent or disabled). */
  enabled: boolean;
}

/** Read-only snapshot for the admin System Health page. */
export function getGithubMirrorProbeState(): GithubMirrorProbeStateView {
  return {
    repo: getRepo(),
    status: probeState.lastStatus,
    alerting: probeState.alerting,
    threshold: getGithubMirrorFailThreshold(),
    consecutiveAuthFailed: probeState.consecutiveAuthFailed,
    consecutiveUnreachable: probeState.consecutiveUnreachable,
    reasons: [...probeState.reasons],
    lastCheckedAt: iso(probeState.lastCheckedAt),
    lastOkAt: iso(probeState.lastOkAt),
    lastAuthFailedAt: iso(probeState.lastAuthFailedAt),
    lastUnreachableAt: iso(probeState.lastUnreachableAt),
    lastError: probeState.lastError,
    remoteSha: probeState.remoteSha,
    localSha: probeState.localSha,
    inSync: probeState.inSync,
    mergeFailcount: probeState.mergeFailcount,
    enabled: isProbeEnabled(),
  };
}

const runner = createPollRunner({
  name: "GithubMirrorProbe",
  pollMs: getPollMs(),
  evaluate: () => evaluateGithubMirrorProbe(),
  startupEvaluate: true,
});

/** Start the GitHub mirror probe poll. No-op unless enabled. Idempotent. */
export function startGithubMirrorProbe(): void {
  if (!isProbeEnabled()) {
    // Seed an explicit state so System Health shows "not configured" rather
    // than a confusing "unknown" in token-less environments (sandboxes, forks).
    if (!process.env.GITHUB_TOKEN && probeState.lastStatus === "unknown") {
      probeState.lastStatus = "unconfigured";
      probeState.reasons = [
        "GITHUB_TOKEN is not set — mirror sync is skipped here",
      ];
    }
    console.log(
      "[GithubMirrorProbe] disabled (set GITHUB_MIRROR_PROBE_ENABLED=true and GITHUB_TOKEN to enable)",
    );
    return;
  }
  runner.start();
}

/** Stop the GitHub mirror probe poll. */
export function stopGithubMirrorProbe(): void {
  runner.stop();
}
