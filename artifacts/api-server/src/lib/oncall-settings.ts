/**
 * Storage and retrieval for the on-call notification destinations consumed by
 * `queue-fallback-alerter`. Values live in `system_settings` under reserved
 * `oncall.*` keys so they can be edited from the admin UI without restarting
 * the API. Sensitive secrets (PagerDuty integration key, Slack webhook URL)
 * are encrypted at rest with `app-secrets-crypto`; the ops email address is
 * not a secret and is stored as plain JSON.
 *
 * If a row is missing the corresponding `process.env.*` variable is used so
 * existing env-only deploys keep working until an admin saves a value.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./app-secrets-crypto";

export type OnCallField = "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl";

export interface OnCallDestinations {
  pagerdutyIntegrationKey: string | null;
  opsAlertEmail: string | null;
  opsAlertSlackWebhookUrl: string | null;
}

export interface OnCallDestinationsStatus {
  pagerdutyConfigured: boolean;
  pagerdutySource: "db" | "env" | null;
  opsAlertEmail: string | null;
  opsAlertEmailSource: "db" | "env" | null;
  slackConfigured: boolean;
  slackSource: "db" | "env" | null;
}

const KEYS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "oncall.pagerduty_integration_key",
  opsAlertEmail: "oncall.ops_alert_email",
  opsAlertSlackWebhookUrl: "oncall.ops_alert_slack_webhook_url",
};

const ENV_VARS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "PAGERDUTY_INTEGRATION_KEY",
  opsAlertEmail: "OPS_ALERT_EMAIL",
  opsAlertSlackWebhookUrl: "OPS_ALERT_SLACK_WEBHOOK_URL",
};

const ENCRYPTED_FIELDS: ReadonlySet<OnCallField> = new Set([
  "pagerdutyIntegrationKey",
  "opsAlertSlackWebhookUrl",
]);

const CATEGORY = "oncall";

export function isOnCallSettingKey(key: string): boolean {
  return Object.values(KEYS).includes(key) || key.startsWith("oncall.");
}

export function getOnCallSettingKeys(): string[] {
  return Object.values(KEYS);
}

interface StoredValue {
  encrypted: boolean;
  data: string | null;
}

function parseStored(raw: unknown): StoredValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.encrypted !== "boolean") return null;
  const data = obj.data;
  if (data !== null && typeof data !== "string") return null;
  return { encrypted: obj.encrypted, data: data ?? null };
}

function decodeStored(field: OnCallField, raw: unknown): string | null {
  const stored = parseStored(raw);
  if (!stored || stored.data == null || stored.data === "") return null;
  if (stored.encrypted) {
    try {
      return decryptSecret(stored.data);
    } catch (err) {
      console.error(`[OnCallSettings] Failed to decrypt ${field}:`, err);
      return null;
    }
  }
  return stored.data;
}

function encodeForStorage(field: OnCallField, value: string | null): StoredValue {
  if (value == null || value === "") return { encrypted: false, data: null };
  if (ENCRYPTED_FIELDS.has(field)) {
    return { encrypted: true, data: encryptSecret(value) };
  }
  return { encrypted: false, data: value };
}

async function readDbValues(): Promise<Partial<Record<OnCallField, string | null>>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, Object.values(KEYS)));
  const out: Partial<Record<OnCallField, string | null>> = {};
  for (const [field, key] of Object.entries(KEYS) as Array<[OnCallField, string]>) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    out[field] = decodeStored(field, row.value);
  }
  return out;
}

function readEnv(field: OnCallField): string | null {
  const raw = process.env[ENV_VARS[field]];
  if (!raw || raw.trim() === "") return null;
  return raw;
}

/**
 * Read each destination, preferring a value saved via the admin UI and
 * falling back to the matching env var when no row exists. Errors surface as
 * `null` so a single bad row never disables every channel.
 */
export async function getOnCallDestinations(): Promise<OnCallDestinations> {
  let dbValues: Partial<Record<OnCallField, string | null>> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[OnCallSettings] Failed to load destinations from DB:", err);
  }
  const fields: OnCallField[] = ["pagerdutyIntegrationKey", "opsAlertEmail", "opsAlertSlackWebhookUrl"];
  const out: Partial<OnCallDestinations> = {};
  for (const field of fields) {
    const dbVal = dbValues[field];
    if (dbVal !== undefined) {
      out[field] = dbVal;
    } else {
      out[field] = readEnv(field);
    }
  }
  return out as OnCallDestinations;
}

