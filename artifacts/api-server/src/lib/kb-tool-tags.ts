/**
 * DB-backed EFFECTIVE tag vocabulary (Task #1586).
 *
 * The TOOL / software / platform tags now live in the `kb_tool_tags` table so an
 * admin can view / add / edit / disable / delete them with no deploy, plus an
 * AI-proposes / human-approves queue (`kb_proposed_tool_tags`). Concept tags and
 * the single troubleshooting tag stay CODE-defined in kb-taxonomy (they change
 * with the product's marketing craft, not day to day).
 *
 * This module exposes the MERGED "effective" vocabulary that retrieval + triage
 * actually use:
 *
 *     effective tags = enabled DB tool tags + code concept tags + troubleshooting
 *
 * The merged vocabulary is cached in memory (a synchronous snapshot) so the hot
 * retrieval path stays sync. The cache is initialised to the code baseline at
 * import time (so nothing is ever empty before the first DB read), refreshed on
 * boot ({@link seedToolTags}), and re-refreshed after every admin mutation.
 * If a DB read fails the last good snapshot (or the code baseline) is kept —
 * the vocabulary degrades gracefully, it never collapses to empty.
 */

import { db } from "@workspace/db";
import { kbToolTagsTable, kbProposedToolTagsTable, type KbToolTag } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  CONCEPT_TAGS,
  TROUBLESHOOTING_TAG,
  TOOL_TAGS,
  TAG_TRIGGERS,
  detectTagsFromTriggers,
} from "./kb-taxonomy.js";

// ───────────────────────────────────────────────────────────────────────────
// Seed definitions — the shipped baseline written to the DB on first boot.
// ───────────────────────────────────────────────────────────────────────────

export interface SeedToolTag {
  slug: string;
  label: string;
  triggers: string[];
  /** Ad-publisher source-protected code names: cannot be disabled/deleted. */
  protected?: boolean;
}

/** The ad-publisher code names — retrieval-boostable but source-protected. */
const PROTECTED_TOOL_SLUGS: ReadonlySet<string> = new Set(["caterpillar", "grasshopper", "crane"]);

/** Human labels for the existing code tool tags (fallback = slug). */
const CODE_TOOL_LABELS: Readonly<Record<string, string>> = {
  flexy: "Flexy",
  diytrax: "DIYTrax",
  metricmover: "MetricMover",
  gifster: "Gifster",
  pixelpress: "PixelPress",
  scrapebot: "ScrapeBot",
  cropbot: "CropBot",
  "affiliate-cmo": "Affiliate CMO",
  freeadcopy: "FreeAdCopy",
  anstrex: "Anstrex",
  caterpillar: "Caterpillar",
  grasshopper: "Grasshopper",
  crane: "Crane",
  "media-mavens": "Media Mavens",
  clickbank: "ClickBank",
};

/**
 * External AI tools members are pointed at (not previously in the code registry).
 * Seeded enabled so retrieval can boost docs about them from day one.
 */
const EXTERNAL_AI_TOOL_SEEDS: readonly SeedToolTag[] = [
  { slug: "poe",          label: "Poe",          triggers: ["poe", "poe.com", "poe ai"] },
  { slug: "claude",       label: "Claude",       triggers: ["claude", "claude ai", "anthropic"] },
  { slug: "chatgpt",      label: "ChatGPT",      triggers: ["chatgpt", "chat gpt", "openai"] },
  { slug: "grok",         label: "Grok",         triggers: ["grok"] },
  { slug: "kling",        label: "Kling",        triggers: ["kling", "kling ai"] },
  { slug: "nano-banana",  label: "Nano Banana",  triggers: ["nano banana", "nanobanana"] },
  { slug: "midjourney",   label: "Midjourney",   triggers: ["midjourney", "mid journey"] },
  { slug: "qwen",         label: "Qwen",         triggers: ["qwen"] },
  { slug: "canva",        label: "Canva",        triggers: ["canva"] },
  { slug: "ezgif",        label: "ezgif",        triggers: ["ezgif", "ez gif"] },
];

/**
 * The full shipped baseline: every current code TOOL_TAG (with its existing
 * triggers + label + protected flag) plus the external AI tools. Written to the
 * DB idempotently by {@link seedToolTags} (ON CONFLICT slug DO NOTHING), so an
 * admin's later edits are never clobbered by a re-seed.
 */
