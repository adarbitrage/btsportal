/**
 * Storage and retrieval for the five editable pitch-block content blocks
 * consumed by `pitch-resolver.ts`'s `renderPitchStackHtml`.
 * Values live in `system_settings` under reserved `pitch.*` keys so an admin
 * can change the copy/URL for any block from the Settings UI without a
 * deploy — mirrors the DB-value-over-shipped-default pattern used for
 * on-call destinations (`oncall-settings.ts`).
 *
 * Each block is heading + optional body paragraph + optional line + a button
 * label + a button URL. A saved DB row may set only some fields; any field
 * it omits falls back to the shipped placeholder default (computed fresh each
 * read so the default button URL always points at the current portal's
 * `/plans` page, even if the portal URL setting changes later).
 */

import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getPortalUrl } from "./portal-url-settings";
import { qualifyPublicAssetUrl } from "./seed-templates";

export type PitchBlockKey =
  | "LAUNCHPAD_PITCH"
  | "MENTORSHIP_PITCH"
  | "MACHINE_PITCH"
  | "MACHINE_INTRO_PITCH"
  | "VIP_ARBITRAGE_PITCH";

export const PITCH_BLOCK_KEYS: PitchBlockKey[] = [
  "LAUNCHPAD_PITCH",
  "MENTORSHIP_PITCH",
  "MACHINE_PITCH",
  "MACHINE_INTRO_PITCH",
  "VIP_ARBITRAGE_PITCH",
];

export interface PitchContent {
  heading: string;
  /**
   * Task #1899: optional paragraph-length body copy, rendered between the
   * heading and the CTA button. Supports `**bold**`, `*italic*`, and
   * `__underline__` markers (transformed by the escape-then-transform seam
   * in `renderGatedPitchBlock`). When absent, falls back to `line` for
   * backward compatibility.
   */
  body?: string;
  /**
   * Short single-line copy rendered below the heading (pre-Task-#1899
   * field). Still used by legacy blocks (e.g. VIP_ARBITRAGE_PITCH) and
   * any block where an admin didn't supply `body`. Rendered as-is when
   * `body` is absent; ignored when `body` is present.
   */
  line?: string;
  buttonLabel: string;
  buttonUrl: string;
  /**
   * Task #1820: optional email-safe thumbnail (typically an animated GIF
   * with a play button baked into the image file) rendered above the pitch
   * heading, linked via `thumbnailLinkUrl`. Both fields are optional and
   * independent of each other — a block with neither set renders exactly as
   * before this task. May be a root-relative public-asset path (e.g.
   * `/images/pitch-thumbnails/...`), which is qualified to an absolute URL
   * via `qualifyPublicAssetUrl` at read time, or an absolute URL already.
   */
  thumbnailUrl?: string;
  thumbnailLinkUrl?: string;
  /**
   * Task #1824: hard compliance gate for VIP_ARBITRAGE_PITCH only. VIP
   * Arbitrage is a Reg D 506(c) securities offering, so its pitch copy is
   * securities marketing — it must never reach a member's inbox before
   * securities counsel has signed off. Defaults to `false` (suppressed) for
   * every other block this field is simply ignored. See
   * `pitch-resolver.ts`'s `isPitchBlockReviewed`/`renderGatedPitchBlock` for
   * the single seam that enforces this.
   */
  reviewed?: boolean;
}

const SETTING_KEYS: Record<PitchBlockKey, string> = {
  LAUNCHPAD_PITCH: "pitch.launchpad",
  MENTORSHIP_PITCH: "pitch.mentorship",
  MACHINE_PITCH: "pitch.machine",
  // Task #1899: softer Machine intro for ranks 0–1 (no commission claim).
  MACHINE_INTRO_PITCH: "pitch.machine_intro",
  // Task #1824: retired `pitch.vip` (VIP_PITCH) without migrating its value —
  // that copy pitched the wrong product (BTS VIP status) and was never
  // reviewed for the new securities-marketing content. `pitch.vip_arbitrage`
  // is a brand-new key that starts empty/suppressed.
  VIP_ARBITRAGE_PITCH: "pitch.vip_arbitrage",
};

const CATEGORY = "pitch";

export function isPitchContentSettingKey(key: string): boolean {
  return (Object.values(SETTING_KEYS) as string[]).includes(key);
}

export function getPitchContentSettingKeys(): string[] {
  return Object.values(SETTING_KEYS);
}

