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

import { db, systemSettingsTable, moderationQueueTable } from "@workspace/db";
import { eq, inArray, gte, desc } from "drizzle-orm";

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

export interface AiModerationThresholdPreview {
  /** The proposed threshold the preview was computed against. */
  threshold: number;
  /** The currently-saved threshold (for side-by-side comparison). */
  currentThreshold: number;
  /** How many days of moderation_queue history were considered. */
  sampleWindowDays: number;
  /** Total queue rows scanned (capped). */
  sampleSize: number;
  /**
   * Of those rows, how many have at least one AI classifier score that
   * exceeds the proposed threshold (i.e. would be AI-flagged at that
   * setting). Wordlist-only flags are unaffected by the threshold and
   * are excluded from this count.
   */
  wouldBeFlaggedByAi: number;
  /** Same count, but at the currently-saved threshold, for comparison. */
  currentlyFlaggedByAi: number;
}

const PREVIEW_WINDOW_DAYS = 30;
const PREVIEW_MAX_ROWS = 500;

function maxAiScore(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  let best = 0;
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > best) best = v;
  }
  return best;
}

/**
 * Compute a "what-if" preview for the AI moderation flag threshold.
 *
 * We use the last `PREVIEW_WINDOW_DAYS` of `moderation_queue` rows (capped
 * at `PREVIEW_MAX_ROWS`) as a representative sample of recently-scored
 * content. For each row we look at the largest classifier score and check
 * whether it exceeds the proposed threshold. That mirrors the engine's
 * `Object.values(aiScores).some((s) => s > flagThreshold)` rule.
 *
 * Caveats surfaced to the UI:
 * - The sample is biased toward content that was already flagged by *some*
 *   rule, so the absolute count is a lower bound for low thresholds.
 *   Still, the *direction* (more vs fewer than today) and the comparison
 *   against the current threshold are the useful signals for an admin
 *   sanity-checking a proposed change.
 */
export async function computeAiThresholdPreview(
  proposedThreshold: number,
): Promise<AiModerationThresholdPreview> {
  const status = await getAiModerationThresholdConfigStatus();
  const currentThreshold = status.config.flagThreshold;
  const since = new Date(Date.now() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ aiScores: moderationQueueTable.aiScores })
    .from(moderationQueueTable)
    .where(gte(moderationQueueTable.createdAt, since))
    .orderBy(desc(moderationQueueTable.createdAt))
    .limit(PREVIEW_MAX_ROWS);

  let wouldBeFlaggedByAi = 0;
  let currentlyFlaggedByAi = 0;
  for (const row of rows) {
    const score = maxAiScore(row.aiScores);
    if (score > proposedThreshold) wouldBeFlaggedByAi += 1;
    if (score > currentThreshold) currentlyFlaggedByAi += 1;
  }

  return {
    threshold: proposedThreshold,
    currentThreshold,
    sampleWindowDays: PREVIEW_WINDOW_DAYS,
    sampleSize: rows.length,
    wouldBeFlaggedByAi,
    currentlyFlaggedByAi,
  };
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