/**
 * Same as `getOnCallDestinations`, but also reports whether each value was
 * sourced from the DB or from env so the admin UI can show provenance.
 */
export async function getOnCallDestinationsStatus(): Promise<OnCallDestinationsStatus> {
  let dbValues: Partial<Record<OnCallField, string | null>> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[OnCallSettings] Failed to load destinations from DB:", err);
  }
  const sourceFor = (field: OnCallField): { value: string | null; source: "db" | "env" | null } => {
    if (Object.prototype.hasOwnProperty.call(dbValues, field)) {
      const value = dbValues[field] ?? null;
      return { value, source: value == null ? null : "db" };
    }
    const envVal = readEnv(field);
    return { value: envVal, source: envVal == null ? null : "env" };
  };
  const pd = sourceFor("pagerdutyIntegrationKey");
  const email = sourceFor("opsAlertEmail");
  const slack = sourceFor("opsAlertSlackWebhookUrl");
  return {
    pagerdutyConfigured: pd.value != null,
    pagerdutySource: pd.source,
    opsAlertEmail: email.value,
    opsAlertEmailSource: email.source,
    slackConfigured: slack.value != null,
    slackSource: slack.source,
  };
}

/**
 * Upsert a destination. Passing `null` or `""` clears the row so the alerter
 * falls back to env (if configured) or skips the channel entirely.
 */
export async function setOnCallDestination(
  field: OnCallField,
  value: string | null,
  updatedBy: string | null,
): Promise<void> {
  const stored = encodeForStorage(field, value);
  const key = KEYS[field];
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value: stored, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, key));
  } else {
    await db.insert(systemSettingsTable).values({
      key,
      value: stored,
      category: CATEGORY,
      description: `On-call destination: ${field}`,
      updatedBy: updatedBy ?? undefined,
    });
  }
}

// ===========================================================================
// Machine-mismatch digest alerter tuning
// ===========================================================================
//
// Sensitivity knobs for `machine-mismatch-digest-alerter.ts`. Historically the
// staleness threshold was hard-coded at 2× the digest run interval and the
// re-page throttle came only from `MACHINE_MISMATCH_DIGEST_ALERT_THROTTLE_MS`.
// Exposing both here lets ops tune sensitivity from the admin Settings UI
// without an env change + redeploy, consistent with how the on-call
// destinations above are admin-editable.
//
// Resolution order per field: a value saved via the admin UI (DB) wins, then
// the matching env var, then the shipped default — mirroring the destinations'
// db → env fallback so existing env-only deploys keep working until an admin
// saves a value.

export interface DigestAlerterTuning {
  /** Staleness threshold as a multiple of the digest run interval. */
  thresholdMultiplier: number;
  /** Minimum ms between repeat pages per channel while unhealthy. */
  notificationThrottleMs: number;
}

export type DigestAlerterTuningField = keyof DigestAlerterTuning;

export interface DigestAlerterTuningStatus {
  config: DigestAlerterTuning;
  sources: Record<DigestAlerterTuningField, "db" | "env" | "default">;
  defaults: DigestAlerterTuning;
  bounds: Record<DigestAlerterTuningField, { min: number; max: number }>;
}

export const DIGEST_ALERTER_TUNING_DEFAULTS: DigestAlerterTuning = {
  thresholdMultiplier: 2,
  notificationThrottleMs: 60 * 60 * 1000,
};

// Multiplier capped at 100 (any higher effectively disables the staleness
// page) and floored at 1 so the alarm can never fire before a single run
// interval has even elapsed. Throttle capped at 7 days so a fat-fingered
// value can't silence re-pages for a meaningful incident; 0 means "no
// throttle".
export const DIGEST_ALERTER_TUNING_BOUNDS: Record<
  DigestAlerterTuningField,
  { min: number; max: number }
> = {
  thresholdMultiplier: { min: 1, max: 100 },
  notificationThrottleMs: { min: 0, max: 7 * 24 * 60 * 60 * 1000 },
};

const TUNING_KEYS: Record<DigestAlerterTuningField, string> = {
  thresholdMultiplier: "oncall.machine_mismatch_digest_threshold_multiplier",
  notificationThrottleMs: "oncall.machine_mismatch_digest_alert_throttle_ms",
};

