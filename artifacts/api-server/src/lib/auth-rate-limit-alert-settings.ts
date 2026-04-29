/**
 * Storage and retrieval for the "auth rate-limit burst" alert thresholds shown
 * in the admin Dashboard's Needs Attention card. Defaults match the constants
 * the alert was launched with (10 hits / 15 minutes / 60% dominant IP) but
 * every team has a different traffic baseline — high-traffic deployments need
 * to dial these up to suppress noise, low-traffic ones need to dial them down
 * to catch slow attacks.
 *
 * Values live in `system_settings` under reserved `auth_rate_limit_alert.*`
 * keys so they can be edited from the admin Settings page without restarting
 * the API. A short in-process cache (~10s) keeps the per-request lookup off
 * the hot path of the dashboard endpoint without making the UI feel stale
 * after a save.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface AuthRateLimitAlertConfig {
  /** Minimum total hits in the window required to fire the alert. */
  threshold: number;
  /** Length of the rolling lookback window, in minutes. */
  windowMinutes: number;
  /**
   * Fraction of total hits that a single source IP must contribute before
   * the alert description calls that IP out by name (0..1).
   */
  dominantIpRatio: number;
}

export interface AuthRateLimitAlertConfigStatus {
  config: AuthRateLimitAlertConfig;
  /** Per-field provenance so the UI can label "default" vs "saved" values. */
  sources: Record<keyof AuthRateLimitAlertConfig, "db" | "default">;
  /** Defaults so the UI can offer a "reset to defaults" affordance. */
  defaults: AuthRateLimitAlertConfig;
  /** Bounds the API will accept on save, so the UI can mirror them. */
  bounds: {
    threshold: { min: number; max: number };
    windowMinutes: { min: number; max: number };
    dominantIpRatio: { min: number; max: number };
  };
}

export const AUTH_RATE_LIMIT_ALERT_DEFAULTS: AuthRateLimitAlertConfig = {
  threshold: 10,
  windowMinutes: 15,
  dominantIpRatio: 0.6,
};

// Sensible bounds. The window cap of 60 minutes matches the short-window
// "burst" framing of the alert (anything longer turns into a trend chart).
// The threshold is capped well above what any realistic deployment would
// need so admins can't accidentally disable the alert by setting it to a
// number they'd never reach.
export const AUTH_RATE_LIMIT_ALERT_BOUNDS = {
  threshold: { min: 1, max: 10000 },
  windowMinutes: { min: 1, max: 60 },
  dominantIpRatio: { min: 0, max: 1 },
} as const;

const KEYS = {
  threshold: "auth_rate_limit_alert.threshold",
  windowMinutes: "auth_rate_limit_alert.window_minutes",
  dominantIpRatio: "auth_rate_limit_alert.dominant_ip_ratio",
} as const satisfies Record<keyof AuthRateLimitAlertConfig, string>;

const CATEGORY = "alerts";

const KEY_LIST: string[] = Object.values(KEYS);

export function isAuthRateLimitAlertSettingKey(key: string): boolean {
  return key.startsWith("auth_rate_limit_alert.");
}

export function getAuthRateLimitAlertSettingKeys(): string[] {
  return [...KEY_LIST];
}

interface CachedConfig {
  loadedAt: number;
  status: AuthRateLimitAlertConfigStatus;
}

// Per-request reads were measured in the < 1ms range against a healthy
// connection pool, but the dashboard endpoint runs many sub-queries already.
// A short cache keeps a burst of refreshes from amplifying load without
// making "Save" in the UI feel laggy — the writer invalidates synchronously.
const CACHE_TTL_MS = 10 * 1000;
let cached: CachedConfig | null = null;

export function __invalidateAuthRateLimitAlertConfigCacheForTests(): void {
  cached = null;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function coerceThreshold(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return clampNumber(
    n,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.threshold.min,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.threshold.max,
  );
}

function coerceWindowMinutes(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return clampNumber(
    n,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.windowMinutes.min,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.windowMinutes.max,
  );
}

function coerceDominantIpRatio(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return clampNumber(
    raw,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.dominantIpRatio.min,
    AUTH_RATE_LIMIT_ALERT_BOUNDS.dominantIpRatio.max,
  );
}

async function readDbValues(): Promise<Partial<AuthRateLimitAlertConfig>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, KEY_LIST));
  const out: Partial<AuthRateLimitAlertConfig> = {};
  for (const row of rows) {
    if (row.key === KEYS.threshold) {
      const parsed = coerceThreshold(row.value);
      if (parsed !== null) out.threshold = parsed;
    } else if (row.key === KEYS.windowMinutes) {
      const parsed = coerceWindowMinutes(row.value);
      if (parsed !== null) out.windowMinutes = parsed;
    } else if (row.key === KEYS.dominantIpRatio) {
      const parsed = coerceDominantIpRatio(row.value);
      if (parsed !== null) out.dominantIpRatio = parsed;
    }
  }
  return out;
}

