/**
 * Storage and retrieval for the AI classifier flagging threshold used by
 * `engine.ts`. A post/comment is flagged when *any* classifier score
 * (`toxicity`, `spam`, `harassment`, `hate_speech`) exceeds this threshold.
 *
 * The threshold was hard-coded at 0.5 originally. Surfacing it as a tunable
 * setting lets moderators react to false-positive bursts or misses without a
 * redeploy — bump it up to 0.7 when the classifier is being too eager, drop
 * it to 0.4 when known-bad content is getting through.
 *
 * Lives in `system_settings` under reserved `ai_moderation.*` keys so it can
 * be filtered out of the generic Settings list (the generic editor would
 * happily accept "two" or 9 here, both of which would break the engine).
 * A short in-process cache (~10s) keeps the per-evaluate lookup off the hot
 * path of every new post/comment.
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface AiModerationThresholdConfig {
  /** Minimum classifier score (0..1) at which content is flagged. */
  flagThreshold: number;
}

export interface AiModerationThresholdConfigStatus {
  config: AiModerationThresholdConfig;
  /** Per-field provenance so the UI can label "default" vs "saved" values. */
  sources: Record<keyof AiModerationThresholdConfig, "db" | "default">;
  /** Shipped defaults so the UI can offer a "reset to defaults" affordance. */
  defaults: AiModerationThresholdConfig;
  /** Bounds the API will accept on save, mirrored to the UI. */
  bounds: {
    flagThreshold: { min: number; max: number };
  };
}

export const AI_MODERATION_THRESHOLD_DEFAULTS: AiModerationThresholdConfig = {
  flagThreshold: 0.5,
};

// Full 0..1 range. 0 would flag everything (effectively a kill-switch for
// AI moderation in the "flag everything for review" direction); 1 would
// flag nothing (effectively disabling the AI classifier). Both extremes
// are legitimate operational choices so we don't narrow the range further.
export const AI_MODERATION_THRESHOLD_BOUNDS = {
  flagThreshold: { min: 0, max: 1 },
} as const;

const KEYS = {
  flagThreshold: "ai_moderation.flag_threshold",
} as const satisfies Record<keyof AiModerationThresholdConfig, string>;

const CATEGORY = "moderation";

const KEY_LIST: string[] = Object.values(KEYS);

export function isAiModerationThresholdSettingKey(key: string): boolean {
  return key.startsWith("ai_moderation.");
}

export function getAiModerationThresholdSettingKeys(): string[] {
  return [...KEY_LIST];
}

interface CachedConfig {
  loadedAt: number;
  status: AiModerationThresholdConfigStatus;
}

const CACHE_TTL_MS = 10 * 1000;
let cached: CachedConfig | null = null;

export function __invalidateAiModerationThresholdConfigCacheForTests(): void {
  cached = null;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function coerceFlagThreshold(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return clampNumber(
    raw,
    AI_MODERATION_THRESHOLD_BOUNDS.flagThreshold.min,
    AI_MODERATION_THRESHOLD_BOUNDS.flagThreshold.max,
  );
}

async function readDbValues(): Promise<Partial<AiModerationThresholdConfig>> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, KEY_LIST));
  const out: Partial<AiModerationThresholdConfig> = {};
  for (const row of rows) {
    if (row.key === KEYS.flagThreshold) {
      const parsed = coerceFlagThreshold(row.value);
      if (parsed !== null) out.flagThreshold = parsed;
    }
  }
  return out;
}

export async function getAiModerationThresholdConfigStatus(): Promise<AiModerationThresholdConfigStatus> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.status;
  }
  let dbValues: Partial<AiModerationThresholdConfig> = {};
  try {
    dbValues = await readDbValues();
  } catch (err) {
    // Degrade to defaults rather than crash the evaluate() hot path.
    console.error("[AiModerationThresholdSettings] Failed to load config from DB:", err);
  }
  const config: AiModerationThresholdConfig = {
    flagThreshold:
      dbValues.flagThreshold ?? AI_MODERATION_THRESHOLD_DEFAULTS.flagThreshold,
  };
  const sources: AiModerationThresholdConfigStatus["sources"] = {
    flagThreshold: dbValues.flagThreshold !== undefined ? "db" : "default",
  };
  const status: AiModerationThresholdConfigStatus = {
    config,
    sources,
    defaults: { ...AI_MODERATION_THRESHOLD_DEFAULTS },
    bounds: {
      flagThreshold: { ...AI_MODERATION_THRESHOLD_BOUNDS.flagThreshold },
    },
  };
  cached = { loadedAt: now, status };
  return status;
}

export async function getAiModerationThresholdConfig(): Promise<AiModerationThresholdConfig> {
  return (await getAiModerationThresholdConfigStatus()).config;
}

export type FieldUpdateValue = number | null;

export interface ValidatedUpdate {
  flagThreshold?: FieldUpdateValue;
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

  if (Object.prototype.hasOwnProperty.call(obj, "flagThreshold")) {
    const raw = obj.flagThreshold;
    if (raw === null) {
      update.flagThreshold = null;
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ field: "flagThreshold", message: "must be a number or null" });
    } else {
      const { min, max } = AI_MODERATION_THRESHOLD_BOUNDS.flagThreshold;
      if (raw < min || raw > max) {
        errors.push({ field: "flagThreshold", message: `must be between ${min} and ${max}` });
      } else {
        update.flagThreshold = raw;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(update).length === 0) {
    return { ok: false, errors: [{ field: "_root", message: "Provide flagThreshold" }] };
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

export async function applyAiModerationThresholdConfigUpdate(
  update: ValidatedUpdate,
  updatedBy: string | null,
): Promise<{
  before: AiModerationThresholdConfig;
  after: AiModerationThresholdConfig;
  changedFields: Array<keyof ValidatedUpdate>;
}> {
  const beforeStatus = await getAiModerationThresholdConfigStatus();
  const before = beforeStatus.config;
  const changedFields: Array<keyof ValidatedUpdate> = [];

  if (update.flagThreshold !== undefined) {
    if (update.flagThreshold === null) {
      if (beforeStatus.sources.flagThreshold === "db") {
        await deleteSetting(KEYS.flagThreshold);
        changedFields.push("flagThreshold");
      }
    } else if (update.flagThreshold !== before.flagThreshold) {
      await upsertSetting(
        KEYS.flagThreshold,
        update.flagThreshold,
        "AI moderation: minimum classifier score (0..1) at which content is flagged for review",
        updatedBy,
      );
      changedFields.push("flagThreshold");
    }
  }

  cached = null;
  const after = await getAiModerationThresholdConfig();
  return { before, after, changedFields };
}