export const SEED_TOOL_TAGS: readonly SeedToolTag[] = [
  ...TOOL_TAGS.map((slug) => ({
    slug,
    label: CODE_TOOL_LABELS[slug] ?? slug,
    triggers: [...(TAG_TRIGGERS[slug] ?? [slug])],
    protected: PROTECTED_TOOL_SLUGS.has(slug),
  })),
  ...EXTERNAL_AI_TOOL_SEEDS,
];

// ───────────────────────────────────────────────────────────────────────────
// Code baseline (concept + troubleshooting) — the always-present half.
// ───────────────────────────────────────────────────────────────────────────

/** Concept + troubleshooting tags never live in the DB — always in effect. */
const CODE_VOCAB_TAGS: readonly string[] = [...CONCEPT_TAGS, TROUBLESHOOTING_TAG];

/** Concept/troubleshooting triggers, extracted from the code baseline map. */
const CODE_VOCAB_TRIGGERS: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, readonly string[]> = {};
  for (const tag of CODE_VOCAB_TAGS) {
    if (TAG_TRIGGERS[tag]) out[tag] = TAG_TRIGGERS[tag];
  }
  return out;
})();

// ───────────────────────────────────────────────────────────────────────────
// In-memory cache of the merged effective vocabulary.
// ───────────────────────────────────────────────────────────────────────────

interface EffectiveVocab {
  /** Ordered effective tag slugs: code concept + troubleshooting + enabled tools. */
  tags: string[];
  tagSet: ReadonlySet<string>;
  /** Merged trigger map (concept/troubleshooting + enabled tool triggers). */
  triggers: Readonly<Record<string, readonly string[]>>;
}

function buildVocab(toolTags: { slug: string; enabled: boolean; triggers: string[] }[]): EffectiveVocab {
  const enabledTools = toolTags.filter((t) => t.enabled);
  const tags = [...CODE_VOCAB_TAGS, ...enabledTools.map((t) => t.slug)];
  const triggers: Record<string, readonly string[]> = { ...CODE_VOCAB_TRIGGERS };
  for (const t of enabledTools) {
    triggers[t.slug] = t.triggers ?? [];
  }
  return { tags, tagSet: new Set(tags), triggers };
}

/** Code-baseline fallback vocab derived from the shipped seed (used pre-DB). */
const BASELINE_VOCAB: EffectiveVocab = buildVocab(
  SEED_TOOL_TAGS.map((t) => ({ slug: t.slug, enabled: true, triggers: t.triggers })),
);

let cache: EffectiveVocab = BASELINE_VOCAB;

/**
 * Re-read the enabled tool tags from the DB and rebuild the effective-vocab
 * snapshot. Call on boot (after seeding) and after every admin mutation. On a
 * DB error the previous snapshot is kept — the vocabulary never collapses.
 */
export async function refreshToolTagCache(): Promise<void> {
  try {
    const rows = await db
      .select({ slug: kbToolTagsTable.slug, enabled: kbToolTagsTable.enabled, triggers: kbToolTagsTable.triggers })
      .from(kbToolTagsTable);
    cache = buildVocab(rows.map((r) => ({ slug: r.slug, enabled: r.enabled, triggers: r.triggers ?? [] })));
  } catch (err) {
    console.error("[kb-tool-tags] refreshToolTagCache failed — keeping last vocab:", err);
  }
}

// ── Synchronous accessors (the hot path) ─────────────────────────────────────

/** The merged effective tag vocabulary (concept + troubleshooting + enabled tools). */
export function getEffectiveTags(): readonly string[] {
  return cache.tags;
}

export function getEffectiveTagSet(): ReadonlySet<string> {
  return cache.tagSet;
}

/** The merged trigger map keyed by effective tag slug. */
export function getEffectiveTagTriggers(): Readonly<Record<string, readonly string[]>> {
  return cache.triggers;
}

/**
 * Detect which effective tags a member query references, so retrieval can boost
 * docs carrying those tags. Merged (DB tool tags + code concept/troubleshooting)
 * counterpart of the code-baseline detector in kb-taxonomy.
 */
export function detectQueryTags(query: string): string[] {
  return detectTagsFromTriggers(query, cache.tags, cache.triggers);
}