/**
 * Read the current alert config, falling back to defaults for any field that
 * has not been customized. A bad row (wrong type, out of bounds) is treated
 * as "not set" so a single corrupt setting cannot disable the alert.
 *
 * Result is cached for `CACHE_TTL_MS`. The writer invalidates the cache, so
 * an admin save is reflected on the very next dashboard refresh; the cache
 * exists only to absorb bursty reads.
 */
export async function getAuthRateLimitAlertConfigStatus(): Promise<AuthRateLimitAlertConfigStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValues: Partial<AuthRateLimitAlertConfig> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    // Degrade to defaults rather than knock out the dashboard endpoint.
    console.error("[AuthRateLimitAlertSettings] Failed to load config from DB:", err);
  }
  const config: AuthRateLimitAlertConfig = {
    threshold: dbValues.threshold ?? AUTH_RATE_LIMIT_ALERT_DEFAULTS.threshold,
    windowMinutes: dbValues.windowMinutes ?? AUTH_RATE_LIMIT_ALERT_DEFAULTS.windowMinutes,
    dominantIpRatio: dbValues.dominantIpRatio ?? AUTH_RATE_LIMIT_ALERT_DEFAULTS.dominantIpRatio,
  };
  const sources: AuthRateLimitAlertConfigStatus["sources"] = {
    threshold: dbValues.threshold !== undefined ? "db" : "default",
    windowMinutes: dbValues.windowMinutes !== undefined ? "db" : "default",
    dominantIpRatio: dbValues.dominantIpRatio !== undefined ? "db" : "default",
  };
  const status: AuthRateLimitAlertConfigStatus = {
    config,
    sources,
    defaults: { ...AUTH_RATE_LIMIT_ALERT_DEFAULTS },
    bounds: {
      threshold: { ...AUTH_RATE_LIMIT_ALERT_BOUNDS.threshold },
      windowMinutes: { ...AUTH_RATE_LIMIT_ALERT_BOUNDS.windowMinutes },
      dominantIpRatio: { ...AUTH_RATE_LIMIT_ALERT_BOUNDS.dominantIpRatio },
    },
  };
  cached = { loadedAt: now, status };
  return status;
}

export async function getAuthRateLimitAlertConfig(): Promise<AuthRateLimitAlertConfig> {
  return (await getAuthRateLimitAlertConfigStatus()).config;
}

// A field value of `null` in an update payload means "reset to default" —
// the underlying row is deleted so the read path falls back to the default
// and the per-field source flips back to `default`. Saving a number is the
// usual upsert.
export type FieldUpdateValue = number | null;

export interface ValidatedUpdate {
  threshold?: FieldUpdateValue;
  windowMinutes?: FieldUpdateValue;
  dominantIpRatio?: FieldUpdateValue;
}

export type ValidationError = { field: string; message: string };

/**
 * Validate a partial update payload from the admin UI. Returns either the
 * coerced values (numbers — integers for threshold/window, fraction for
 * ratio — or `null` to mean "delete the customization") or a list of
 * per-field errors so the route can surface them all at once.
 */
export function validateUpdate(input: unknown): { ok: true; update: ValidatedUpdate } | { ok: false; errors: ValidationError[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "_root", message: "Body must be an object" }] };
  }
  const obj = input as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const update: ValidatedUpdate = {};

  if (Object.prototype.hasOwnProperty.call(obj, "threshold")) {
    const raw = obj.threshold;
    if (raw === null) {
      update.threshold = null;
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field: "threshold", message: "must be a number or null" });
    } else {
      const n = Math.trunc(raw);
      const { min, max } = AUTH_RATE_LIMIT_ALERT_BOUNDS.threshold;
      if (n < min || n > max) {
        errors.push({ field: "threshold", message: `must be between ${min} and ${max}` });
      } else {
        update.threshold = n;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(obj, "windowMinutes")) {
    const raw = obj.windowMinutes;
    if (raw === null) {
      update.windowMinutes = null;
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field: "windowMinutes", message: "must be a number or null" });
    } else {
      const n = Math.trunc(raw);
      const { min, max } = AUTH_RATE_LIMIT_ALERT_BOUNDS.windowMinutes;
      if (n < min || n > max) {
        errors.push({ field: "windowMinutes", message: `must be between ${min} and ${max} minutes` });
      } else {
        update.windowMinutes = n;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(obj, "dominantIpRatio")) {
    const raw = obj.dominantIpRatio;
    if (raw === null) {
      update.dominantIpRatio = null;
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field: "dominantIpRatio", message: "must be a number or null" });
    } else {
      const { min, max } = AUTH_RATE_LIMIT_ALERT_BOUNDS.dominantIpRatio;
      if (raw < min || raw > max) {
        errors.push({ field: "dominantIpRatio", message: `must be between ${min} and ${max}` });
      } else {
        update.dominantIpRatio = raw;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(update).length === 0) {
    return { ok: false, errors: [{ field: "_root", message: "Provide at least one of threshold, windowMinutes, dominantIpRatio" }] };
  }
  return { ok: true, update };
}

