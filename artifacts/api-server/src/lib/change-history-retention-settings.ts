/**
 * Storage and retrieval for the retention windows applied by the
 * email-change-history and phone-change-history cleanup jobs. Both jobs
 * historically used a hard-coded 90-day window (the value the email job
 * launched with, which the phone job mirrored). Compliance teams in some
 * orgs need a shorter window; support-heavy orgs that revisit old tickets
 * sometimes want a longer one. Either way, changing the window should not
 * require a code change and a restart.
 *
 * Values live in `system_settings` under reserved
 * `change_history_retention.*` keys so they can be edited from the admin
 * Settings page. A short in-process cache (~10s) keeps the per-tick read
 * off the hot path of the cleanup loop without making an admin save feel
 * stale — the writer invalidates the cache synchronously.
 *
 * Each cleanup job reads its window via `getChangeHistoryRetentionConfig`
 * and falls back to the 90-day default if the read throws or the row is
 * missing / out of bounds. A bad row never disables cleanup: the job
 * keeps running with the safe default.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface ChangeHistoryRetentionConfig {
  /** Number of days to keep email-change history rows before deletion. */
  emailRetentionDays: number;
  /** Number of days to keep phone-change history rows before deletion. */
  phoneRetentionDays: number;
}

export interface ChangeHistoryRetentionConfigStatus {
  config: ChangeHistoryRetentionConfig;
  /** Per-field provenance so the UI can label "default" vs "saved" values. */
  sources: Record<keyof ChangeHistoryRetentionConfig, "db" | "default">;
  /** Defaults so the UI can offer a "reset to defaults" affordance. */
  defaults: ChangeHistoryRetentionConfig;
  /** Bounds the API will accept on save, so the UI can mirror them. */
  bounds: {
    emailRetentionDays: { min: number; max: number };
    phoneRetentionDays: { min: number; max: number };
  };
}

export const CHANGE_HISTORY_RETENTION_DEFAULTS: ChangeHistoryRetentionConfig = {
  emailRetentionDays: 90,
  phoneRetentionDays: 90,
};

// Bounds: 1 day at the low end so a compliance-strict deployment can keep
// almost nothing, 3650 days (~10 years) at the high end as a sanity ceiling
// — well past any realistic retention need but enough room to comply with
// long statutory windows. Both fields use the same bounds today; they're
// declared per-field so we can diverge later without a schema change.
export const CHANGE_HISTORY_RETENTION_BOUNDS = {
  emailRetentionDays: { min: 1, max: 3650 },
  phoneRetentionDays: { min: 1, max: 3650 },
} as const;

const KEYS = {
  emailRetentionDays: "change_history_retention.email_days",
  phoneRetentionDays: "change_history_retention.phone_days",
} as const satisfies Record<keyof ChangeHistoryRetentionConfig, string>;

const CATEGORY = "retention";

const KEY_LIST: string[] = Object.values(KEYS);

export function isChangeHistoryRetentionSettingKey(key: string): boolean {
  return key.startsWith("change_history_retention.");
}

export function getChangeHistoryRetentionSettingKeys(): string[] {
  return [...KEY_LIST];
}

interface CachedConfig {
  loadedAt: number;
  status: ChangeHistoryRetentionConfigStatus;
}

// Cleanup jobs only check retention once an hour, but admin pages and the
// API endpoint may read it multiple times per request. A short cache absorbs
// any burst without making a "Save" feel stale — the writer invalidates the
// cache synchronously below.
const CACHE_TTL_MS = 10 * 1000;
let cached: CachedConfig | null = null;

export function __invalidateChangeHistoryRetentionConfigCacheForTests(): void {
  cached = null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const n = Math.trunc(value);
  return Math.min(max, Math.max(min, n));
}

function coerceDays(
  raw: unknown,
  bounds: { min: number; max: number },
): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  if (n < bounds.min || n > bounds.max) return null;
  return clampInt(n, bounds.min, bounds.max);
}

async function readDbValues(): Promise<Partial<ChangeHistoryRetentionConfig>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, KEY_LIST));
  const out: Partial<ChangeHistoryRetentionConfig> = {};
  for (const row of rows) {
    if (row.key === KEYS.emailRetentionDays) {
      const parsed = coerceDays(
        row.value,
        CHANGE_HISTORY_RETENTION_BOUNDS.emailRetentionDays,
      );
      if (parsed !== null) out.emailRetentionDays = parsed;
    } else if (row.key === KEYS.phoneRetentionDays) {
      const parsed = coerceDays(
        row.value,
        CHANGE_HISTORY_RETENTION_BOUNDS.phoneRetentionDays,
      );
      if (parsed !== null) out.phoneRetentionDays = parsed;
    }
  }
  return out;
}

/**
 * Read the current retention config, falling back to defaults for any field
 * that has not been customized. A bad row (wrong type, out of bounds) is
 * treated as "not set" so a single corrupt setting cannot disable cleanup.
 *
 * Result is cached for `CACHE_TTL_MS`. The writer invalidates the cache
 * synchronously, so an admin save is reflected on the very next read.
 */