// Placeholder copy only — the boot seed in `seed-pitch-content.ts` supplies
// real copy at startup (insert-only, never overwrites owner edits). These
// defaults are intentionally sparse so a block with no saved row and no seed
// row shows obviously placeholder copy rather than silently sending empty
// strings.
function defaultContentFor(key: PitchBlockKey, plansUrl: string, vipArbitrageUrl: string): PitchContent {
  switch (key) {
    case "LAUNCHPAD_PITCH":
      return {
        heading: "[Placeholder] Ready to get started with LaunchPad?",
        line: "Unlock software access and your first coaching calls with a LaunchPad upgrade.",
        buttonLabel: "Explore LaunchPad",
        buttonUrl: plansUrl,
      };
    case "MENTORSHIP_PITCH":
      return {
        heading: "[Placeholder] Take the next step with Mentorship",
        line: "Get group coaching, community access, and affiliate commissions with a Mentorship plan.",
        buttonLabel: "View Mentorship Plans",
        buttonUrl: plansUrl,
      };
    case "MACHINE_PITCH":
      return {
        heading: "[Placeholder] Automate it with Machine",
        line: "Let Machine handle the busywork so you can focus on growth.",
        buttonLabel: "Learn About Machine",
        buttonUrl: plansUrl,
      };
    case "MACHINE_INTRO_PITCH":
      // Task #1899: softer intro for ranks 0–1; no commission claim.
      return {
        heading: "[Placeholder] Meet The Machine",
        line: "The AI-powered campaign engine our top affiliates run on.",
        buttonLabel: "See The Machine",
        buttonUrl: plansUrl,
      };
    case "VIP_ARBITRAGE_PITCH":
      // Task #1824: securities marketing copy (Reg D 506(c) offering) — this
      // is a placeholder ONLY and MUST stay suppressed (reviewed: false)
      // until securities counsel signs off on real copy. The gate in
      // pitch-resolver.ts prevents this block from ever rendering while
      // `reviewed` is not explicitly `true`.
      return {
        heading: "[Placeholder — NOT REVIEWED] VIP Arbitrage",
        line: "[Placeholder — awaiting securities counsel review before this may be sent.]",
        buttonLabel: "Learn More",
        buttonUrl: vipArbitrageUrl,
        reviewed: false,
      };
  }
}

function parseStoredContent(raw: unknown): Partial<PitchContent> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Partial<PitchContent> = {};
  for (const field of ["heading", "line", "buttonLabel", "buttonUrl"] as const) {
    if (typeof obj[field] === "string") out[field] = obj[field] as string;
  }
  // Task #1899: `body` is an optional paragraph-length field. Stored empty
  // string means "explicitly cleared" — treat the same as absent.
  if (typeof obj.body === "string" && (obj.body as string).trim()) {
    out.body = (obj.body as string);
  }
  // Task #1820: optional fields. A stored empty string means "explicitly
  // cleared" and must NOT be carried through as a truthy value — omit it so
  // downstream rendering treats it the same as "never set".
  for (const field of ["thumbnailUrl", "thumbnailLinkUrl"] as const) {
    if (typeof obj[field] === "string" && (obj[field] as string).trim()) {
      out[field] = (obj[field] as string).trim();
    }
  }
  // Task #1824: `reviewed` must be read strictly — anything other than the
  // literal boolean `true` (missing field, malformed value, non-boolean
  // type) resolves to "not reviewed" so the compliance gate fails closed.
  if (obj.reviewed === true) {
    out.reviewed = true;
  }
  return out;
}

interface CachedContent {
  loadedAt: number;
  rows: Partial<Record<PitchBlockKey, Partial<PitchContent>>>;
}

// Copy can tolerate a short cache (unlike tier resolution, which must be
// read fresh from the DB on every send — see pitch-resolver.ts).
const CACHE_TTL_MS = 10 * 1000;
let cache: CachedContent | null = null;

/** Test-only: drop the cached content so the next read re-queries the DB. */
export function __invalidatePitchContentCacheForTests(): void {
  cache = null;
}

async function readDbValues(): Promise<
  Partial<Record<PitchBlockKey, Partial<PitchContent>>>