const TUNING_ENV_VARS: Record<DigestAlerterTuningField, string> = {
  thresholdMultiplier: "MACHINE_MISMATCH_DIGEST_ALERT_THRESHOLD_MULTIPLIER",
  notificationThrottleMs: "MACHINE_MISMATCH_DIGEST_ALERT_THROTTLE_MS",
};

// The multiplier may be fractional (e.g. 1.5×); the throttle is whole ms.
const TUNING_IS_INTEGER: Record<DigestAlerterTuningField, boolean> = {
  thresholdMultiplier: false,
  notificationThrottleMs: true,
};

const TUNING_DESCRIPTIONS: Record<DigestAlerterTuningField, string> = {
  thresholdMultiplier:
    "Machine mismatch digest alerter: staleness threshold as a multiple of the digest run interval",
  notificationThrottleMs:
    "Machine mismatch digest alerter: minimum ms between repeat pages per channel",
};

const TUNING_KEY_LIST: string[] = Object.values(TUNING_KEYS);

const TUNING_FIELDS: DigestAlerterTuningField[] = [
  "thresholdMultiplier",
  "notificationThrottleMs",
];

/** Reserved setting keys backing the digest alerter tuning. */
export function getDigestAlerterTuningSettingKeys(): string[] {
  return [...TUNING_KEY_LIST];
}

function clampTuning(field: DigestAlerterTuningField, value: number): number {
  const { min, max } = DIGEST_ALERTER_TUNING_BOUNDS[field];
  const n = TUNING_IS_INTEGER[field] ? Math.trunc(value) : value;
  if (!Number.isFinite(n)) return DIGEST_ALERTER_TUNING_DEFAULTS[field];
  return Math.min(max, Math.max(min, n));
}

function parseStoredNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as Record<string, unknown>).value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function readTuningDbValues(): Promise<
  Partial<Record<DigestAlerterTuningField, number>>
> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, TUNING_KEY_LIST));
  const out: Partial<Record<DigestAlerterTuningField, number>> = {};
  for (const field of TUNING_FIELDS) {
    const row = rows.find((r) => r.key === TUNING_KEYS[field]);
    if (!row) continue;
    const parsed = parseStoredNumber(row.value);
    if (parsed === null) continue;
    out[field] = clampTuning(field, parsed);
  }
  return out;
}

function readTuningEnv(field: DigestAlerterTuningField): number | null {
  const raw = process.env[TUNING_ENV_VARS[field]];
  if (!raw || raw.trim() === "") return null;
  const n = TUNING_IS_INTEGER[field]
    ? Number.parseInt(raw, 10)
    : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const { min, max } = DIGEST_ALERTER_TUNING_BOUNDS[field];
  if (n < min || n > max) return null;
  return n;
}

interface CachedTuning {
  loadedAt: number;
  status: DigestAlerterTuningStatus;
}

const TUNING_CACHE_TTL_MS = 10 * 1000;
let tuningCache: CachedTuning | null = null;

/** Test-only: drop the cached tuning so the next read re-queries the DB. */
export function __invalidateDigestAlerterTuningCacheForTests(): void {
  tuningCache = null;
}

/**
 * Read the digest alerter tuning with per-field provenance (db / env /
 * default) for the admin Settings card. Cached for a few seconds so the
 * alerter's per-poll reads don't hammer the DB.
 */
export async function getDigestAlerterTuningStatus(): Promise<DigestAlerterTuningStatus> {
  const now = Date.now();
  if (tuningCache && now - tuningCache.loadedAt < TUNING_CACHE_TTL_MS) {
    return tuningCache.status;
  }
  let dbValues: Partial<Record<DigestAlerterTuningField, number>> = {};
  try {
    dbValues = await readTuningDbValues();
  } catch (err) {
    console.error(
      "[OnCallSettings] Failed to load digest alerter tuning from DB:",
      err,
    );
  }
  const resolve = (
    field: DigestAlerterTuningField,
  ): { value: number; source: "db" | "env" | "default" } => {
    const dbVal = dbValues[field];
    if (dbVal !== undefined) return { value: dbVal, source: "db" };
    const envVal = readTuningEnv(field);
    if (envVal !== null) return { value: envVal, source: "env" };
    return { value: DIGEST_ALERTER_TUNING_DEFAULTS[field], source: "default" };
  };
  const multiplier = resolve("thresholdMultiplier");
  const throttle = resolve("notificationThrottleMs");
  const status: DigestAlerterTuningStatus = {
    config: {
      thresholdMultiplier: multiplier.value,
      notificationThrottleMs: throttle.value,
    },
    sources: {
      thresholdMultiplier: multiplier.source,
      notificationThrottleMs: throttle.source,
    },
    defaults: { ...DIGEST_ALERTER_TUNING_DEFAULTS },
    bounds: {
      thresholdMultiplier: { ...DIGEST_ALERTER_TUNING_BOUNDS.thresholdMultiplier },
      notificationThrottleMs: {
        ...DIGEST_ALERTER_TUNING_BOUNDS.notificationThrottleMs,
      },
    },
  };
  tuningCache = { loadedAt: now, status };
  return status;
}