export async function getChangeHistoryRetentionConfigStatus(): Promise<ChangeHistoryRetentionConfigStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValues: Partial<ChangeHistoryRetentionConfig> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    // Degrade to defaults rather than knock out the cleanup job or settings UI.
    console.error(
      "[ChangeHistoryRetentionSettings] Failed to load config from DB:",
      err,
    );
  }
  const config: ChangeHistoryRetentionConfig = {
    emailRetentionDays:
      dbValues.emailRetentionDays ??
      CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays,
    phoneRetentionDays:
      dbValues.phoneRetentionDays ??
      CHANGE_HISTORY_RETENTION_DEFAULTS.phoneRetentionDays,
  };
  const sources: ChangeHistoryRetentionConfigStatus["sources"] = {
    emailRetentionDays:
      dbValues.emailRetentionDays !== undefined ? "db" : "default",
    phoneRetentionDays:
      dbValues.phoneRetentionDays !== undefined ? "db" : "default",
  };
  const status: ChangeHistoryRetentionConfigStatus = {
    config,
    sources,
    defaults: { ...CHANGE_HISTORY_RETENTION_DEFAULTS },
    bounds: {
      emailRetentionDays: {
        ...CHANGE_HISTORY_RETENTION_BOUNDS.emailRetentionDays,
      },
      phoneRetentionDays: {
        ...CHANGE_HISTORY_RETENTION_BOUNDS.phoneRetentionDays,
      },
    },
  };
  cached = { loadedAt: now, status };
  return status;
}

export async function getChangeHistoryRetentionConfig(): Promise<ChangeHistoryRetentionConfig> {
  return (await getChangeHistoryRetentionConfigStatus()).config;
}

/**
 * Convenience accessor for the email-change-history cleanup job. Returns
 * the configured email retention window, or the default if anything goes
 * wrong reading the setting.
 */
export async function getEmailChangeHistoryRetentionDays(): Promise<number> {
  try {
    const config = await getChangeHistoryRetentionConfig();
    return config.emailRetentionDays;
  } catch (err) {
    console.error(
      "[ChangeHistoryRetentionSettings] Falling back to default email retention:",
      err,
    );
    return CHANGE_HISTORY_RETENTION_DEFAULTS.emailRetentionDays;
  }
}

/**
 * Convenience accessor for the phone-change-history cleanup job. Returns
 * the configured phone retention window, or the default if anything goes
 * wrong reading the setting.
 */
export async function getPhoneChangeHistoryRetentionDays(): Promise<number> {
  try {
    const config = await getChangeHistoryRetentionConfig();
    return config.phoneRetentionDays;
  } catch (err) {
    console.error(
      "[ChangeHistoryRetentionSettings] Falling back to default phone retention:",
      err,
    );
    return CHANGE_HISTORY_RETENTION_DEFAULTS.phoneRetentionDays;
  }
}

// A field value of `null` in an update payload means "reset to default" —
// the underlying row is deleted so the read path falls back to the default
// and the per-field source flips back to `default`. Saving a number is the
// usual upsert.
export type FieldUpdateValue = number | null;

export interface ValidatedUpdate {
  emailRetentionDays?: FieldUpdateValue;
  phoneRetentionDays?: FieldUpdateValue;
}

export type ValidationError = { field: string; message: string };

/**
 * Validate a partial update payload from the admin UI. Returns either the
 * coerced integer values (or `null` to mean "delete the customization") or
 * a list of per-field errors so the route can surface them all at once.
 */
export function validateUpdate(
  input: unknown,
):
  | { ok: true; update: ValidatedUpdate }
  | { ok: false; errors: ValidationError[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "Body must be an object" }],
    };
  }
  const obj = input as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const update: ValidatedUpdate = {};

  for (const field of [
    "emailRetentionDays",
    "phoneRetentionDays",
  ] as const) {
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
    const n = Math.trunc(raw);
    const { min, max } = CHANGE_HISTORY_RETENTION_BOUNDS[field];
    if (n < min || n > max) {
      errors.push({
        field,
        message: `must be between ${min} and ${max} days`,
      });
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
            "Provide at least one of emailRetentionDays, phoneRetentionDays",
        },
      ],
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

const DESCRIPTIONS: Record<keyof ChangeHistoryRetentionConfig, string> = {
  emailRetentionDays:
    "Number of days to keep email-change history rows before cleanup deletes them",
  phoneRetentionDays:
    "Number of days to keep phone-change history rows before cleanup deletes them",
};

/**
 * Persist a (partial) retention config update. Caller is responsible for
 * having already validated the input via `validateUpdate`. Invalidates the
 * in-process cache synchronously so the next read reflects the write.
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
export async function applyChangeHistoryRetentionConfigUpdate(
  update: ValidatedUpdate,
  updatedBy: string | null,
): Promise<{
  before: ChangeHistoryRetentionConfig;
  after: ChangeHistoryRetentionConfig;
  changedFields: Array<keyof ValidatedUpdate>;
}> {
  const beforeStatus = await getChangeHistoryRetentionConfigStatus();
  const before = beforeStatus.config;
  const changedFields: Array<keyof ValidatedUpdate> = [];

  for (const field of [
    "emailRetentionDays",
    "phoneRetentionDays",
  ] as const) {
    const next = update[field];
    if (next === undefined) continue;
    if (next === null) {
      // Reset to default: only delete (and audit) if a row actually exists.
      if (beforeStatus.sources[field] === "db") {
        await deleteSetting(KEYS[field]);
        changedFields.push(field);
      }
    } else if (next !== before[field]) {
      await upsertSetting(KEYS[field], next, DESCRIPTIONS[field], updatedBy);
      changedFields.push(field);
    }
  }

  cached = null;
  const after = await getChangeHistoryRetentionConfig();
  return { before, after, changedFields };
}