> {
  const rows = await db
    .select({ key: systemSettingsTable.key, value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(inArray(systemSettingsTable.key, Object.values(SETTING_KEYS)));
  const out: Partial<Record<PitchBlockKey, Partial<PitchContent>>> = {};
  for (const [blockKey, settingKey] of Object.entries(SETTING_KEYS) as Array<
    [PitchBlockKey, string]
  >) {
    const row = rows.find((r) => r.key === settingKey);
    if (!row) continue;
    const parsed = parseStoredContent(row.value);
    if (parsed) out[blockKey] = parsed;
  }
  return out;
}

async function resolvePlansUrl(): Promise<string> {
  const portalUrl = await getPortalUrl();
  return portalUrl ? `${portalUrl.replace(/\/+$/, "")}/plans` : "/plans";
}

// Task #1824: default button URL (and thumbnail destination) for the VIP
// Arbitrage block, computed fresh via the same pattern as `resolvePlansUrl`
// so it always reflects the current portal URL setting. The portal's
// `/vip-arbitrage` landing page (Task #1852) serves this route; the
// compliance gate in pitch-resolver.ts still keeps the email block itself
// suppressed until counsel marks the content `reviewed`.
async function resolveVipArbitrageUrl(): Promise<string> {
  const portalUrl = await getPortalUrl();
  return portalUrl ? `${portalUrl.replace(/\/+$/, "")}/vip-arbitrage` : "/vip-arbitrage";
}

function mergeWithDefault(
  key: PitchBlockKey,
  stored: Partial<PitchContent> | undefined,
  plansUrl: string,
  vipArbitrageUrl: string,
  portalUrl: string | null,
): PitchContent {
  const def = defaultContentFor(key, plansUrl, vipArbitrageUrl);
  // Task #1820: the shipped thumbnail default must ONLY apply when there is
  // no saved row at all for this block (fresh installs / never-touched
  // blocks). Any existing saved row — even one predating this task that has
  // neither thumbnail field — must NOT inherit the default thumbnail; a
  // legacy row's absence of thumbnailUrl/thumbnailLinkUrl means "no
  // thumbnail", not "use the default". This keeps the change purely
  // additive for every already-saved pitch block.
  const merged: PitchContent = stored
    ? { ...def, ...stored, thumbnailUrl: stored.thumbnailUrl, thumbnailLinkUrl: stored.thumbnailLinkUrl }
    : def;
  // Task #1820: qualify a root-relative thumbnail path (e.g.
  // `/images/pitch-thumbnails/...`) to an absolute URL the same way
  // renderPersonBlock's photoUrl is qualified — an already-absolute URL
  // passes through untouched, and `/objects/...` paths are rejected (not
  // email-safe) by qualifyPublicAssetUrl itself.
  if (merged.thumbnailUrl) {
    const qualified = qualifyPublicAssetUrl(merged.thumbnailUrl, portalUrl);
    if (qualified) {
      merged.thumbnailUrl = qualified;
    } else if (merged.thumbnailUrl.startsWith("/objects/")) {
      delete merged.thumbnailUrl;
    }
  }
  return merged;
}

/**
 * Resolve all five pitch content blocks, DB value (per-field) over shipped
 * default. Safe to call on every send that needs a pitch slot — cached for a
 * few seconds so per-send reads don't hammer the DB.
 */
export async function getAllPitchContent(): Promise<
  Record<PitchBlockKey, PitchContent>
> {
  const now = Date.now();
  let dbValues: Partial<Record<PitchBlockKey, Partial<PitchContent>>>;
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    dbValues = cache.rows;
  } else {
    try {
      dbValues = await readDbValues();
    } catch (err) {
      console.error("[PitchContentSettings] Failed to load pitch content from DB:", err);
      dbValues = {};
    }
    cache = { loadedAt: now, rows: dbValues };
  }
  const [plansUrl, vipArbitrageUrl, portalUrl] = await Promise.all([
    resolvePlansUrl(),
    resolveVipArbitrageUrl(),
    getPortalUrl(),
  ]);
  const out = {} as Record<PitchBlockKey, PitchContent>;
  for (const key of PITCH_BLOCK_KEYS) {
    out[key] = mergeWithDefault(key, dbValues[key], plansUrl, vipArbitrageUrl, portalUrl);
  }
  return out;
}

export async function getPitchContent(key: PitchBlockKey): Promise<PitchContent> {
  const all = await getAllPitchContent();
  return all[key];
}

export function validatePitchContentUpdate(
  input: unknown,
): { ok: true; content: PitchContent } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Body must be an object" };
  }
  const obj = input as Record<string, unknown>;
  // heading, buttonLabel, buttonUrl are always required.
  for (const field of ["heading", "buttonLabel", "buttonUrl"] as const) {
    const val = obj[field];
    if (typeof val !== "string" || !val.trim()) {
      return { ok: false, error: `${field} is required and must be a non-empty string` };
    }
  }
  // Task #1899: `body` is an optional paragraph-length field. `line` is also
  // now optional — but at least one of `body` or `line` must be non-empty
  // so blocks always have some copy (heading-only blocks aren't useful).
  const bodyVal = obj.body;
  const lineVal = obj.line;
  if (bodyVal !== undefined && bodyVal !== null && typeof bodyVal !== "string") {
    return { ok: false, error: "body must be a string when provided" };
  }
  if (lineVal !== undefined && lineVal !== null && typeof lineVal !== "string") {
    return { ok: false, error: "line must be a string when provided" };
  }
  const hasBody = typeof bodyVal === "string" && (bodyVal as string).trim().length > 0;
  const hasLine = typeof lineVal === "string" && (lineVal as string).trim().length > 0;
  if (!hasBody && !hasLine) {
    return { ok: false, error: "At least one of body or line is required and must be a non-empty string" };
  }
  // Task #1820: optional thumbnail fields. Absent/empty is valid (no
  // thumbnail); when present they must be strings. An empty string clears
  // the field (handled by parseStoredContent trimming it away on read).
  for (const field of ["thumbnailUrl", "thumbnailLinkUrl"] as const) {
    const val = obj[field];
    if (val !== undefined && val !== null && typeof val !== "string") {
      return { ok: false, error: `${field} must be a string when provided` };
    }
  }
  // Task #1824: `reviewed` is the compliance gate for VIP_ARBITRAGE_PITCH.
  // It must be an explicit boolean when provided — never inferred/defaulted
  // to `true` from a content edit — so saving new copy can never
  // accidentally flip the gate open. Absent is valid (treated as `false`
  // downstream via parseStoredContent/mergeWithDefault).
  if (obj.reviewed !== undefined && typeof obj.reviewed !== "boolean") {
    return { ok: false, error: "reviewed must be a boolean when provided" };
  }
  const content: PitchContent = {
    heading: (obj.heading as string).trim(),
    buttonLabel: (obj.buttonLabel as string).trim(),
    buttonUrl: (obj.buttonUrl as string).trim(),
  };
  if (hasBody) content.body = (bodyVal as string);
  if (typeof lineVal === "string") content.line = (lineVal as string).trim();
  const thumbnailUrl = typeof obj.thumbnailUrl === "string" ? obj.thumbnailUrl.trim() : "";
  const thumbnailLinkUrl = typeof obj.thumbnailLinkUrl === "string" ? obj.thumbnailLinkUrl.trim() : "";
  if (thumbnailUrl) content.thumbnailUrl = thumbnailUrl;
  if (thumbnailLinkUrl) content.thumbnailLinkUrl = thumbnailLinkUrl;
  // Explicit boolean only — `reviewed: false` must be preserved (not
  // stripped by a truthiness check) since that's the fail-closed default.
  if (typeof obj.reviewed === "boolean") content.reviewed = obj.reviewed;
  return { ok: true, content };
}

