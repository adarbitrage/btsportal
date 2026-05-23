/**
 * Storage and retrieval for the "Machine order mismatch" alert thresholds
 * (task #494). When the background alerter sees N+ Machine orders flagged
 * mismatch=true within a rolling window, it pages on-call so a grant-drift
 * regression doesn't sit unnoticed between admin spot-checks.
 *
 * Defaults (threshold=5, windowHours=24) match the launch posture: a small
 * trickle of one-off mismatches is tolerable, but five+ in a day means
 * either The Machine started sending slugs we don't recognize or a portal
 * grant path got broken.
 *
 * Values live in `system_settings` under reserved `machine_mismatch_alert.*`
 * keys so they can be edited from the admin Settings page without a restart.
 * Mirrors the shape of `auth-rate-limit-alert-settings.ts` (cache, per-field
 * provenance, `null` = reset to default, bounds-checked writer) so the
 * Settings UI card and admin routes can use the same patterns.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface MachineMismatchAlertConfig {
  /** Distinct mismatched Machine orders in the window required to fire. */
  threshold: number;
  /** Rolling lookback window, in hours. */
  windowHours: number;
}

export interface MachineMismatchAlertConfigStatus {
  config: MachineMismatchAlertConfig;
  sources: Record<keyof MachineMismatchAlertConfig, "db" | "default">;
  defaults: MachineMismatchAlertConfig;
  bounds: {
    threshold: { min: number; max: number };
    windowHours: { min: number; max: number };
  };
}

export const MACHINE_MISMATCH_ALERT_DEFAULTS: MachineMismatchAlertConfig = {
  threshold: 5,
  windowHours: 24,
};

// Window capped at 7 days — any longer turns the alert into a trend chart,
// not a page-worthy signal. Threshold capped well above realistic order
// volume so admins can't silently disable the alert by overshooting.
export const MACHINE_MISMATCH_ALERT_BOUNDS = {
  threshold: { min: 1, max: 10000 },
  windowHours: { min: 1, max: 168 },
} as const;

const KEYS = {
  threshold: "machine_mismatch_alert.threshold",
  windowHours: "machine_mismatch_alert.window_hours",
} as const satisfies Record<keyof MachineMismatchAlertConfig, string>;

const CATEGORY = "alerts";

const KEY_LIST: string[] = Object.values(KEYS);

export function isMachineMismatchAlertSettingKey(key: string): boolean {
  return key.startsWith("machine_mismatch_alert.");
}

export function getMachineMismatchAlertSettingKeys(): string[] {
  return [...KEY_LIST];
}

interface CachedConfig {
  loadedAt: number;
  status: MachineMismatchAlertConfigStatus;
}

const CACHE_TTL_MS = 10 * 1000;
let cached: CachedConfig | null = null;

export function __invalidateMachineMismatchAlertConfigCacheForTests(): void {
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
    MACHINE_MISMATCH_ALERT_BOUNDS.threshold.min,
    MACHINE_MISMATCH_ALERT_BOUNDS.threshold.max,
  );
}

function coerceWindowHours(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return clampNumber(
    n,
    MACHINE_MISMATCH_ALERT_BOUNDS.windowHours.min,
    MACHINE_MISMATCH_ALERT_BOUNDS.windowHours.max,
  );
}

async function readDbValues(): Promise<Partial<MachineMismatchAlertConfig>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, KEY_LIST));
  const out: Partial<MachineMismatchAlertConfig> = {};
  for (const row of rows) {
    if (row.key === KEYS.threshold) {
      const parsed = coerceThreshold(row.value);
      if (parsed !== null) out.threshold = parsed;
    } else if (row.key === KEYS.windowHours) {
      const parsed = coerceWindowHours(row.value);
      if (parsed !== null) out.windowHours = parsed;
    }
  }
  return out;
}

export async function getMachineMismatchAlertConfigStatus(): Promise<MachineMismatchAlertConfigStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValues: Partial<MachineMismatchAlertConfig> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    console.error("[MachineMismatchAlertSettings] Failed to load config from DB:", err);
  }
  const config: MachineMismatchAlertConfig = {
    threshold: dbValues.threshold ?? MACHINE_MISMATCH_ALERT_DEFAULTS.threshold,
    windowHours: dbValues.windowHours ?? MACHINE_MISMATCH_ALERT_DEFAULTS.windowHours,
  };
  const sources: MachineMismatchAlertConfigStatus["sources"] = {
    threshold: dbValues.threshold !== undefined ? "db" : "default",
    windowHours: dbValues.windowHours !== undefined ? "db" : "default",
  };
  const status: MachineMismatchAlertConfigStatus = {
    config,
    sources,
    defaults: { ...MACHINE_MISMATCH_ALERT_DEFAULTS },
    bounds: {
      threshold: { ...MACHINE_MISMATCH_ALERT_BOUNDS.threshold },
      windowHours: { ...MACHINE_MISMATCH_ALERT_BOUNDS.windowHours },
    },
  };
  cached = { loadedAt: now, status };
  return status;
}

export async function getMachineMismatchAlertConfig(): Promise<MachineMismatchAlertConfig> {
  return (await getMachineMismatchAlertConfigStatus()).config;
}

export type FieldUpdateValue = number | null;

export interface ValidatedUpdate {
  threshold?: FieldUpdateValue;
  windowHours?: FieldUpdateValue;
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
      const { min, max } = MACHINE_MISMATCH_ALERT_BOUNDS.threshold;
      if (n < min || n > max) {
        errors.push({ field: "threshold", message: `must be between ${min} and ${max}` });
      } else {
        update.threshold = n;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(obj, "windowHours")) {
    const raw = obj.windowHours;
    if (raw === null) {
      update.windowHours = null;
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field: "windowHours", message: "must be a number or null" });
    } else {
      const n = Math.trunc(raw);
      const { min, max } = MACHINE_MISMATCH_ALERT_BOUNDS.windowHours;
      if (n < min || n > max) {
        errors.push({ field: "windowHours", message: `must be between ${min} and ${max} hours` });
      } else {
        update.windowHours = n;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "Provide at least one of threshold, windowHours" }],
    };
  }
  return { ok: true, update };
}

async function upsertSetting(
  key: string,
  value: unknown,
  description: string,
  updatedBy: string | null,
): Promise<void> {
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

export async function applyMachineMismatchAlertConfigUpdate(
  update: ValidatedUpdate,
  updatedBy: string | null,
): Promise<{
  before: MachineMismatchAlertConfig;
  after: MachineMismatchAlertConfig;
  changedFields: Array<keyof ValidatedUpdate>;
}> {
  const beforeStatus = await getMachineMismatchAlertConfigStatus();
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
        "Machine order mismatch alert: distinct mismatched orders in window required to page on-call",
        updatedBy,
      );
      changedFields.push("threshold");
    }
  }
  if (update.windowHours !== undefined) {
    if (update.windowHours === null) {
      if (beforeStatus.sources.windowHours === "db") {
        await deleteSetting(KEYS.windowHours);
        changedFields.push("windowHours");
      }
    } else if (update.windowHours !== before.windowHours) {
      await upsertSetting(
        KEYS.windowHours,
        update.windowHours,
        "Machine order mismatch alert: rolling lookback window in hours",
        updatedBy,
      );
      changedFields.push("windowHours");
    }
  }

  cached = null;
  const after = await getMachineMismatchAlertConfig();
  return { before, after, changedFields };
}
