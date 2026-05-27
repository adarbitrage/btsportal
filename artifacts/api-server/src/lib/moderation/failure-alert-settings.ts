/**
 * Storage and retrieval for the "moderation job failures" alert thresholds
 * shown in the admin Settings page. Mirrors `auth-rate-limit-alert-settings`
 * — same shape, same per-field provenance, same cache strategy — so the
 * Settings UI can reuse the existing AlertConfigRow / history components
 * for a third alert without learning a new contract.
 *
 * Defaults: fire when 5 moderation-job failures land within a rolling 15
 * minute window. The threshold is intentionally small because each
 * `persist` failure means a *known-bad* post is still publicly active —
 * even a handful is worth paging on. Admins can dial the threshold up in
 * noisy environments via this card without redeploying.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface ModerationFailureAlertConfig {
  /** Minimum total failures inside the window required to fire the alert. */
  threshold: number;
  /** Length of the rolling lookback window, in minutes. */
  windowMinutes: number;
}

export interface ModerationFailureAlertConfigStatus {
  config: ModerationFailureAlertConfig;
  /** Per-field provenance so the UI can label "default" vs "saved" values. */
  sources: Record<keyof ModerationFailureAlertConfig, "db" | "default">;
  /** Shipped defaults so the UI can offer a "reset to defaults" affordance. */
  defaults: ModerationFailureAlertConfig;
  /** Bounds the API will accept on save, so the UI can mirror them. */
  bounds: {
    threshold: { min: number; max: number };
    windowMinutes: { min: number; max: number };
  };
}

export const MODERATION_FAILURE_ALERT_DEFAULTS: ModerationFailureAlertConfig = {
  threshold: 5,
  windowMinutes: 15,
};

export const MODERATION_FAILURE_ALERT_BOUNDS = {
  threshold: { min: 1, max: 10000 },
  // Cap at 24h — the tracker only retains 24h of events, so a longer
  // window would silently truncate.
  windowMinutes: { min: 1, max: 24 * 60 },
} as const;

const KEYS = {
  threshold: "moderation_failure_alert.threshold",
  windowMinutes: "moderation_failure_alert.window_minutes",
} as const satisfies Record<keyof ModerationFailureAlertConfig, string>;

const CATEGORY = "alerts";

const KEY_LIST: string[] = Object.values(KEYS);

export function isModerationFailureAlertSettingKey(key: string): boolean {
  return key.startsWith("moderation_failure_alert.");
}

export function getModerationFailureAlertSettingKeys(): string[] {
  return [...KEY_LIST];
}

interface CachedConfig {
  loadedAt: number;
  status: ModerationFailureAlertConfigStatus;
}

const CACHE_TTL_MS = 10 * 1000;
let cached: CachedConfig | null = null;

export function __invalidateModerationFailureAlertConfigCacheForTests(): void {
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
    MODERATION_FAILURE_ALERT_BOUNDS.threshold.min,
    MODERATION_FAILURE_ALERT_BOUNDS.threshold.max,
  );
}

function coerceWindowMinutes(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return clampNumber(
    n,
    MODERATION_FAILURE_ALERT_BOUNDS.windowMinutes.min,
    MODERATION_FAILURE_ALERT_BOUNDS.windowMinutes.max,
  );
}

async function readDbValues(): Promise<Partial<ModerationFailureAlertConfig>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, KEY_LIST));
  const out: Partial<ModerationFailureAlertConfig> = {};
  for (const row of rows) {
    if (row.key === KEYS.threshold) {
      const parsed = coerceThreshold(row.value);
      if (parsed !== null) out.threshold = parsed;
    } else if (row.key === KEYS.windowMinutes) {
      const parsed = coerceWindowMinutes(row.value);
      if (parsed !== null) out.windowMinutes = parsed;
    }
  }
  return out;
}

/**
 * Read the current alert config, falling back to defaults for any field
 * that has not been customized. A corrupt row (wrong type, out of bounds)
 * is treated as "not set" so a single bad row can never disable the alert.
 */
export async function getModerationFailureAlertConfigStatus(): Promise<ModerationFailureAlertConfigStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValues: Partial<ModerationFailureAlertConfig> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[ModerationFailureAlertSettings] Failed to load config from DB:", err);
  }
  const config: ModerationFailureAlertConfig = {
    threshold: dbValues.threshold ?? MODERATION_FAILURE_ALERT_DEFAULTS.threshold,
    windowMinutes:
      dbValues.windowMinutes ?? MODERATION_FAILURE_ALERT_DEFAULTS.windowMinutes,
  };
  const sources: ModerationFailureAlertConfigStatus["sources"] = {
    threshold: dbValues.threshold !== undefined ? "db" : "default",
    windowMinutes: dbValues.windowMinutes !== undefined ? "db" : "default",
  };
  const status: ModerationFailureAlertConfigStatus = {
    config,
    sources,
    defaults: { ...MODERATION_FAILURE_ALERT_DEFAULTS },
    bounds: {
      threshold: { ...MODERATION_FAILURE_ALERT_BOUNDS.threshold },
      windowMinutes: { ...MODERATION_FAILURE_ALERT_BOUNDS.windowMinutes },
    },
  };
  cached = { loadedAt: now, status };
  return status;
}

export async function getModerationFailureAlertConfig(): Promise<ModerationFailureAlertConfig> {
  return (await getModerationFailureAlertConfigStatus()).config;
}

export type FieldUpdateValue = number | null;

export interface ValidatedUpdate {
  threshold?: FieldUpdateValue;
  windowMinutes?: FieldUpdateValue;
}

export type ValidationError = { field: string; message: string };

export function validateUpdate(
  input: unknown,
): { ok: true; update: ValidatedUpdate } | { ok: false; errors: ValidationError[] } {
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
      const { min, max } = MODERATION_FAILURE_ALERT_BOUNDS.threshold;
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
      const { min, max } = MODERATION_FAILURE_ALERT_BOUNDS.windowMinutes;
      if (n < min || n > max) {
        errors.push({ field: "windowMinutes", message: `must be between ${min} and ${max} minutes` });
      } else {
        update.windowMinutes = n;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(update).length === 0) {
    return { ok: false, errors: [{ field: "_root", message: "Provide at least one of threshold, windowMinutes" }] };
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

export async function applyModerationFailureAlertConfigUpdate(
  update: ValidatedUpdate,
  updatedBy: string | null,
): Promise<{
  before: ModerationFailureAlertConfig;
  after: ModerationFailureAlertConfig;
  changedFields: Array<keyof ValidatedUpdate>;
}> {
  const beforeStatus = await getModerationFailureAlertConfigStatus();
  const before = beforeStatus.config;
  const changedFields: Array<keyof ValidatedUpdate> = [];

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
        "Moderation job failure alert: minimum failures inside the window required to fire",
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
        "Moderation job failure alert: rolling window length in minutes",
        updatedBy,
      );
      changedFields.push("windowMinutes");
    }
  }

  cached = null;
  const after = await getModerationFailureAlertConfig();
  return { before, after, changedFields };
}