async function upsertSetting(key: string, value: unknown, description: string, updatedBy: string | null): Promise<void> {
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
      description,
      updatedBy: updatedBy ?? undefined,
    });
  }
}

async function deleteSetting(key: string): Promise<void> {
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, key));
}

/**
 * Persist a (partial) alert config update. Caller is responsible for having
 * already validated the input via `validateUpdate`. Invalidates the in-process
 * cache synchronously so the next read reflects the write.
 *
 * A field value of `null` deletes the underlying row so the read path falls
 * back to the default and per-field source flips back to `default`. This is
 * what powers the UI's "Reset to defaults" affordance — without the delete,
 * the row would stick around at the default value and provenance would still
 * say "Customized", which is confusing.
 *
 * Returns the field names that were actually changed (i.e. whose new value
 * differs from what the read path would have returned before the write), so
 * the route can record a meaningful audit row. A no-op save (e.g. resetting
 * an already-default field) yields an empty `changedFields` array.
 */
export async function applyAuthRateLimitAlertConfigUpdate(
  update: ValidatedUpdate,
  updatedBy: string | null,
): Promise<{ before: AuthRateLimitAlertConfig; after: AuthRateLimitAlertConfig; changedFields: Array<keyof ValidatedUpdate> }> {
  const beforeStatus = await getAuthRateLimitAlertConfigStatus();
  const before = beforeStatus.config;
  const changedFields: Array<keyof ValidatedUpdate> = [];

  // For each field:
  //   - `null` means "reset to default": delete the row if one exists
  //     (otherwise it's a no-op), so the source flips back to "default".
  //   - A number means "upsert": only write if it actually differs from
  //     what the read path returns today, so re-saving the same number
  //     doesn't churn the row or its updatedBy/updatedAt fields.
  if (update.threshold !== undefined) {
    if (update.threshold === null) {
      if (beforeStatus.sources.threshold === "db") {
        await deleteSetting(KEYS.threshold);
        changedFields.push("threshold");
      }
    } else if (update.threshold !== before.threshold) {
      await upsertSetting(
        KEYS.threshold,
        update.threshold,
        "Auth rate-limit burst alert: minimum total hits required to fire",
        updatedBy,
      );
      changedFields.push("threshold");
    }
  }
  if (update.windowMinutes !== undefined) {
    if (update.windowMinutes === null) {
      if (beforeStatus.sources.windowMinutes === "db") {
        await deleteSetting(KEYS.windowMinutes);
        changedFields.push("windowMinutes");
      }
    } else if (update.windowMinutes !== before.windowMinutes) {
      await upsertSetting(
        KEYS.windowMinutes,
        update.windowMinutes,
        "Auth rate-limit burst alert: rolling window length in minutes",
        updatedBy,
      );
      changedFields.push("windowMinutes");
    }
  }
  if (update.dominantIpRatio !== undefined) {
    if (update.dominantIpRatio === null) {
      if (beforeStatus.sources.dominantIpRatio === "db") {
        await deleteSetting(KEYS.dominantIpRatio);
        changedFields.push("dominantIpRatio");
      }
    } else if (update.dominantIpRatio !== before.dominantIpRatio) {
      await upsertSetting(
        KEYS.dominantIpRatio,
        update.dominantIpRatio,
        "Auth rate-limit burst alert: fraction of hits required to call out a single IP",
        updatedBy,
      );
      changedFields.push("dominantIpRatio");
    }
  }

  cached = null;
  const after = await getAuthRateLimitAlertConfig();
  return { before, after, changedFields };
}
