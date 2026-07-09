/**
 * Self-maintaining "possible member name" flag vocabulary (Task #1815).
 *
 * The review-panel possible_member_name advisory heuristic (kb-review-risk)
 * used to rely on a hand-maintained static pair allowlist. This module now
 * DERIVES the terminology vocabulary at call time (cached) from the sources
 * the codebase already maintains, so new terminology introduced by future
 * synthesis runs stops flagging without hand-editing a list:
 *
 *   - the static hand-verified seed pairs (SEED_TERMINOLOGY_PHRASES — kept as
 *     seed data, no longer the primary control),
 *   - BTS house terms (glossary-derived, same set the Transcript Cleaner uses)
 *     → WORD-level suppression (the ONLY word-level source: a closed,
 *     hand-curated product-name set with no person-name collisions),
 *   - the effective KB tool-tag vocabulary (DB-managed, read at call time per
 *     its existing snapshot pattern) → EXACT-PAIR suppression only. Tool tags
 *     include generic words that collide with real first names (e.g.
 *     "claude"), so word-level suppression here would hide real people
 *     ("Claude Robinson") — multi-word triggers become exact phrases,
 *     single-word triggers are ignored,
 *   - glossary multi-word terms + citable live-doc titles → EXACT-PAIR
 *     suppression (title/content-derived, so word-level would be unsafe),
 *   - corpus-frequency pairs: a capitalized pair appearing in >=
 *     {@link NAME_PAIR_DOC_THRESHOLD} DISTINCT docs across the staging + live
 *     corpus is terminology (real member names appear in one or two docs) →
 *     EXACT-PAIR suppression,
 *   - reviewer dismissals (kb_name_flag_dismissals — the persistent "not a
 *     name" loop) → EXACT-PAIR suppression.
 *
 * SAFETY RAIL: any pair matching the privacy scrub rules (coach/staff
 * surnames, founder, old brand) is excluded from every derived set here AND
 * re-checked at analyzer time — the deterministic privacy pass always wins.
 * The privacy scrub itself still runs at publish/retrieval regardless.
 */

import { db } from "@workspace/db";
import { kbNameFlagDismissalsTable, kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BASELINE_NAME_FLAG_VOCAB,
  SEED_TERMINOLOGY_PHRASES,
  isPrivacyProtectedPair,
  type NameFlagVocab,
} from "./kb-review-risk.js";
import { loadBtsHouseTerms } from "./transcript-cleaner.js";
import { getEffectiveTagTriggers } from "./kb-tool-tags.js";

/**
 * Conservative cross-doc threshold: a pair must appear in at least this many
 * DISTINCT corpus docs to be treated as terminology. Real member names show up
 * in one or two docs; a member mentioned this widely would still be caught by
 * the privacy scrub at publish time (and coach/staff names are privacy-railed
 * out of suppression entirely).
 */
export const NAME_PAIR_DOC_THRESHOLD = 4;

/** The same capitalized-pair shape the analyzer matches. */
const PAIR_RE = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;

/** Extract lowercased capitalized pairs from a text (deduped). */
export function extractCapitalizedPairs(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(PAIR_RE)) {
    out.add(m[0].toLowerCase());
  }
  return out;
}

/** All glossary terms (any category), for exact-pair suppression of two-word terms. */
function loadGlossaryTerms(): string[] {
  let raw = "";
  try {
    raw = readFileSync(join(__dirname, "..", "knowledge-base", "glossary.txt"), "utf8");
  } catch {
    return [];
  }
  const terms: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const term = cells[1] ?? "";
    if (!term || term === "Item") continue;
    if (term.length < 3 || term.length > 60) continue;
    terms.push(term);
  }
  return terms;
}

export interface NameFlagVocabParts {
  /** Authoritative single-word product/tool terms → word-level suppression. */
  authoritativeWords: readonly string[];
  /** Multi-word terminology phrases (glossary terms, tool labels). */
  terminologyPhrases: readonly string[];
  /** Citable live-doc titles — capitalized pairs are extracted as exact pairs. */
  docTitles: readonly string[];
  /** Lowercased pairs that met the corpus-frequency threshold. */
  corpusPairs: readonly string[];
  /** Lowercased reviewer-dismissed pairs. */
  dismissedPairs: readonly string[];
}

/**
 * Pure vocabulary assembly — unit-tested. Applies the privacy rail to every
 * derived entry: privacy-protected pairs/words never enter the sets.
 */