/** True when the value is a member of the effective vocabulary. */
export function isEffectiveTag(value: unknown): value is string {
  return typeof value === "string" && cache.tagSet.has(value);
}

/**
 * The effective tag vocabulary grouped by controlled family for the reviewer's
 * grouped multi-select (Task #1865). Concept + troubleshooting are the code
 * baseline; tool tags are the DB-managed enabled set (whatever is not part of
 * the code baseline in the effective list).
 */
export interface EffectiveTagGroups {
  concept: string[];
  tool: string[];
  troubleshooting: string[];
}

export function getEffectiveTagGroups(): EffectiveTagGroups {
  const codeVocab = new Set<string>(CODE_VOCAB_TAGS);
  return {
    concept: [...CONCEPT_TAGS],
    tool: cache.tags.filter((t) => !codeVocab.has(t)),
    troubleshooting: [TROUBLESHOOTING_TAG],
  };
}

/** Filter a candidate tag list down to the effective vocabulary (deduped, lowercased). */
export function normalizeEffectiveTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    const slug = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (slug && cache.tagSet.has(slug)) seen.add(slug);
  }
  return [...seen];
}

// ───────────────────────────────────────────────────────────────────────────
// Boot seeding + AI-proposes capture.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Idempotently insert the shipped baseline tool tags (ON CONFLICT slug DO
 * NOTHING — never clobbers an admin's edits) and warm the cache. Safe to call
 * on every boot.
 */
export async function seedToolTags(): Promise<void> {
  try {
    await db
      .insert(kbToolTagsTable)
      .values(
        SEED_TOOL_TAGS.map((t) => ({
          slug: t.slug,
          label: t.label,
          triggers: t.triggers,
          enabled: true,
          protected: t.protected ?? false,
          source: "seed" as const,
        })),
      )
      .onConflictDoNothing({ target: kbToolTagsTable.slug });
  } catch (err) {
    console.error("[kb-tool-tags] seedToolTags insert failed:", err);
  }
  await refreshToolTagCache();
}

/** Slugify a free-text tool name to the controlled `[a-z0-9-]+` form. */
export function slugifyToolName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Record (or increment) an AI-observed tool name into the proposal queue. Called
 * by triage when the model reports a tool/platform NOT already in the effective
 * vocabulary. The AI never creates a live tag — a human approves the proposal.
 *
 * Idempotent by slug: a brand-new tool is inserted `pending`; a repeat sighting
 * of a still-`pending` proposal bumps its occurrence count + last-seen. Already
 * approved/rejected proposals are left untouched (a rejected name won't nag).
 */
export async function recordProposedToolTag(rawName: string, exampleContext?: string | null): Promise<void> {
  const label = rawName.trim().slice(0, 80);
  const slug = slugifyToolName(label);
  if (!slug) return;
  // Skip anything already part of the effective vocabulary (a live/known tag).
  if (cache.tagSet.has(slug)) return;
  try {
    const existing = await db
      .select({ id: kbProposedToolTagsTable.id, status: kbProposedToolTagsTable.status })
      .from(kbProposedToolTagsTable)
      .where(eq(kbProposedToolTagsTable.slug, slug))
      .limit(1);
    // Also skip if a tool tag with this slug already exists (approved/seeded).
    const liveHit = await db
      .select({ id: kbToolTagsTable.id })
      .from(kbToolTagsTable)
      .where(eq(kbToolTagsTable.slug, slug))
      .limit(1);
    if (liveHit.length > 0) return;

    if (existing.length === 0) {
      await db.insert(kbProposedToolTagsTable).values({
        slug,
        label,
        suggestedTriggers: [label.toLowerCase()],
        exampleContext: exampleContext ?? null,
      }).onConflictDoNothing({ target: kbProposedToolTagsTable.slug });
    } else if (existing[0].status === "pending") {
      await db
        .update(kbProposedToolTagsTable)
        .set({
          occurrenceCount: sql`${kbProposedToolTagsTable.occurrenceCount} + 1`,
          lastSeenAt: new Date(),
        })
        .where(eq(kbProposedToolTagsTable.id, existing[0].id));
    }
  } catch (err) {
    console.error("[kb-tool-tags] recordProposedToolTag failed:", err);
  }
}

export type { KbToolTag };
