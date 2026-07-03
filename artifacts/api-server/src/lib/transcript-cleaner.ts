/**
 * Transcript Cleaner engine (Task #1468).
 *
 * A generic, tool-agnostic transcript-cleanup service built on the existing
 * Anthropic client. It does NOT assume any single transcription product's
 * output shape: the cleanup + authority-attribution logic degrades gracefully
 * when expected structure (timestamps, speaker names, labels) is absent, and
 * flags genuinely ambiguous files for manual review rather than guessing.
 *
 * Behaviour is informed by the plan #1483 triage findings (the known legacy
 * batch is clean prose with named `Name:` labels, little timestamp/whitespace
 * cruft) but treats those as DEFAULTS, not a contract — later hand-uploaded
 * files come from other tools and may lack names/timestamps/labels entirely.
 *
 * Two AI entry points:
 *  - {@link cleanTranscript}:   one structured-JSON call that reattributes
 *    stray-label segments while preserving each distinct speaker, labels the
 *    source of authority, normalises BTS terminology via the glossary, strips
 *    cruft, proposes a title, and emits per-item review flags + confidence.
 *  - {@link refineTranscript}:  a follow-up call that takes the current cleaned
 *    transcript + an admin instruction and returns an updated transcript +
 *    refreshed flags.
 *
 * NOTE: privacy scrubbing is intentionally NOT done here — per #1483, PII is
 * handled at answer time, and cleaned transcripts are raw source material, not
 * citable truth, so they never enter a member-facing retrieval path.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { db, coachesTable, mediaMavensProductsTable, transcriptCleanerDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  OLD_BRAND_REBRAND_GUIDANCE,
  buildStaffFirstNameGuidance,
  scrubPrivateContent,
} from "./content-privacy-filter";
import { COACHING_ROSTER, VA_ROSTER } from "./coaching-roster";
import {
  resolveSourceFolder,
  authorityRoleFromCoachType,
  AUTHORITY_ROLES,
  DEFAULT_AUTHORITY_ROLE,
  type AuthorityRole,
  type SourceFolder,
} from "./kb-taxonomy";
import type { TranscriptCleanerFlag, TranscriptCleanerChatTurn } from "@workspace/db";

const MODEL = "claude-sonnet-4-6";
// Output cap for a single clean/refine pass. Raised from 8192 so the largest
// stitched multi-part transcripts (the biggest is an 11-part call ≈ 7.6k tokens
// of input, with cleaned output of comparable size) clean in one pass without
// the model's JSON reply being truncated mid-value.
const MAX_TOKENS = 16384;
// How many times to re-request when the model returns unparseable JSON. The
// failure is non-deterministic (an occasional escaping slip), so a fresh
// generation almost always succeeds; truncation (stop_reason="max_tokens") is
// NOT retried because it would deterministically truncate again.
const MAX_JSON_ATTEMPTS = 3;

// Above this raw-character size, the single-pass clean is split into multiple
// passes ("chunks") that are cleaned separately and stitched back together. The
// clean step re-emits the WHOLE transcript, so a single very large file (the
// biggest existing source is ~30k chars) saturates the output window / request
// timeout. Each chunk is sized well under the size we know cleans quickly in a
// single pass, so a 30k-char file becomes ~3 fast passes instead of one that
// times out. Files at/under the threshold take the original single-pass path
// unchanged.
const CLEAN_CHUNK_CHAR_THRESHOLD = 18000;
const CLEAN_CHUNK_TARGET_CHARS = 14000;

// ───────────────────────────────────────────────────────────────────────────
// Roster — the live coach / VA name→type map for deterministic authority swaps.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a name→coaches.type map from the live roster, keyed by the lowercased
 * coach/VA first name (e.g. "sasha" → "strategic_coach", "neil" → "va"). Used
 * for the deterministic, high-confidence authority swap on NAMED transcripts.
 */
export async function loadRosterMap(): Promise<Map<string, string>> {
  const rows = await db.select({ name: coachesTable.name, type: coachesTable.type }).from(coachesTable);
  const map = new Map<string, string>();
  for (const r of rows) {
    const name = (r.name ?? "").trim().toLowerCase();
    if (name) map.set(name, r.type ?? "strategic_coach");
  }
  return map;
}

export interface RosterEntry {
  name: string;
  /** The coach's raw `coaches.type` (e.g. "strategic_coach", "va"). */
  type: string;
  /** The authority role that type maps to ("coach"/"va"), for the upload picker. */
  authorityRole: AuthorityRole;
}

/**
 * The live coach/VA roster as a display list for the upload dialog's authority
 * picker (Task #1560). Each entry carries the coach's name plus the authority
 * role its type maps to, so selecting a coach fixes both WHO and the role.
 */