/** Upsert one pitch content block. Invalidates the read cache. */
export async function setPitchContent(
  key: PitchBlockKey,
  content: PitchContent,
  updatedBy: string | null,
): Promise<void> {
  const settingKey = SETTING_KEYS[key];
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, settingKey))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(systemSettingsTable)
      .set({ value: content, updatedBy: updatedBy ?? undefined })
      .where(eq(systemSettingsTable.key, settingKey));
  } else {
    await db.insert(systemSettingsTable).values({
      key: settingKey,
      value: content,
      category: CATEGORY,
      description: `Pitch content block: ${key}`,
      updatedBy: updatedBy ?? undefined,
    });
  }
  cache = null;
}

/**
 * Task #1899: insert-only setter used by the boot seed. Unlike `setPitchContent`
 * (which upserts), this only writes when no saved row exists for this key —
 * an existing owner edit is always preserved.
 *
 * Returns `true` if the row was inserted, `false` if it already existed.
 */
export async function setPitchContentIfAbsent(
  key: PitchBlockKey,
  content: PitchContent,
): Promise<boolean> {
  const settingKey = SETTING_KEYS[key];
  const existing = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, settingKey))
    .limit(1);
  if (existing.length > 0) return false;
  await db.insert(systemSettingsTable).values({
    key: settingKey,
    value: content,
    category: CATEGORY,
    description: `Pitch content block: ${key}`,
    updatedBy: "boot-seed",
  });
  cache = null;
  return true;
}