/** Resolved tuning the alerter reads at evaluation time. */
export async function getDigestAlerterTuning(): Promise<DigestAlerterTuning> {
  return (await getDigestAlerterTuningStatus()).config;
}

export type DigestTuningFieldUpdate = number | null;

export interface ValidatedDigestTuningUpdate {
  thresholdMultiplier?: DigestTuningFieldUpdate;
  notificationThrottleMs?: DigestTuningFieldUpdate;
}

export type DigestTuningValidationError = { field: string; message: string };

/**
 * Validate an admin tuning update. Each field is optional (omit = leave
 * untouched); `null` resets it to env/default; a number is bounds-checked.
 * The multiplier accepts fractional values; the throttle is truncated to a
 * whole millisecond count.
 */
export function validateDigestAlerterTuningUpdate(
  input: unknown,
):
  | { ok: true; update: ValidatedDigestTuningUpdate }
  | { ok: false; errors: DigestTuningValidationError[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "Body must be an object" }],
    };
  }
  const obj = input as Record<string, unknown>;
  const errors: DigestTuningValidationError[] = [];
  const update: ValidatedDigestTuningUpdate = {};

  for (const field of TUNING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) continue;
    const raw = obj[field];
    if (raw === null) {
      update[field] = null;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field, message: "must be a number or null" });
      continue;
    }
    const n = TUNING_IS_INTEGER[field] ? Math.trunc(raw) : raw;
    const { min, max } = DIGEST_ALERTER_TUNING_BOUNDS[field];
    if (n < min || n > max) {
      errors.push({ field, message: `must be between ${min} and ${max}` });
      continue;
    }
    update[field] = n;
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      errors: [
        {
          field: "_root",
          message:
            "Provide at least one of thresholdMultiplier, notificationThrottleMs",
        },
      ],
    };
  }
  return { ok: true, update };
}

async function upsertTuningSetting(
  field: DigestAlerterTuningField,
  value: number,
  updatedBy: string | null,
): Promise<void> {
  const key = TUNING_KEYS[field];
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, key));
  } else {
    await db.insert(systemSettingsTable).values({
      key,
      value,
      category: CATEGORY,
      description: TUNING_DESCRIPTIONS[field],
      updatedBy: updatedBy ?? undefined,
    });
  }
}

async function deleteTuningSetting(
  field: DigestAlerterTuningField,
): Promise<void> {
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, TUNING_KEYS[field]));
}

/**
 * Apply a validated tuning update. A `null` field clears its DB row (so the
 * value falls back to env/default) but only when a DB row actually exists,
 * so "reset to defaults" doesn't churn rows that were never customized. A
 * numeric field is upserted only when it differs from the current value.
 */
export async function applyDigestAlerterTuningUpdate(
  update: ValidatedDigestTuningUpdate,
  updatedBy: string | null,
): Promise<{
  before: DigestAlerterTuning;
  after: DigestAlerterTuning;
  changedFields: DigestAlerterTuningField[];
}> {
  const beforeStatus = await getDigestAlerterTuningStatus();
  const before = beforeStatus.config;
  const changedFields: DigestAlerterTuningField[] = [];

  for (const field of TUNING_FIELDS) {
    const next = update[field];
    if (next === undefined) continue;
    if (next === null) {
      if (beforeStatus.sources[field] === "db") {
        await deleteTuningSetting(field);
        changedFields.push(field);
      }
    } else if (next !== before[field]) {
      await upsertTuningSetting(field, next, updatedBy);
      changedFields.push(field);
    }
  }

  tuningCache = null;
  const after = await getDigestAlerterTuning();
  return { before, after, changedFields };
}