export async function loadRosterList(): Promise<RosterEntry[]> {
  const rows = await db.select({ name: coachesTable.name, type: coachesTable.type }).from(coachesTable);
  return rows
    .map((r) => ({
      name: (r.name ?? "").trim(),
      type: r.type ?? "strategic_coach",
      authorityRole: authorityRoleFromCoachType(r.type),
    }))
    .filter((r) => r.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function containsWholeWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Scan raw transcript text for roster names. A name is only treated as a
 * deterministic authority when it appears as a SPEAKER LABEL — at the start of a
 * line, optionally prefixed with "Coach "/"VA ", followed by a label delimiter
 * (`:`/`-`). Names that appear only mid-sentence (inline mentions) are returned
 * separately as `inlineOnly` and must NOT drive a high-confidence swap: a coach
 * being talked *about* is not the same as the coach being the speaker.
 *
 * `labelMatched` is empty when the transcript uses numbered/unlabelled speakers,
 * in which case the AI inference path takes over.
 */
export function detectRosterAuthority(
  rawText: string,
  roster: ReadonlyMap<string, string>,
): {
  labelMatched: Array<{ name: string; role: AuthorityRole }>;
  inlineOnly: string[];
} {
  const labelMatched: Array<{ name: string; role: AuthorityRole }> = [];
  const inlineOnly: string[] = [];
  const seen = new Set<string>();
  for (const [name, type] of roster) {
    if (seen.has(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Speaker-label context: at a line start the name may use any delimiter
    // (":"/"-"/"–"), optionally prefixed with "Coach "/"VA ". MANY transcripts
    // are stored as a single newline-free line, so labels appear mid-text; there
    // we require the COLON delimiter (a strong speaker-label signal) preceded by
    // a word boundary, since a bare mid-sentence dash is too ambiguous. A plain
    // inline mention (no delimiter) is NOT promoted to deterministic authority.
    const lineStartRe = new RegExp(`(^|\\n)\\s*(coach\\s+|va\\s+)?${escaped}\\b\\s*[:\\-–]`, "i");
    const inlineColonRe = new RegExp(`(?:^|[^a-z])(?:coach\\s+|va\\s+)?${escaped}\\b\\s*:`, "i");
    if (lineStartRe.test(rawText) || inlineColonRe.test(rawText)) {
      labelMatched.push({ name, role: authorityRoleFromCoachType(type) });
      seen.add(name);
    } else if (containsWholeWord(rawText, name)) {
      inlineOnly.push(name);
      seen.add(name);
    }
  }
  return { labelMatched, inlineOnly };
}

// ───────────────────────────────────────────────────────────────────────────
// Glossary — canonical BTS product/process term names for spelling/normalising.
// ───────────────────────────────────────────────────────────────────────────

let GLOSSARY_TERMS_CACHE: string[] | null = null;

/**
 * Extract the canonical term names (first "Item" column) from the messy
 * markdown-table glossary so the AI can normalise BTS-specific product/process
 * names to their correct spelling. Cached per-process. Tolerant of the table's
 * trailing-empty-cell noise; filters out the header, URLs, and junk rows.
 */
export function loadGlossaryTerms(): string[] {
  if (GLOSSARY_TERMS_CACHE) return GLOSSARY_TERMS_CACHE;
  let raw = "";
  try {
    raw = readFileSync(join(__dirname, "..", "knowledge-base", "glossary.txt"), "utf8");
  } catch {
    GLOSSARY_TERMS_CACHE = [];
    return GLOSSARY_TERMS_CACHE;
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is the leading empty before the first pipe; the term is cells[1].
    const term = cells[1] ?? "";
    if (!term) continue;
    if (term === "Item" || /^-+$/.test(term)) continue; // header / separator
    if (term.length < 2 || term.length > 60) continue; // junk / paragraph spill
    if (/^https?:\/\//i.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  GLOSSARY_TERMS_CACHE = terms;
  return terms;
}

// ───────────────────────────────────────────────────────────────────────────
// Extra canonical-spelling references — BTS-ecosystem proper nouns that are NOT
// in the glossary but recur across calls, so the cleaner can auto-correct their
// spelling instead of flagging them: Media Mavens product names (live from the
// DB) and known traffic sources.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Native/ad traffic sources used across BTS campaigns. Supplied to the cleaner
 * as canonical spellings so mistranscriptions ("Catapiller") normalise to the
 * right form. Spelling references only — never used to invent content.
 */
const KNOWN_TRAFFIC_SOURCES = [
  "Caterpillar",
  "MediaGo",
  "LiveIntent",
  "Taboola",
  "Outbrain",
  "Revcontent",
  "NewsBreak",
  "Zemanta",
] as const;

let MEDIA_MAVENS_NAMES_CACHE: string[] | null = null;

/**
 * Load the live Media Mavens product names (e.g. "Barkchester") so the cleaner
 * normalises their spelling instead of flagging them as unknown terms. Cached
 * per-process; returns [] (never throws) if the table is unavailable.
 */
export async function loadMediaMavensProductNames(): Promise<string[]> {
  if (MEDIA_MAVENS_NAMES_CACHE) return MEDIA_MAVENS_NAMES_CACHE;
  try {
    const rows = await db
      .select({ name: mediaMavensProductsTable.name })
      .from(mediaMavensProductsTable);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const r of rows) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    MEDIA_MAVENS_NAMES_CACHE = names;
  } catch {
    MEDIA_MAVENS_NAMES_CACHE = [];
  }
  return MEDIA_MAVENS_NAMES_CACHE;
}

/**
 * Merge all canonical-spelling references — glossary terms, Media Mavens product
 * names, and known traffic sources — into one de-duplicated list the cleaner
 * normalises spelling toward.
 */
export async function loadCanonicalTerms(): Promise<string[]> {
  const glossary = loadGlossaryTerms();
  const products = await loadMediaMavensProductNames();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of [...glossary, ...products, ...KNOWN_TRAFFIC_SOURCES]) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// BTS HOUSE TERMS — the small, CLOSED, BTS-OWNED set of proprietary product /
// tool / app names (Task #1674). Because BTS owns this set and members do not
// coin brands that collide with it, a near-miss variant of one of THESE terms
// ("Flexi" for "Flexy") is safe to correct aggressively/deterministically — the
// exact opposite of a member's own niche proper noun, which we only tidy and
// never force onto a house spelling. This is the single source of truth for the
// aggressive normalisation pass AND the tiered LLM guidance below.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extra BTS house/product/app names that are house-owned but NOT tagged in the
 * glossary. Kept as an explicit, editable list so a new BTS app name is a
 * one-line addition. Empty today (the glossary covers the current tool set).
 */
const EXTRA_BTS_HOUSE_TERMS: readonly string[] = [];

let BTS_HOUSE_TERMS_CACHE: string[] | null = null;

/**
 * The closed BTS house-term set: every glossary row whose notes flag it as BTS
 * proprietary (e.g. DIYTrax, MetricMover, Flexy, PixelPress, NoEscape, CropBot,
 * ScrapeBot, Gifster, MediaMavens), plus {@link EXTRA_BTS_HOUSE_TERMS}. Derived
 * live from the glossary so it never drifts from a hardcoded duplicate. Cached
 * per-process; returns just the extras (never throws) if the glossary is absent.
 */
export function loadBtsHouseTerms(): string[] {
  if (BTS_HOUSE_TERMS_CACHE) return BTS_HOUSE_TERMS_CACHE;
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const term = t.trim();
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };
  let raw = "";
  try {
    raw = readFileSync(join(__dirname, "..", "knowledge-base", "glossary.txt"), "utf8");
  } catch {
    raw = "";
  }
  for (const line of raw.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const term = cells[1] ?? "";
    if (!term || term === "Item") continue;
    if (term.length < 3 || term.length > 40) continue;
    // The notes/definition cells carry the "BTS proprietary …" categorisation.
    const notes = cells.slice(2).join(" ").toLowerCase();
    if (!notes.includes("bts proprietary")) continue;
    add(term);
  }
  for (const t of EXTRA_BTS_HOUSE_TERMS) add(t);
  BTS_HOUSE_TERMS_CACHE = terms;
  return terms;
}

/**
 * Editable known-misspelling → canonical alias map (Task #1674). This is the
 * SELF-HEALING hook: when a new mistranscription of a BTS house term (or a known
 * traffic source) is discovered, add ONE line here and it is corrected on every
 * transcript from then on. Keys are matched case-insensitively as whole words
 * (multi-word keys are matched as a phrase). Seeded with the real observed
 * misses. Keep entries UNAMBIGUOUS — never add an ordinary English word/phrase
 * (e.g. "no escape") as a key, or it will clobber legitimate prose.
 */
export const BTS_TERM_ALIASES: Readonly<Record<string, string>> = {
  // Flexy — the tool that kept coming through as "Flexi".
  flexi: "Flexy",
  flexie: "Flexy",
  flexxy: "Flexy",
  flexey: "Flexy",
  // Caterpillar traffic source.
  catapiller: "Caterpillar",
  caterpiller: "Caterpillar",
  catterpillar: "Caterpillar",
  // Spaced/garbled forms of the camelCase tools (the LLM usually catches these;
  // this is the deterministic backstop). All are unambiguous product references.
  "diy trax": "DIYTrax",
  "diytrax": "DIYTrax",
  "metric mover": "MetricMover",
  "pixel press": "PixelPress",
  "crop bot": "CropBot",
  "scrape bot": "ScrapeBot",
  "media mavens": "MediaMavens",
};

/** Escape a string for use as a literal inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bounded Levenshtein edit distance between two (already-lowercased) strings. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Find the canonical BTS house term a single token corresponds to, or null when
 * it is not a house term. Two ways a token matches:
 *   1. Exact case-insensitive match to a house term → normalise CASE only (e.g.
 *      "flexy" → "Flexy"); returns null when already exact (no change).
 *   2. A safe near-miss: same first letter, and a small edit distance under a
 *      length-scaled threshold. To avoid clobbering ordinary English words, a
 *      short house term (<= 8 chars) only accepts an EQUAL-LENGTH substitution
 *      variant ("Flexi"→"Flexy", never "flex"→"Flexy"); a longer coined term
 *      allows one insertion/deletion as well.
 * Never near-misses house terms shorter than 5 chars (too ambiguous).
 */
function matchBtsHouseTerm(token: string, houseTerms: readonly string[]): string | null {
  const lower = token.toLowerCase();
  for (const term of houseTerms) {
    if (term.toLowerCase() === lower) return term === token ? null : term;
  }
  if (token.length < 4) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const term of houseTerms) {
    if (term.length < 5) continue;
    if (term[0].toLowerCase() !== token[0].toLowerCase()) continue;
    const threshold = term.length <= 8 ? 1 : 2;
    // Cap indels so a shorter ordinary word (a pure deletion) is never coerced:
    // threshold-1 terms accept substitutions only, threshold-2 accept one indel.
    if (Math.abs(token.length - term.length) > threshold - 1) continue;
    const dist = editDistance(lower, term.toLowerCase());
    if (dist >= 1 && dist <= threshold && dist < bestDist) {
      best = term;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Deterministic post-clean normalisation of BTS HOUSE terms only (Task #1674).
 * Runs after the LLM clean/refine so a near-miss the model left behind ("Flexi")
 * still comes out canonical ("Flexy"), with no admin instruction needed. Two
 * passes, both guarded hard against touching member-owned proper nouns:
 *   1. the explicit {@link BTS_TERM_ALIASES} map (whole-word/phrase, case-insensitive), then
 *   2. single-token near-miss correction against the CLOSED house-term set (see
 *      {@link matchBtsHouseTerm}).
 * Pure + idempotent: applying it twice yields the same result. Member terms,
 * ordinary English words, and already-canonical spellings are left untouched.
 */
export function normalizeBtsHouseTerms(text: string): string {
  if (!text) return text;
  const houseTerms = loadBtsHouseTerms();
  let out = text;

  // Pass 1 — explicit aliases (whole word / phrase, case-insensitive). Longest
  // keys first so a multi-word alias wins over any single-word overlap.
  const aliasKeys = Object.keys(BTS_TERM_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of aliasKeys) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
    out = out.replace(re, BTS_TERM_ALIASES[key]);
  }

  // Pass 2 — near-miss single tokens (camelCase tokens like "DIYTrex" included).
  if (houseTerms.length > 0) {
    out = out.replace(/[A-Za-z][A-Za-z0-9]*/g, (token) => matchBtsHouseTerm(token, houseTerms) ?? token);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Result shapes.
// ───────────────────────────────────────────────────────────────────────────

export interface CleanTranscriptResult {
  cleanedContent: string;
  authorityRole: AuthorityRole;
  authorityConfidence: "high" | "low";
  authorityEvidence: string;
  suggestedTitle: string;
  titleNeedsInput: boolean;
  flags: TranscriptCleanerFlag[];
}

export interface RefineTranscriptResult {
  cleanedContent: string;
  flags: TranscriptCleanerFlag[];
  authorityRole?: AuthorityRole;
  authorityConfidence?: "high" | "low";
  authorityEvidence?: string;
  assistantMessage: string;
}

const isAuthorityRole = (v: unknown): v is AuthorityRole =>
  typeof v === "string" && (AUTHORITY_ROLES as readonly string[]).includes(v);

/** Slice the outermost JSON object out of an AI response (tolerates ``` fences). */
function sliceJsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI response did not contain a JSON object");
  }
  return candidate.slice(start, end + 1);
}

/**
 * Repair the two escaping slips a model deterministically makes when it has to
 * embed a large, punctuation-rich value (a whole transcript, or a flag snippet
 * quoting garbled text) as a JSON string:
 *   1. unescaped inner double-quotes inside a string value, and
 *   2. raw control characters (newlines/tabs) inside a string value.
 * Walks the text as a small state machine. Inside a string, a `"` is treated as
 * the CLOSING quote only when the next non-whitespace char is a JSON structural
 * token (`,` `}` `]` `:`) or end-of-input; otherwise it is an inner quote and is
 * escaped. Raw control chars inside a string are escaped to their `\n`/`\t`/`\u`
 * forms. Structural whitespace and everything outside strings is passed through
 * untouched, so already-valid JSON is returned byte-for-byte unchanged.
 */
export function repairJsonStringLiterals(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const isStructuralNext = (from: number): boolean => {
    let j = from;
    while (j < input.length && (input[j] === " " || input[j] === "\t" || input[j] === "\n" || input[j] === "\r")) {
      j++;
    }
    const next = input[j];
    return next === undefined || next === "," || next === "}" || next === "]" || next === ":";
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (isStructuralNext(i + 1)) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Pull the first JSON object out of an AI text response. Tolerant of the LLM
 * slips we actually see: ``` fences (via {@link sliceJsonCandidate}), trailing
 * commas before a closing `}`/`]`, and — the deterministic failure on
 * punctuation-heavy content — unescaped inner double-quotes / control characters
 * inside a string value (via {@link repairJsonStringLiterals}). Plain valid JSON
 * parses on the FIRST try and is returned unchanged; the repair passes only run
 * after a strict parse fails, so successful replies are never altered.
 */
export function extractJson(text: string): any {
  const candidate = sliceJsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    // 1) Strip trailing commas (e.g. `"a": 1, }`) and retry.
    const noTrailingCommas = candidate.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(noTrailingCommas);
    } catch {
      // 2) Escape unescaped inner quotes + raw control chars, then retry. This
      //    is the recoverable "escaping slip" — distinct from a truncated reply.
      const repaired = repairJsonStringLiterals(noTrailingCommas).replace(/,(\s*[}\]])/g, "$1");
      return JSON.parse(repaired);
    }
  }
}

// The clean / full-refine replies return the large cleaned-transcript body
// OUTSIDE the JSON, between these markers, as PLAIN (unescaped) text. This
// removes the entire class of "unescaped quote/control char inside the big JSON
// string value" failure (Task #1616) rather than only repairing it: the body
// never has to survive JSON string-escaping. The compact metadata (authority,
// flags, title building blocks) still rides in JSON, where escaping slips are
// rare and covered by {@link extractJson}'s repair net.
const CLEANED_BODY_OPEN = "===BEGIN CLEANED TRANSCRIPT===";
const CLEANED_BODY_CLOSE = "===END CLEANED TRANSCRIPT===";

/**
 * Parse a clean / full-refine reply where the metadata is JSON and the cleaned
 * transcript body is a delimited PLAIN-TEXT block. Returns the parsed metadata
 * merged with the verbatim body under `cleanedTranscript`, matching the shape
 * the rest of the engine already consumes. The metadata JSON is read from the
 * regions OUTSIDE the body block (before and after it, joined) so the
 * transcript's own braces/quotes can never confuse the JSON slice. Falls back to
 * {@link extractJson} (body embedded as a JSON string, hardened repair applied)
 * when the markers are absent, so a reply that ignores the new format still
 * parses.
 */
export function parseCleanerReply(text: string): any {
  const open = text.indexOf(CLEANED_BODY_OPEN);
  const close = text.lastIndexOf(CLEANED_BODY_CLOSE);
  if (open !== -1 && close !== -1 && close > open + CLEANED_BODY_OPEN.length) {
    // Strip only the single newline that sits between each marker and the body
    // (the markers are on their own lines); the transcript's own interior
    // whitespace is preserved. Downstream trims per-chunk regardless.
    const body = text
      .slice(open + CLEANED_BODY_OPEN.length, close)
      .replace(/^\r?\n/, "")
      .replace(/\r?\n[ \t]*$/, "");
    const outside = `${text.slice(0, open)}\n${text.slice(close + CLEANED_BODY_CLOSE.length)}`;
    const meta = extractJson(outside);
    return { ...meta, cleanedTranscript: body };
  }
  return extractJson(text);
}

/** Classify a parse failure so the stored error message names the cause. */
function describeParseFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/did not contain a JSON object/i.test(msg)) {
    return "the reply contained no JSON object (no-JSON)";
  }
  return "the reply's JSON could not be parsed even after escaping-repair (likely an unescaped quote or control character in a string value)";
}

/**
 * Make one request to the model and parse the reply with `parse`, retrying the
 * whole call when parsing fails. The parse (and its {@link extractJson} repair
 * net) runs on EVERY attempt, so a deterministic escaping slip is recovered
 * on the first attempt rather than re-failing identically three times. A
 * truncated reply (stop_reason="max_tokens") is surfaced immediately with a
 * clear message instead of being retried, because it would just truncate again.
 * The final error names the cause (truncation vs. no-JSON vs. escaping) so a
 * stored failure is diagnosable from the message alone (Task #1616).
 */
async function requestCleanerCompletion<T>(
  args: { system: string; userMessage: string },
  parse: (text: string) => T,
): Promise<T> {
  const anthropic = getAnthropicClient();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: [{ role: "user", content: args.userMessage }],
    });
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "AI response hit the output token limit before completing — the transcript is too large to clean in a single pass (truncation).",
      );
    }
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    try {
      return parse(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `AI returned unparseable output after ${MAX_JSON_ATTEMPTS} attempts: ${describeParseFailure(lastError)}. Last parser error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** JSON-only reply path (e.g. the refine patch edits). */
async function requestCleanerJson(args: { system: string; userMessage: string }): Promise<any> {
  return requestCleanerCompletion(args, extractJson);
}

/** Clean / full-refine reply path: metadata JSON + delimited plain-text body. */
async function requestCleanerCompletionWithBody(args: { system: string; userMessage: string }): Promise<any> {
  return requestCleanerCompletion(args, parseCleanerReply);
}

function expectedSpeakers(folder: SourceFolder | null): string {
  switch (folder?.slug) {
    case "private_coaching":
      return "one authority (the coach) and one member";
    case "group_coaching":
      return "one authority (the coach) and several members";
    case "one_on_one_va":
      return "one authority (the VA) and one member";
    case "blitz_video":
    case "other_video":
      return "usually a single presenter/authority talking to camera";
    default:
      return "an unknown number of speakers — infer them from the content";
  }
}

function callTypeLabel(folder: SourceFolder | null): string {
  return folder?.label ?? "Transcript";
}

// ───────────────────────────────────────────────────────────────────────────
// Auto-naming — the type-specific title grammar (Task #1518).
//
//   {Call Type} — {Primary Subject} ({Authority})[ — {YYYY-MM-DD}]
//
// where the PRIMARY SUBJECT flips based on call type: the ISSUE TYPE for 1-on-1
// VA calls (the VA name in a leading parenthetical, member name never shown), a
// topic/module for videos/docs, and nothing (coach-only) for group/private
// coaching. The date is appended in ISO form ONLY when confidently determined —
// it is NEVER fabricated. The title is assembled deterministically here from the
// building blocks the model extracts; the model does NOT compose the final title.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Human title prefix per SOURCE_FOLDERS slug. Deliberately NOT the raw folder
 * label for two slugs: "Reference Docs" → "Reference", "Other Docs" → "Doc".
 */
const TITLE_PREFIX_BY_SLUG: Readonly<Record<string, string>> = {
  group_coaching: "Group Coaching",
  private_coaching: "Private Coaching",
  one_on_one_va: "1-on-1 VA",
  blitz_video: "Blitz Video",
  other_video: "Other Video",
  reference_docs: "Reference",
  other_docs: "Doc",
};

/** Slugs whose grammar appends the optional ISO date. */
const SLUGS_WITH_DATE: ReadonlySet<string> = new Set([
  "private_coaching",
  "one_on_one_va",
  "group_coaching",
  "other_video",
]);

/**
 * Slugs whose title is built around the ISSUE TYPE (subject) with the VA name in
 * a leading parenthetical. The member name never appears (Task #1675).
 */
const ISSUE_TYPE_SUBJECT_SLUGS: ReadonlySet<string> = new Set([
  "one_on_one_va",
]);

/**
 * Slugs assembled coach-only — the title carries the authority (coach/VA) and
 * never the member name. Group coaching has no per-member subject; private
 * coaching drops the member on purpose (Task #1667) to match that shape.
 */
const COACH_ONLY_SLUGS: ReadonlySet<string> = new Set([
  "group_coaching",
  "private_coaching",
]);

/**
 * Call-type slugs whose cleaned transcript MUST carry an explicit authority turn
 * label ("Coach"/"VA"). These are the coach/VA-led conversations; the post-clean
 * sanity check (Task #1560 req 8) flags a doc whose expected label never appears.
 * Video/document types have no such turn structure and are excluded.
 */
const SLUGS_WITH_AUTHORITY_LABEL: ReadonlySet<string> = new Set([
  "private_coaching",
  "one_on_one_va",
  "group_coaching",
]);

/**
 * True when the cleaned transcript uses the expected authority turn label as an
 * actual speaker label. Matches the label at a line start or after a newline,
 * followed by the usual turn delimiters (":", "-", or an em/en dash), so a mere
 * inline mention of the word "coach" does not count as an authority turn.
 */
function hasAuthorityLabel(cleaned: string, label: "Coach" | "VA"): boolean {
  const re = new RegExp(String.raw`(^|\n)\s*${label}\b\s*[:\-–—]`, "i");
  return re.test(cleaned);
}

const TITLE_PREFIXES: readonly string[] = Object.values(TITLE_PREFIX_BY_SLUG);

/**
 * Slug-aware structural validators — a title only "follows the grammar" when it
 * matches its call type's full shape, not merely a known prefix. This keeps the
 * backfill from treating a malformed/partial title (e.g. missing the required
 * `(Coach …)` authority on a 1-on-1) as compliant and then sticking with it.
 */
const ISO_DATE_TAIL = String.raw`(?: — \d{4}-\d{2}-\d{2})?`;
const TITLE_GRAMMAR_BY_SLUG: Readonly<Record<string, RegExp>> = {
  private_coaching: new RegExp(
    String.raw`^Private Coaching — (?:Coach|VA)(?: .+)?${ISO_DATE_TAIL}$`,
  ),
  one_on_one_va: new RegExp(
    // New shape (Task #1675): the VA name is a LEADING parenthetical (only when
    // known), the subject is the issue type, member name never appears. The
    // negative lookahead rejects the OLD trailing `(VA …)`/`(Coach …)` member
    // shape so the backfill recognises those as stale and rewrites them.
    String.raw`^1-on-1 VA(?: \(VA [^)]+\))? — (?!.*\((?:VA|Coach) )[^\n]+?${ISO_DATE_TAIL}$`,
  ),
  group_coaching: new RegExp(
    String.raw`^Group Coaching — (?:Coach|VA)(?: .+)?${ISO_DATE_TAIL}$`,
  ),
  blitz_video: /^Blitz Video — .+$/,
  other_video: new RegExp(String.raw`^Other Video — .+?${ISO_DATE_TAIL}$`),
  reference_docs: /^Reference — .+$/,
  other_docs: /^Doc — .+$/,
};

/**
 * The bare authority label for a role — "VA" for the VA pool, "Coach" for every
 * other role. This is the label the AI applies to the authority's turns and the
 * generic authority name used in a title when no personal name is available.
 */
function authorityLabel(role: AuthorityRole): "Coach" | "VA" {
  return role === "va" ? "VA" : "Coach";
}

/**
 * Render the authority as `Coach {First}` / `VA {First}` — first names only, per
 * the coach-name privacy convention. VA role → "VA", everything else → "Coach".
 * When no usable name is available, falls back to the bare label ("Coach"/"VA")
 * so a title is never left blank for want of a name (Task #1560 req 9).
 */
function renderAuthorityName(role: AuthorityRole, name: string | null | undefined): string {
  const label = authorityLabel(role);
  const first = (name ?? "").trim().split(/\s+/)[0];
  if (!first) return label;
  const display = first.charAt(0).toUpperCase() + first.slice(1);
  return `${label} ${display}`;
}

/**
 * Validate + normalise a candidate date to ISO `YYYY-MM-DD`. Accepts any string
 * containing an ISO date and returns it only when it is a REAL calendar date;
 * otherwise null. Never invents a date — a non-string or non-date is null.
 */
export function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Accept both the ISO `YYYY-MM-DD` and the slash `YYYY/MM/DD` shape (the latter
  // appears in the VA recording filenames), always normalising to dashes.
  const m = raw.trim().match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/**
 * First confidently-present date in free text (used by the backfill + filename
 * date extraction). Recognises both `YYYY-MM-DD` and `YYYY/MM/DD`, normalising
 * to ISO. Never fabricates — an impossible date returns null.
 */
function detectIsoDateInText(text: string): string | null {
  const m = text.match(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/);
  return m ? normalizeIsoDate(m[0]) : null;
}

/**
 * Reduce a source/original filename to a bare member name: drop duplicate-import
 * suffixes ("(1)"), trailing descriptors after a dash ("Donald Hayes - Mitolyn"
 * → "Donald Hayes"), and common meeting-export suffixes ("Adam Field Meeting
 * Information" → "Adam Field"). Used as the member fallback when the model does
 * not return one.
 */
export function memberNameFromSourceName(sourceName: string | null | undefined): string {
  if (!sourceName) return "";
  let s = sourceName.trim();
  s = s.replace(/\s*\(\d+\)\s*$/, "");
  s = s.replace(/\s*[-–—]\s+.*$/, "");
  s = s.replace(/\s+meeting\s+(information|notes|recording|recap)\s*$/i, "");
  s = s.replace(/\s+meeting\s*$/i, "");
  return s.trim();
}

/**
 * Parsed pieces of a 1-on-1 VA recording filename (Task #1675). The uploads
 * follow the shape:
 *
 *   {Member} - {Issue Type} - {YYYY/MM/DD HH:MM TZ} - Recording[.ext]
 *   e.g. "Stephanie Sharpe - Assistance Required - 2026/03/28 01:27 PST - Recording"
 *
 * We take the issue type from the SECOND ` - `-delimited segment (never the
 * member name in segment one) and the date from wherever a `YYYY/MM/DD` or
 * `YYYY-MM-DD` date appears. Anything that doesn't have a usable second segment
 * returns null, and each field is independently null when not confidently found.
 */
export interface VaTranscriptFilenameMeta {
  issueType: string | null;
  isoDate: string | null;
}

export function parseVaTranscriptFilename(
  filename: unknown,
): VaTranscriptFilenameMeta | null {
  if (typeof filename !== "string") return null;
  // Drop any leading directory path and a single trailing extension. NOTE: the
  // date itself uses `/` (YYYY/MM/DD), so we must NOT split on every slash — we
  // strip only path separators followed by a NON-digit (a real folder boundary),
  // which leaves the date's digit-flanked slashes intact.
  const base = filename.trim().replace(/^.*[/\\](?=\D)/, "").trim();
  if (!base) return null;
  const withoutExt = base.replace(/\.[A-Za-z0-9]+$/, "");
  // Split on a spaced dash (any dash style). Member names may contain hyphens
  // ("Mary-Jane"), but never a SPACE-dash-SPACE, so this delimiter is safe.
  const segments = withoutExt
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;

  // Issue type is the second segment — unless that segment is itself the date or
  // the trailing "Recording" marker (a filename with no real issue type).
  const rawIssue = segments[1];
  const isDateLike = detectIsoDateInText(rawIssue) !== null;
  const isRecordingMarker = /^recording$/i.test(rawIssue);
  const issueType = rawIssue && !isDateLike && !isRecordingMarker ? rawIssue : null;

  // Date can appear in any segment (normally the third); take the first match.
  let isoDate: string | null = null;
  for (const seg of segments) {
    const hit = detectIsoDateInText(seg);
    if (hit) {
      isoDate = hit;
      break;
    }
  }

  if (!issueType && !isoDate) return null;
  return { issueType, isoDate };
}

/** The subset of intake fields the VA filename autofill can populate. */
export interface VaAutofillFields {
  transcriptType?: string | null;
  sourceName?: string | null;
  providedSubject?: string | null;
  providedDate?: string | null;
}

/**
 * Auto-fill the intake Subject (issue type) and Date for a `one_on_one_va`
 * upload whose `sourceName` matches the VA recording convention. Mirrors the
 * Blitz caption autofill: each field is filled independently and ONLY when the
 * caller left it blank — an explicit Subject/Date is always respected. Applies
 * only to VA uploads; every other type (and non-matching names) is untouched.
 */
export function applyVaFilenameAutofill<T extends VaAutofillFields>(item: T): T {
  if (item.transcriptType !== "one_on_one_va") return item;
  const meta = parseVaTranscriptFilename(item.sourceName);
  if (!meta) return item;
  const hasSubject =
    typeof item.providedSubject === "string" && item.providedSubject.trim() !== "";
  const hasDate =
    typeof item.providedDate === "string" && item.providedDate.trim() !== "";
  return {
    ...item,
    providedSubject: hasSubject ? item.providedSubject : meta.issueType ?? item.providedSubject,
    providedDate: hasDate ? item.providedDate : meta.isoDate ?? item.providedDate,
  };
}

/**
 * True when a title already follows the new grammar. When the call-type `folder`
 * is known, the title must match that slug's full structure (e.g. a 1-on-1 title
 * must carry its `(Coach …)` authority); without a folder we fall back to a
 * known-prefix check.
 */
export function titleFollowsGrammar(
  title: string | null | undefined,
  folder?: SourceFolder | null,
): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  const slug = folder?.slug;
  const grammar = slug ? TITLE_GRAMMAR_BY_SLUG[slug] : undefined;
  if (grammar) return grammar.test(t);
  return TITLE_PREFIXES.some((p) => t.startsWith(`${p} — `));
}

export interface TranscriptTitleParts {
  folder: SourceFolder | null;
  authorityRole: AuthorityRole;
  /** Resolved coach/VA name (any case); first name is used in the title. */
  authorityName: string | null;
  /** Member name (1-on-1) or topic/module (video/doc); null for group coaching. */
  primarySubject: string | null;
  /** Source/original filename — member fallback for 1-on-1 types. */
  sourceName?: string | null;
  /** Confidently-determined ISO date, or null. */
  isoDate: string | null;
}

/**
 * Assemble the working title from the type-specific grammar. Returns
 * `titleNeedsInput: true` with an empty title when the REQUIRED primary subject
 * (issue type for 1-on-1 VA; coach for group/private coaching; topic for
 * video/doc) can't be determined — the admin then fills it in. The date is
 * appended only for the
 * slugs whose grammar carries one, and only when present (never fabricated).
 */
export function assembleTranscriptTitle(
  parts: TranscriptTitleParts,
): { title: string; titleNeedsInput: boolean } {
  const slug = parts.folder?.slug;
  const prefix = (slug && TITLE_PREFIX_BY_SLUG[slug]) ?? callTypeLabel(parts.folder);
  const datePart =
    parts.isoDate && slug && SLUGS_WITH_DATE.has(slug) ? ` — ${parts.isoDate}` : "";
  const blank = { title: "", titleNeedsInput: true };

  if (slug && ISSUE_TYPE_SUBJECT_SLUGS.has(slug)) {
    // 1-on-1 VA (Task #1675): the REQUIRED subject is the issue type; the member
    // name never appears. The VA name renders in a LEADING parenthetical only
    // when known — omitted entirely otherwise (never a bare "VA"). When the issue
    // type can't be determined, blank the title and flag it for the admin.
    const issueType = parts.primarySubject?.trim();
    if (!issueType) return blank;
    const first = (parts.authorityName ?? "").trim().split(/\s+/)[0];
    const namePart = first
      ? ` (VA ${first.charAt(0).toUpperCase() + first.slice(1)})`
      : "";
    return {
      title: `${prefix}${namePart} — ${issueType}${datePart}`,
      titleNeedsInput: false,
    };
  }

  if (slug && COACH_ONLY_SLUGS.has(slug)) {
    // Authority always renders (generic "Coach"/"VA" fallback), so a coach-only
    // title (group or private coaching) is always assemblable from the call type
    // alone — e.g. "Private Coaching — Coach Bruce — 2025-01-14".
    const authority = renderAuthorityName(parts.authorityRole, parts.authorityName);
    return { title: `${prefix} — ${authority}${datePart}`, titleNeedsInput: false };
  }

  // Video / document types (and untagged fallback): the subject is a topic/module.
  const topic = parts.primarySubject?.trim();
  if (!topic) return blank;
  return { title: `${prefix} — ${topic}${datePart}`, titleNeedsInput: false };
}

// ───────────────────────────────────────────────────────────────────────────
// Flag contract — the cleaner emits ONLY these two review-flag types. The model
// is instructed to stay within them, but it can drift (e.g. invent an
// "uncertain_term" flag for an unfamiliar proper noun) — and that invented
// flagging is exactly the noise we are suppressing. So we normalise every
// model-emitted flag to the allowlist and DROP anything that does not map.
// ───────────────────────────────────────────────────────────────────────────

const ALLOWED_FLAG_TYPES = ["garbled_content", "uncertain_authority"] as const;
type AllowedFlagType = (typeof ALLOWED_FLAG_TYPES)[number];

function normalizeFlagType(raw: unknown): AllowedFlagType | null {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("garbl")) return "garbled_content";
  if (t.includes("auth") || t.includes("attribut") || t.includes("speaker")) {
    return "uncertain_authority";
  }
  return null;
}

/**
 * Parse the model's `flags` array into the two-type contract: coerce near-miss
 * type names, drop off-contract/invented types (noise), and default the rest.
 */
export function mapModelFlags(rawFlags: unknown): TranscriptCleanerFlag[] {
  if (!Array.isArray(rawFlags)) return [];
  const out: TranscriptCleanerFlag[] = [];
  for (const f of rawFlags) {
    if (!f || typeof f !== "object") continue;
    const type = normalizeFlagType((f as any).type);
    if (!type) continue;
    out.push({
      type,
      text: (f as any).text ? String((f as any).text) : undefined,
      reason: String((f as any).reason ?? "Flagged for review"),
      confidence: (f as any).confidence ? String((f as any).confidence) : "low",
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Cleanup engine.
// ───────────────────────────────────────────────────────────────────────────

// Roster-driven "coaches & VAs by first name only" prompt guidance. Sourced
// from the SAME static roster arrays as coaching-roster.ts (COACHING_ROSTER +
// VA_ROSTER, which store first names), so the prompt list stays in lockstep with
// the roster and never drifts. This generalises the founder first-name rule to
// the whole staff and is the PRIMARY mechanism for VA surnames (they have no
// known surname for the deterministic scrub to key on). The scrub in
// content-privacy-filter.ts remains the deterministic backstop for coaches.
export const STAFF_FIRST_NAME_GUIDANCE = buildStaffFirstNameGuidance(
  [...COACHING_ROSTER, ...VA_ROSTER].map((s) => s.name),
);

/**
 * Tiered spelling guidance shared by the clean + both refine prompts (Task
 * #1674). It teaches the model the crucial distinction between the CLOSED,
 * BTS-owned house-term set (correct any near-miss aggressively, like a rebrand)
 * and a member's OWN niche proper nouns (tidy typos only, never force onto a
 * house spelling). Built from the live {@link loadBtsHouseTerms} list so it never
 * drifts. A deterministic post-clean pass ({@link normalizeBtsHouseTerms}) is the
 * backstop, but the model doing it first keeps the prose natural.
 */
export function buildBtsHouseTermGuidance(): string {
  const houseTerms = loadBtsHouseTerms();
  const list = houseTerms.length > 0 ? houseTerms.join(", ") : "(none configured)";
  return [
    "BTS HOUSE/PROPRIETARY terms are a small CLOSED set BTS owns — treat ANY",
    "phonetic / near-miss / garbled variant of one as a mistranscription and",
    "correct it to the EXACT canonical spelling, as aggressively as you rebrand",
    "old-program names (e.g. 'Flexi'/'Flexie'/'Flexxy' -> 'Flexy', 'Catapiller' ->",
    "'Caterpillar', 'DIY trax'/'Metric Mover' -> 'DIYTrax'/'MetricMover'). Do NOT",
    `flag these corrections. The house terms are: ${list}. This is the OPPOSITE of`,
    "a member's OWN niche proper nouns (their brands, products, campaigns, offers)",
    "— those are EXPECTED and legitimate: fix only an obvious typo, keep them",
    "consistent, and NEVER force a member term onto a house spelling or flag it.",
  ].join(" ");
}

export const BTS_HOUSE_TERM_GUIDANCE = buildBtsHouseTermGuidance();

const CLEAN_SYSTEM_PROMPT = [
  "You are a meticulous transcript-cleaning assistant for an affiliate-marketing",
  "coaching membership (BTS). You clean RAW call/video transcripts that come from",
  "many different transcription tools, so you must NOT assume any particular shape.",
  "",
  "PURPOSE — read carefully, it governs how aggressively you flag: the cleaned",
  "transcript becomes an 'AI source-knowledge' document that a SEPARATE downstream",
  "process later mines to build the live AI knowledge base. Your bar is therefore",
  "'good enough to mine for knowledge', NOT publication-perfect prose. Fix what you",
  "can and only flag what a human genuinely must resolve (see FLAGGING).",
  "",
  "Your job, returning STRICT JSON only:",
  "1. Reattribute mislabelled segments to the correct person while PRESERVING each",
  "   distinct speaker. Transcription tools often split one real person across two",
  "   labels (Speaker 3 / Speaker 4) or bleed one person's words into another's",
  "   label — merge/reassign those. Never invent or drop a real speaker. Merging",
  "   consecutive same-speaker labels is routine cleanup — just do it, never flag it.",
  "2. APPLY THE AUTHORITY the admin has already set for this call — it is GROUND",
  "   TRUTH, do NOT second-guess it. Every call has EXACTLY ONE source of",
  "   authority (a single Coach OR a single VA); the admin tells you which, and,",
  "   when known, their name. Your ONLY authority job is to decide WHICH turns are",
  "   theirs by CONVERSATIONAL ROLE — who teaches / answers / directs, as opposed",
  "   to the member(s) asking questions or describing their situation:",
  "   - Label EVERY authority turn with the exact authority label the admin gave",
  "     ('Coach' or 'VA') — the label only, never a personal name, never a number.",
  "   - Label EVERY other speaker simply 'Member' — never a number, never a name,",
  "     never their real name even if it is spoken.",
  "   - NAME-COLLISION GUARD: a member may say the authority's name (e.g. address",
  "     the coach by name, or be named the same). Never let a spoken name decide",
  "     who the authority is — go by who is teaching/answering vs asking. The",
  "     person the admin named is the ONE authority; do not crown anyone else.",
  "   Report your confidence + the evidence for the turn split.",
  "3. AUTO-CORRECT SPELLING — do this silently, do NOT flag it. There are TWO",
  "   tiers, and the difference matters:",
  `   - ${BTS_HOUSE_TERM_GUIDANCE}`,
  "   - Members operate in MANY different niches and constantly use their OWN brand,",
  "     product, campaign, offer and traffic-source names (e.g. 'Barkchester').",
  "     Unfamiliar proper nouns are EXPECTED and legitimate — fix obvious",
  "     mistranscriptions, pick the single most likely spelling, and use it",
  "     CONSISTENTLY throughout. NEVER flag a proper noun just because you don't",
  "     recognise it. Do not otherwise reword what people said (but SEE the",
  "     REBRAND exception below).",
  "   - Also normalise any term matching the supplied canonical list to its EXACT",
  "     canonical spelling.",
  "4. REBRAND OLD-PROGRAM REFERENCES — a DELIBERATE exception to the",
  "   'do not otherwise reword' rule above. Transcripts come from the old program",
  "   and still name the old brand and founder; convert these to BTS wording so",
  "   the mined knowledge is on-brand. Reword LIGHTLY so the sentence still flows",
  "   naturally — do NOT do a rigid word-for-word swap, and do NOT flag these:",
  ...OLD_BRAND_REBRAND_GUIDANCE.map((g) => `   - ${g}`),
  `   - ${STAFF_FIRST_NAME_GUIDANCE}`,
  "   Recognise obvious phonetic/garbled mistranscriptions of the old brand (e.g.",
  "   'the Cherring method', 'Charrington Media') and rebrand them too — never",
  "   leave them in and never flag them as unrecoverable garble.",
  "5. Strip useless cruft: standalone timestamps, transcription-tool artefacts,",
  "   excess blank space. Keep the actual dialogue intact.",
  "6. EXTRACT TITLE BUILDING BLOCKS — do NOT compose the final title yourself; it",
  "   is assembled downstream from these fields:",
  "   - primarySubject: this FLIPS by call type. For a 1-on-1 VA call it is the",
  "     ISSUE / TOPIC TYPE of the call — what the member needed help with (e.g.",
  "     'Assistance Required', 'Website Setup', 'Funnel Review') — recovered from",
  "     the source / original filename FIRST, then the transcript body. NEVER the",
  "     member's name. For a video or a document it is a concise topic / module",
  "     title (e.g. 'Reading DIYTrax Stats'). For a PRIVATE coaching or a",
  "     GROUP coaching call there is no single subject (the title is coach-only) —",
  "     return null. Return null whenever you genuinely cannot determine it.",
  "   - authority.detectedName: the coach/VA authority's name (first name is fine).",
  "     For a 1-on-1 VA call this is the VA's name — never the member's.",
  "   - detectedDate: the call/recording date as ISO 'YYYY-MM-DD', and ONLY when",
  "     you can confidently determine it from the content/source. Otherwise null.",
  "     NEVER invent, guess, or approximate a date. A missing date is NOT a flag.",
  "",
  "FLAGGING — flag SPARINGLY. Because the transcript only needs to be good enough",
  "to mine, raise a flag ONLY when a human must intervene, which means EXACTLY one",
  "of these two situations:",
  "   - 'garbled_content': a SUBSTANTIVE passage (real teaching/answer content) is",
  "     so garbled its meaning cannot be recovered. Ignore short filler, greetings,",
  "     back-channel ('yeah', 'I took it') and trivial utterances — never flag them.",
  "   - 'uncertain_authority': you genuinely cannot tell who the teaching authority",
  "     is, so the downstream could mis-weight the content.",
  "   Do NOT flag: unfamiliar proper nouns / brand / product / campaign / traffic",
  "   names, spelling you have already normalised, short or trivial utterances,",
  "   routine same-speaker merges, punctuation, formatting, or anything cosmetic.",
  "   When in doubt, DO NOT flag — fix it or leave it as-is.",
  "",
  "DEGRADE GRACEFULLY: if the transcript has no timestamps, no speaker names, only",
  "numbered/unlabelled speakers, or is a single undelimited block, clean what you",
  "can and flag only per the narrow FLAGGING rule above — do not error or fabricate",
  "structure.",
  "",
  "OUTPUT FORMAT — return your reply in TWO parts, in this exact order:",
  "PART A — a SINGLE strict JSON object with METADATA ONLY (do NOT put the",
  "  transcript in it): authority ({ label, confidence: 'high'|'low', evidence,",
  "  detectedName }), primarySubject (string|null), detectedDate (string|null,",
  "  ISO 'YYYY-MM-DD'), flags (array of { type:",
  "  'garbled_content'|'uncertain_authority', text, reason, confidence }).",
  "PART B — the FULL cleaned transcript as PLAIN TEXT, between these exact marker",
  "  lines (each marker on its own line). Write the transcript VERBATIM: do NOT",
  "  wrap it in JSON, do NOT escape quotes or newlines, do NOT add code fences:",
  `  ${CLEANED_BODY_OPEN}`,
  "  ...the entire cleaned transcript...",
  `  ${CLEANED_BODY_CLOSE}`,
  "Keeping the transcript OUTSIDE the JSON is REQUIRED — transcripts are rich in",
  "quotes, apostrophes and punctuation that corrupt a JSON string value.",
].join("\n");

/**
 * Split a raw transcript into sequential, size-bounded chunks for the clean
 * step. Returns the whole text as a single chunk when it is at/under the
 * threshold (the common case — the clean is then byte-for-byte the original
 * single pass). Above the threshold it slices on the cleanest available
 * boundary near each target offset (paragraph/newline > sentence end > word
 * space), so it works even when the entire transcript is one newline-free line
 * (the usual shape of the stored exports). Splitting is pure substring slicing:
 * chunks.join("") === text, so no dialogue is added, dropped, or reworded.
 */
export function splitTranscriptForCleaning(
  text: string,
  opts?: { threshold?: number; target?: number },
): string[] {
  // Guard the invariants that keep the slice loop progressing: a positive target
  // (so each cut advances) and a threshold no smaller than the target.
  const target = Math.max(1, opts?.target ?? CLEAN_CHUNK_TARGET_CHARS);
  const threshold = Math.max(target, opts?.threshold ?? CLEAN_CHUNK_CHAR_THRESHOLD);
  if (text.length <= threshold) return [text];

  // Pure substring slicing: every chunk is text.slice(pos, cut), so the chunks
  // always concatenate back to the original verbatim (chunks.join("") === text)
  // — no dialogue is added, dropped, or reworded. We pick each cut by scanning
  // backward from the target offset for the cleanest available boundary
  // (paragraph/newline > sentence end > word space), falling back to a hard cut
  // at the target only when the window has no boundary at all. This works even
  // when the whole transcript is a single newline-free line (common here).
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    if (text.length - pos <= target) {
      chunks.push(text.slice(pos));
      break;
    }
    const hardEnd = pos + target;
    // Never cut before the halfway mark, so chunks stay reasonably balanced.
    const windowStart = pos + Math.floor(target / 2);
    const window = text.slice(windowStart, hardEnd);
    const rel =
      lastBoundary(window, ["\n"]) ??
      lastBoundary(window, [". ", "? ", "! ", ".\n", "?\n", "!\n"]) ??
      lastBoundary(window, [" "]);
    const cut = rel != null ? windowStart + rel : hardEnd;
    chunks.push(text.slice(pos, cut));
    pos = cut;
  }
  return chunks;
}

/**
 * Index in `s` just AFTER the latest occurrence of any of `tokens`, or null when
 * none are present. Used to land a chunk cut immediately past a boundary so the
 * slices still concatenate to the original text.
 */
function lastBoundary(s: string, tokens: string[]): number | null {
  let best = -1;
  for (const tok of tokens) {
    const idx = s.lastIndexOf(tok);
    if (idx >= 0) best = Math.max(best, idx + tok.length);
  }
  return best >= 0 ? best : null;
}

/**
 * Drop exact-duplicate flags (same type + text + reason) produced when the
 * per-chunk flag lists are unioned. A single-pass clean almost never emits
 * duplicates, so this is effectively a no-op there.
 */
export function dedupeFlags(flags: TranscriptCleanerFlag[]): TranscriptCleanerFlag[] {
  const seen = new Set<string>();
  const out: TranscriptCleanerFlag[] = [];
  for (const f of flags) {
    const key = `${f.type}::${f.text ?? ""}::${f.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Build the per-chunk user message. For a single-chunk clean (chunkCount === 1)
 * the output is identical to the original single-pass prompt; for a multi-chunk
 * clean it adds the PART i/N framing and (for parts after the first) the
 * authority/label convention established by part 1, so speakers stay consistent
 * across the split.
 */
function buildCleanUserMessage(args: {
  chunkText: string;
  folder: SourceFolder | null;
  authorityLabel: "Coach" | "VA";
  providedAuthorityName: string | null;
  canonicalTerms: string[];
  sourceName?: string | null;
  proposedTitle?: string | null;
  chunkIndex: number;
  chunkCount: number;
}): string {
  const {
    chunkText,
    folder,
    authorityLabel: label,
    providedAuthorityName,
    canonicalTerms,
    sourceName,
    proposedTitle,
    chunkIndex,
    chunkCount,
  } = args;
  const multi = chunkCount > 1;
  const namePhrase = providedAuthorityName ? ` (${providedAuthorityName})` : "";
  const collisionRef = providedAuthorityName ? `${providedAuthorityName}'s` : "the authority's";
  const lines: (string | null)[] = [
    `Transcript type: ${folder ? folder.label : "(untagged — infer the call type)"}`,
    `Expected speakers: ${expectedSpeakers(folder)}`,
    sourceName ? `Source / original filename: ${sourceName}` : null,
    proposedTitle ? `An approved title already exists (do not override it): ${proposedTitle}` : null,
    // Admin-supplied authority is GROUND TRUTH for WHO/WHAT (Task #1560). Your
    // only authority job is to decide WHICH turns are theirs, by conversational
    // role, and to guard against the name-collision hazard.
    `AUTHORITY (set by an admin — this is ground truth, do NOT second-guess it): this call has EXACTLY ONE source of authority, the ${label}${namePhrase}. Label EVERY turn where that person is teaching / answering / directing as "${label}". Label EVERY other speaker simply "Member" — never a number, never a personal name. Decide who the ${label} is by CONVERSATIONAL ROLE (who teaches and answers vs who asks and describes their situation), NOT by whose name is spoken: a member may mention ${collisionRef} name, and that must NOT make them the ${label}.`,
    BTS_HOUSE_TERM_GUIDANCE,
    canonicalTerms.length > 0
      ? `Canonical BTS / Media Mavens / traffic-source terms — normalise spelling to these EXACT forms when referenced. Any OTHER proper noun is a member's own niche term: correct obvious typos, keep it consistent, and do NOT flag it. Terms: ${canonicalTerms.join(", ")}`
      : null,
    `REBRAND old-program references to BTS (deliberate exception to "do not reword"; reword lightly for natural flow, never flag these): ${OLD_BRAND_REBRAND_GUIDANCE.join(" ")}`,
    STAFF_FIRST_NAME_GUIDANCE,
  ];

  if (multi) {
    lines.push(
      "",
      `This transcript was split for size — you are cleaning PART ${chunkIndex + 1} of ${chunkCount}. Clean ONLY the text in this part and reproduce ALL of its dialogue; never summarise, drop, or merge turns across the split. Keep speaker labels consistent with the rest of the call.`,
    );
    if (chunkIndex > 0) {
      lines.push(
        `Use the SAME labelling here: the single authority is "${label}", everyone else is "Member" (no numbers, no names).`,
        "Title building blocks were already decided from part 1; you may return null for primarySubject / detectedDate and an empty authority object in this part.",
      );
    }
  }

  lines.push(
    "",
    multi ? `RAW TRANSCRIPT (PART ${chunkIndex + 1} of ${chunkCount}):` : "RAW TRANSCRIPT:",
    "<<<TRANSCRIPT",
    chunkText,
    "TRANSCRIPT",
    "",
    `Now return PART A (the JSON metadata) followed by PART B (the cleaned transcript between ${CLEANED_BODY_OPEN} and ${CLEANED_BODY_CLOSE}).`,
  );

  return lines.filter((l) => l !== null).join("\n");
}

export async function cleanTranscript(args: {
  rawText: string;
  transcriptType?: string | null;
  sourceName?: string | null;
  proposedTitle?: string | null;
  /** Admin-supplied ground truth captured at upload (Task #1560). */
  providedAuthorityRole?: string | null;
  providedAuthorityName?: string | null;
  providedSubject?: string | null;
  providedDate?: string | null;
}): Promise<CleanTranscriptResult> {
  const {
    rawText,
    transcriptType,
    sourceName,
    proposedTitle,
    providedAuthorityRole,
    providedAuthorityName,
    providedSubject,
    providedDate,
  } = args;
  const folder = resolveSourceFolder(transcriptType ?? null);
  const canonicalTerms = await loadCanonicalTerms();

  // Authority is the admin's call, not the AI's (Task #1560 req 3, 5, 7):
  //   - the ROLE is the admin-provided one, else the call type's default.
  //   - there is EXACTLY ONE authority; its label ("Coach"/"VA") drives the
  //     turn labelling and the title's generic fallback.
  // The AI never crowns the authority from a spoken roster name (req 6) — that
  // whole roster-matching path is gone; the admin decides WHO, the AI only
  // decides WHICH turns.
  const adminRoleGiven = isAuthorityRole(providedAuthorityRole);
  const authorityRole: AuthorityRole = adminRoleGiven
    ? (providedAuthorityRole as AuthorityRole)
    : folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
  const label = authorityLabel(authorityRole);
  const providedName = (providedAuthorityName ?? "").trim() || null;

  const chunks = splitTranscriptForCleaning(rawText);

  // Part 1 is cleaned first because it establishes the title building blocks and
  // the speaker-label convention the remaining parts must match. Given that
  // convention the remaining parts are independent, so they are cleaned in
  // parallel to keep wall-clock down on big files.
  const firstParsed = await requestCleanerCompletionWithBody({
    system: CLEAN_SYSTEM_PROMPT,
    userMessage: buildCleanUserMessage({
      chunkText: chunks[0],
      folder,
      authorityLabel: label,
      providedAuthorityName: providedName,
      canonicalTerms,
      sourceName,
      proposedTitle,
      chunkIndex: 0,
      chunkCount: chunks.length,
    }),
  });

  const restParsed = await Promise.all(
    chunks.slice(1).map((chunkText, i) =>
      requestCleanerCompletionWithBody({
        system: CLEAN_SYSTEM_PROMPT,
        userMessage: buildCleanUserMessage({
          chunkText,
          folder,
          authorityLabel: label,
          providedAuthorityName: providedName,
          canonicalTerms,
          sourceName,
          proposedTitle,
          chunkIndex: i + 1,
          chunkCount: chunks.length,
        }),
      }),
    ),
  );

  const allParsed = [firstParsed, ...restParsed];
  // Deterministic backstops applied to the assembled body:
  //  - normalizeBtsHouseTerms (Task #1674): correct any near-miss of a CLOSED
  //    BTS house term ("Flexi" -> "Flexy") the model left behind — the prompt's
  //    tiered guidance is primary, this guarantees the canonical spelling.
  //  - scrubPrivateContent (Task #1607): reduce any staff surname to a first name
  //    (and catch old-brand references / PII), even on the fallback path that
  //    reuses the raw chunk. The prompt's roster guidance is the primary mechanism.
  const cleanedContent = scrubPrivateContent(
    normalizeBtsHouseTerms(
      allParsed
        .map((p, i) => {
          // Fall back to the original chunk if the model returns an empty/whitespace
          // cleaned value — never silently drop a chunk's content.
          const cleaned = typeof p.cleanedTranscript === "string" ? p.cleanedTranscript.trim() : "";
          return cleaned.length > 0 ? cleaned : chunks[i].trim();
        })
        .filter((s) => s.length > 0)
        .join("\n\n"),
    ),
  );
  const flags = dedupeFlags(allParsed.flatMap((p) => mapModelFlags(p.flags)));

  const aiAuthority = firstParsed.authority ?? {};

  // Confidence: an admin who set the role (or picked a named coach/VA) is the
  // ground truth — high. When the role was only DEFAULTED from the call type,
  // defer to the AI's read of how clearly the roles separate.
  let authorityConfidence: "high" | "low" = adminRoleGiven || providedName
    ? "high"
    : aiAuthority.confidence === "high"
      ? "high"
      : "low";
  let authorityEvidence: string = providedName
    ? `Authority set by admin at upload: ${label} ${providedName}. AI labelled turns by conversational role.`
    : adminRoleGiven
      ? `Authority role set by admin at upload: ${label}. AI labelled turns by conversational role.`
      : `Authority role defaulted from call type (${folder?.label ?? "untagged"}); AI labelled turns by conversational role. ${String(aiAuthority.evidence ?? "")}`.trim();

  // Post-clean sanity check (req 8): for the call types that MUST carry an
  // explicit authority label, verify the expected label actually appears in the
  // cleaned output. If it doesn't, the AI failed to find any authority turn —
  // downgrade confidence and flag it for a human. Otherwise, when the role was
  // only defaulted and the AI itself was unsure, surface a single generic flag.
  const labelAbsent =
    folder != null &&
    SLUGS_WITH_AUTHORITY_LABEL.has(folder.slug) &&
    !hasAuthorityLabel(cleanedContent, label);
  if (labelAbsent) {
    authorityConfidence = "low";
    flags.push({
      type: "uncertain_authority",
      reason: `Expected the "${label}" authority label but it does not appear in the cleaned transcript — confirm which turns are the ${label}.`,
      confidence: "low",
    });
  } else if (authorityConfidence === "low") {
    flags.push({
      type: "uncertain_authority",
      reason: `Authority role was defaulted from the call type and the AI could not clearly separate the ${label} — confirm or override. ${authorityEvidence}`,
      confidence: "low",
    });
  }

  // Auto-naming (Task #1518 + #1560): assemble the title deterministically from
  // the building blocks. Every WHO/WHAT block prefers the admin-provided value,
  // then falls back to the AI's extraction:
  //   - authorityName: provided name, else the AI's detected name (never a
  //     roster crowning — req 6). A missing name is tolerated (generic label).
  //   - member/topic subject: provided subject, else the AI's primarySubject.
  //   - date: provided date, else a date in the filename, else the AI's date.
  const aiDetectedName =
    typeof aiAuthority.detectedName === "string" && aiAuthority.detectedName.trim()
      ? aiAuthority.detectedName.trim()
      : null;
  const authorityName = providedName ?? aiDetectedName;
  const primarySubject =
    (providedSubject ?? "").trim() ||
    (typeof firstParsed.primarySubject === "string" && firstParsed.primarySubject.trim()
      ? firstParsed.primarySubject.trim()
      : null);
  const isoDate =
    normalizeIsoDate(providedDate) ??
    detectIsoDateInText(sourceName ?? "") ??
    normalizeIsoDate(firstParsed.detectedDate);

  const { title: suggestedTitle, titleNeedsInput } = assembleTranscriptTitle({
    folder,
    authorityRole,
    authorityName,
    primarySubject,
    sourceName,
    isoDate,
  });

  return {
    cleanedContent,
    authorityRole,
    authorityConfidence,
    authorityEvidence,
    suggestedTitle,
    titleNeedsInput,
    flags,
  };
}

/**
 * Recover documents left mid-clean by a server restart. Cleaning runs in an
 * in-process background worker (see the clean-batch route), so a restart while a
 * clean is in flight would otherwise leave those rows stuck in `cleaning`
 * forever. Reset them back to `uploaded` so they reappear in intake and can be
 * re-cleaned. Idempotent: a no-op when nothing is stuck.
 */
export async function resetStuckCleaningDocs(): Promise<number> {
  const reset = await db
    .update(transcriptCleanerDocumentsTable)
    .set({ status: "uploaded", errorMessage: null })
    .where(eq(transcriptCleanerDocumentsTable.status, "cleaning"))
    .returning({ id: transcriptCleanerDocumentsTable.id });
  if (reset.length > 0) {
    console.log(`[TranscriptCleaner] Reset ${reset.length} stuck 'cleaning' doc(s) to 'uploaded' after restart`);
  }
  return reset.length;
}

/**
 * Re-title the cleaned-but-unfiled transcripts in the holding store to the new
 * grammar (Task #1518). A deterministic, idempotent data repair: it re-derives
 * each title from stored data (no AI call), so it is safe to run on every boot.
 *
 * - Only touches docs with status `cleaned` (skips `uploaded` — they pick up the
 *   new naming when cleaned — and `filed` — out of scope).
 * - Skips docs whose title already follows the grammar (so it's a no-op after the
 *   first run and never clobbers an admin-corrected / conforming title).
 * - Authority name is detected from the cleaned body via the roster; the member
 *   falls back to the cleaned source filename; the date is taken only when an
 *   explicit ISO date is present in the body (never fabricated).
 * - Never blanks an existing title: if assembly can't produce one, the doc is
 *   left untouched for the admin to handle.
 *
 * Returns the number of docs updated.
 */
export async function retitleCleanedHoldingDocs(): Promise<number> {
  const roster = await loadRosterMap();
  const docs = await db
    .select()
    .from(transcriptCleanerDocumentsTable)
    .where(eq(transcriptCleanerDocumentsTable.status, "cleaned"));

  let updated = 0;
  for (const doc of docs) {
    const folder = resolveSourceFolder(doc.transcriptType);
    if (titleFollowsGrammar(doc.title, folder)) continue;

    // Never clobber an admin-customized title. The admin title editor writes only
    // `title` (not suggestedTitle), so a non-empty title that matches NEITHER the
    // imported proposedTitle NOR the last auto-generated suggestedTitle was
    // hand-edited and must be preserved; an empty title is always safe to fill.
    const currentTitle = (doc.title ?? "").trim();
    const proposed = (doc.proposedTitle ?? "").trim();
    const suggested = (doc.suggestedTitle ?? "").trim();
    if (currentTitle && currentTitle !== proposed && currentTitle !== suggested) {
      continue;
    }

    // Admin-provided ground truth (Task #1560) wins over anything re-derived from
    // the body; only fall back to detection when a field was not supplied.
    const role: AuthorityRole = isAuthorityRole(doc.providedAuthorityRole)
      ? doc.providedAuthorityRole
      : isAuthorityRole(doc.authorityRole)
        ? doc.authorityRole
        : folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    // Raw originalContent retains real speaker labels (e.g. "Bruce:"); the cleaned
    // body is frequently anonymized to "Coach"/"Member N", so prefer the original
    // for roster/authority detection and fall back to cleaned only if absent.
    const authorityBody = doc.originalContent || doc.cleanedContent || "";
    const dateBody = doc.cleanedContent || doc.originalContent || "";
    const rosterHit = detectRosterAuthority(authorityBody, roster);
    const authorityName =
      (doc.providedAuthorityName ?? "").trim() || rosterHit.labelMatched[0]?.name || null;
    // For 1-on-1 VA the subject is the ISSUE TYPE (Task #1675): admin-provided
    // Subject wins, then the issue type parsed from the stored source filename.
    // When neither is recoverable the subject stays null and assembly blanks the
    // title, so the doc is left untouched below.
    const vaFilenameMeta =
      folder?.slug === "one_on_one_va" ? parseVaTranscriptFilename(doc.sourceName) : null;
    const primarySubject =
      (doc.providedSubject ?? "").trim() || vaFilenameMeta?.issueType || null;
    const isoDate =
      normalizeIsoDate(doc.providedDate) ??
      detectIsoDateInText(doc.sourceName ?? "") ??
      detectIsoDateInText(dateBody);

    const { title, titleNeedsInput } = assembleTranscriptTitle({
      folder,
      authorityRole: role,
      authorityName,
      primarySubject,
      sourceName: doc.sourceName,
      isoDate,
    });
    // Never blank out an existing title during a backfill; leave it for the admin.
    if (!title || title === doc.title) continue;

    await db
      .update(transcriptCleanerDocumentsTable)
      .set({ title, suggestedTitle: title, titleNeedsInput })
      .where(eq(transcriptCleanerDocumentsTable.id, doc.id));
    updated++;
  }
  return updated;
}

// ───────────────────────────────────────────────────────────────────────────
// Refinement chat.
// ───────────────────────────────────────────────────────────────────────────

// Fast path: the model returns a tiny set of literal find/replace edits instead
// of re-emitting the whole transcript. Output cost (the latency bottleneck) drops
// from "the entire document" to "a few snippets", so a one-line fix is near-instant.
const REFINE_PATCH_SYSTEM_PROMPT = [
  "You are refining an already-cleaned call transcript based on an admin's",
  "instruction (e.g. 'fix the garbled line', 'Speaker 4 from 12:30 on is the",
  "member', 'merge the two coach labels'). The admin is usually resolving a review",
  "flag, so the exact text to change is typically quoted in the open flags below.",
  "",
  "Return your change as a SMALL set of literal find/replace edits — NOT the whole",
  "transcript. Preserve every distinct speaker and the authority labelling",
  "convention: EXACTLY ONE authority ('Coach' or 'VA', label only), everyone else",
  "labelled 'Member' (no numbers, no names).",
  "",
  "ALSO REBRAND old-program references whenever you touch or notice them (do this",
  "automatically — the admin should NOT have to ask). Emit find/replace edits that",
  "rebrand company/program names to BTS (rewording lightly for natural flow) and",
  "reduce the founder's name to 'Adam' (first name only), including obvious",
  "phonetic/garbled variants:",
  ...OLD_BRAND_REBRAND_GUIDANCE.map((g) => `  - ${g}`),
  `  - ${STAFF_FIRST_NAME_GUIDANCE}`,
  "",
  "ALSO CORRECT BTS HOUSE TERMS whenever you touch or notice them (emit",
  "find/replace edits; do NOT flag):",
  `  - ${BTS_HOUSE_TERM_GUIDANCE}`,
  "",
  "Return STRICT JSON only with keys:",
  "- edits: array of { find, replace, all? }. `find` MUST be an EXACT, VERBATIM",
  "  substring copied character-for-character from the current transcript",
  "  (including punctuation and capitalisation), long enough to occur EXACTLY",
  "  ONCE — include surrounding words for uniqueness. `replace` is the replacement",
  '  text (use "" to delete). Set `all: true` ONLY when every occurrence of a',
  "  repeated label/string must change (e.g. relabelling a speaker); otherwise omit",
  "  it and target one unique span. Use [] only if no textual change is needed.",
  "- flags: the refreshed review flags AFTER your edit (array of { type:",
  "  'garbled_content'|'uncertain_authority', text, reason, confidence }). Drop any",
  "  flag your edit resolves. Flag SPARINGLY; never flag unfamiliar proper nouns /",
  "  brand / product / campaign / traffic names, already-normalised spelling,",
  "  short/trivial utterances, or cosmetic issues.",
  "- authority: OPTIONAL — include ONLY if the instruction changed the authority",
  `  mapping: { role: one of ${AUTHORITY_ROLES.join("/")}, confidence: 'high'|'low', evidence }.`,
  "- message: a one-sentence summary of what you changed.",
].join("\n");

// Fallback: full rewrite. Used when the find/replace edits can't be applied
// unambiguously (structural / multi-spot change, or a mis-copied anchor).
const REFINE_FULL_SYSTEM_PROMPT = [
  "You are refining an already-cleaned call transcript based on an admin's",
  "instruction (e.g. 'Speaker 4 from 12:30 on is the member', 'Speaker 2 is the",
  "authority', 'merge the two coach labels'). Apply the change faithfully while",
  "preserving every distinct speaker and the authority labelling convention:",
  "EXACTLY ONE authority ('Coach' or 'VA', label only), everyone else labelled",
  "'Member' (no numbers, no names).",
  "",
  "ALSO REBRAND old-program references automatically (the admin should NOT have to",
  "ask): rebrand company/program names to BTS, rewording lightly for natural flow,",
  "and reduce the founder's name to 'Adam' (first name only), including obvious",
  "phonetic/garbled variants:",
  ...OLD_BRAND_REBRAND_GUIDANCE.map((g) => `  - ${g}`),
  `  - ${STAFF_FIRST_NAME_GUIDANCE}`,
  "",
  "ALSO CORRECT BTS HOUSE TERMS automatically whenever you touch or notice them",
  "(do NOT flag):",
  `  - ${BTS_HOUSE_TERM_GUIDANCE}`,
  "",
  "OUTPUT FORMAT — return your reply in TWO parts, in this exact order:",
  "PART A — a SINGLE strict JSON object with METADATA ONLY (do NOT put the",
  "  transcript in it): flags (array of { type, text, reason, confidence } — the",
  "  refreshed review flags; flag SPARINGLY, only 'garbled_content' (a substantive",
  "  passage whose meaning cannot be recovered) or 'uncertain_authority'; never",
  "  flag unfamiliar proper nouns / brand / product / campaign / traffic names,",
  "  already-normalised spelling, short/trivial utterances, or cosmetic issues),",
  "  authority (OPTIONAL — include ONLY if the instruction changed the authority",
  `  mapping: { role: one of ${AUTHORITY_ROLES.join("/")}, confidence: 'high'|'low', evidence }),`,
  "  message (a one-sentence summary of what you changed).",
  "PART B — the FULL updated transcript as PLAIN TEXT, between these exact marker",
  "  lines (verbatim: no JSON, no escaping of quotes/newlines, no code fences):",
  `  ${CLEANED_BODY_OPEN}`,
  "  ...the entire updated transcript...",
  `  ${CLEANED_BODY_CLOSE}`,
].join("\n");

/**
 * Apply the model's literal find/replace edits to the current transcript.
 * An empty array is a valid no-op (the model judged no textual change is needed)
 * and returns the transcript unchanged — no full-rewrite fallback needed. Returns
 * `null` only when an edit can't be applied unambiguously — non-array input,
 * missing/empty fields, zero matches, or (for a non-`all` edit) more than one
 * match. A null return tells the caller to fall back to a full rewrite, so a
 * mis-copied anchor degrades to today's behaviour rather than corrupting or
 * mis-placing the edit. Matching is fully literal (split/join), so `$` sequences
 * in `replace` are never interpreted as patterns.
 */
export function applyRefineEdits(current: string, rawEdits: unknown): string | null {
  if (!Array.isArray(rawEdits)) return null;
  let working = current;
  for (const raw of rawEdits) {
    if (!raw || typeof raw !== "object") return null;
    const find = (raw as { find?: unknown }).find;
    const replace = (raw as { replace?: unknown }).replace;
    if (typeof find !== "string" || find.length === 0) return null;
    if (typeof replace !== "string") return null;
    const all = (raw as { all?: unknown }).all === true;
    const occurrences = working.split(find).length - 1;
    if (all ? occurrences < 1 : occurrences !== 1) return null;
    working = working.split(find).join(replace);
  }
  return working;
}

/** Build the shared refine result (flags + authority + message) for either path. */
function buildRefineResult(parsed: any, cleanedContent: string): RefineTranscriptResult {
  const result: RefineTranscriptResult = {
    // Deterministic backstops (Task #1674 + #1607): the refined body passes
    // through the same BTS house-term normalisation and coach-name scrub as the
    // initial clean, so a "Flexi" or a surname reintroduced by a refine edit is
    // still corrected/reduced.
    cleanedContent: scrubPrivateContent(normalizeBtsHouseTerms(cleanedContent)),
    flags: mapModelFlags(parsed.flags),
    assistantMessage: typeof parsed.message === "string" ? parsed.message : "Transcript updated.",
  };
  const aiAuthority = parsed.authority ?? null;
  if (aiAuthority && typeof aiAuthority === "object") {
    if (aiAuthority.confidence === "high" || aiAuthority.confidence === "low") {
      result.authorityConfidence = aiAuthority.confidence;
    }
    if (aiAuthority.evidence != null) {
      result.authorityEvidence = String(aiAuthority.evidence);
    }
    // The role lives under `authority.role` (the prompt's contract); accept a
    // legacy top-level `authorityRole` too so older response shapes still apply.
    if (isAuthorityRole(aiAuthority.role)) {
      result.authorityRole = aiAuthority.role;
    } else if (isAuthorityRole(parsed.authorityRole)) {
      result.authorityRole = parsed.authorityRole;
    }
  } else if (isAuthorityRole(parsed.authorityRole)) {
    result.authorityRole = parsed.authorityRole;
  }
  return result;
}

export async function refineTranscript(args: {
  currentCleaned: string;
  instruction: string;
  transcriptType?: string | null;
  chatHistory?: TranscriptCleanerChatTurn[];
  activeFlags?: TranscriptCleanerFlag[] | null;
}): Promise<RefineTranscriptResult> {
  const { currentCleaned, instruction, transcriptType, chatHistory, activeFlags } = args;
  const folder = resolveSourceFolder(transcriptType ?? null);

  const priorTurns = (chatHistory ?? [])
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Admin" : "Assistant"}: ${t.content}`)
    .join("\n");

  // The open flags carry the verbatim snippet they're complaining about — the
  // ideal find-anchor for the model, since refine is mostly flag resolution.
  const flagContext = (activeFlags ?? [])
    .filter((f): f is TranscriptCleanerFlag => !!f && typeof f.text === "string" && f.text.trim().length > 0)
    .map((f, i) => `${i + 1}. [${f.type}] "${f.text}"${f.reason ? ` — ${f.reason}` : ""}`)
    .join("\n");

  const sharedContext = [
    `Transcript type: ${folder ? folder.label : "(untagged)"}`,
    priorTurns ? `Earlier refinement conversation:\n${priorTurns}` : null,
    flagContext
      ? `Open review flags (the quoted text is verbatim from the transcript — use it as your find anchor):\n${flagContext}`
      : null,
    "",
    "CURRENT CLEANED TRANSCRIPT:",
    "<<<TRANSCRIPT",
    currentCleaned,
    "TRANSCRIPT",
    "",
    `Admin instruction: ${instruction}`,
  ].filter((l) => l !== null);

  // Fast path: request targeted find/replace edits and apply them locally.
  const patchParsed = await requestCleanerJson({
    system: REFINE_PATCH_SYSTEM_PROMPT,
    userMessage: [...sharedContext, "", "Return the strict JSON object with `edits` now."].join("\n"),
  });
  const patched = applyRefineEdits(currentCleaned, patchParsed.edits);
  if (patched !== null) {
    return buildRefineResult(patchParsed, patched.trim());
  }

  // Fallback: the edits couldn't be applied unambiguously (structural / multi-spot
  // change, or a mis-copied anchor) — regenerate the full transcript instead.
  const fullParsed = await requestCleanerCompletionWithBody({
    system: REFINE_FULL_SYSTEM_PROMPT,
    userMessage: [
      ...sharedContext,
      "",
      `Now return PART A (the JSON metadata) followed by PART B (the full updated transcript between ${CLEANED_BODY_OPEN} and ${CLEANED_BODY_CLOSE}).`,
    ].join("\n"),
  });
  const cleanedContent =
    typeof fullParsed.cleanedTranscript === "string" ? fullParsed.cleanedTranscript.trim() : currentCleaned;
  return buildRefineResult(fullParsed, cleanedContent);
}