export function buildNameFlagVocab(parts: NameFlagVocabParts): NameFlagVocab {
  const phrases = new Set<string>(SEED_TERMINOLOGY_PHRASES);
  const words = new Set<string>();

  const addPhrase = (p: string) => {
    const norm = p.trim().toLowerCase().replace(/\s+/g, " ");
    if (!norm.includes(" ")) return;
    if (isPrivacyProtectedPair(norm)) return;
    phrases.add(norm);
  };
  const addWord = (w: string) => {
    const norm = w.trim().toLowerCase();
    if (norm.length < 3) return;
    if (isPrivacyProtectedPair(norm)) return;
    words.add(norm);
  };

  for (const w of parts.authoritativeWords) {
    if (w.trim().includes(" ")) addPhrase(w);
    else addWord(w);
  }
  for (const p of parts.terminologyPhrases) {
    if (p.trim().includes(" ")) addPhrase(p);
    // Single-word glossary terms are NOT word-suppressed — glossary rows are
    // content-derived text, so only exact multi-word phrases are safe.
  }
  for (const title of parts.docTitles) {
    for (const pair of extractCapitalizedPairs(title)) addPhrase(pair);
  }
  for (const pair of parts.corpusPairs) addPhrase(pair);
  for (const pair of parts.dismissedPairs) addPhrase(pair);

  return { phrases, words };
}

// ── Cached snapshot (same pattern as kb-tool-tags) ──────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: NameFlagVocab = BASELINE_NAME_FLAG_VOCAB;
let cacheBuiltAt = 0;

/**
 * Cross-doc capitalized-pair counts over the staging + live corpus. Returns
 * the lowercased pairs seen in >= threshold DISTINCT docs. Runs inside the
 * cached refresh, so the review-insights endpoint stays fast.
 */
async function computeCorpusFrequentPairs(threshold: number): Promise<string[]> {
  const docCounts = new Map<string, number>();
  const tally = (texts: string[]) => {
    for (const text of texts) {
      for (const pair of extractCapitalizedPairs(text)) {
        docCounts.set(pair, (docCounts.get(pair) ?? 0) + 1);
      }
    }
  };

  const stagingRows = await db
    .select({
      content: sql<string>`COALESCE(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content})`,
    })
    .from(kbStagingDocsTable)
    .where(sql`${kbStagingDocsTable.status} <> 'rejected'`);
  const liveRows = await db
    .select({ content: aiLiveDocumentsTable.content })
    .from(aiLiveDocumentsTable);

  tally(stagingRows.map((r) => r.content ?? ""));
  tally(liveRows.map((r) => r.content ?? ""));

  const out: string[] = [];
  for (const [pair, n] of docCounts) {
    if (n >= threshold) out.push(pair);
  }
  return out;
}

/**
 * Rebuild the derived vocabulary from all sources. On any DB error the last
 * good snapshot is kept (baseline before the first successful build) — the
 * vocabulary degrades gracefully, it never collapses.
 */
export async function refreshNameFlagVocab(): Promise<void> {
  try {
    const [dismissed, corpusPairs, titleRows] = await Promise.all([
      db.select({ pair: kbNameFlagDismissalsTable.pair }).from(kbNameFlagDismissalsTable),
      computeCorpusFrequentPairs(NAME_PAIR_DOC_THRESHOLD),
      db.select({ title: aiLiveDocumentsTable.title }).from(aiLiveDocumentsTable),
    ]);

    // Tool-tag vocabulary: labels ride the trigger lists. PHRASE-ONLY — tool
    // tags contain generic single words that collide with real first names
    // (e.g. "claude"), so they must never enter word-level suppression.
    // buildNameFlagVocab drops single-word phrase candidates, so pushing
    // everything through terminologyPhrases is safe.
    const toolTerms: string[] = [];
    for (const [slug, triggers] of Object.entries(getEffectiveTagTriggers())) {
      toolTerms.push(slug.replace(/-/g, " "));
      for (const t of triggers) toolTerms.push(t);
    }

    cache = buildNameFlagVocab({
      authoritativeWords: loadBtsHouseTerms(),
      terminologyPhrases: [...loadGlossaryTerms(), ...toolTerms],
      docTitles: titleRows.map((r) => r.title ?? ""),
      corpusPairs,
      dismissedPairs: dismissed.map((d) => d.pair),
    });
    cacheBuiltAt = Date.now();
  } catch (err) {
    console.error("[kb-name-flag-vocab] refresh failed — keeping last vocab:", err);
  }
}

/**
 * The vocabulary for an analyzer run: refreshes if the snapshot is stale
 * (TTL), otherwise returns the cached set immediately.
 */
export async function getNameFlagVocab(): Promise<NameFlagVocab> {
  if (Date.now() - cacheBuiltAt > CACHE_TTL_MS) {
    await refreshNameFlagVocab();
  }
  return cache;
}

/** Force the next getNameFlagVocab() to rebuild (after a dismissal mutation). */
export function invalidateNameFlagVocab(): void {
  cacheBuiltAt = 0;
}
