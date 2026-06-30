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
    // Speaker-label context ONLY: line start, optional "Coach "/"VA " prefix,
    // the name, then a label delimiter. Deliberately no whole-text fallback —
    // an inline mention must not be promoted to deterministic authority.
    const labelRe = new RegExp(`(^|\\n)\\s*(coach\\s+|va\\s+)?${escaped}\\b\\s*[:\\-–]`, "i");
    if (labelRe.test(rawText)) {
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
 * Pull the first JSON object out of an AI text response. Tolerant of two common
 * LLM slips: ``` fences (handled by {@link sliceJsonCandidate}) and trailing
 * commas before a closing `}`/`]`. Anything beyond that (a genuinely malformed
 * or truncated reply) throws, and the caller's retry loop re-requests a fresh
 * generation rather than guessing at a repair.
 */
function extractJson(text: string): any {
  const candidate = sliceJsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    // Strip trailing commas (e.g. `"a": 1, }`) and retry once.
    return JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
  }
}

/**
 * Make one structured-JSON request to the model and parse the reply, retrying
 * the whole call when the JSON comes back unparseable. The parse failure is
 * non-deterministic (an occasional escaping slip in an otherwise-fine reply), so
 * a fresh generation almost always succeeds. A truncated reply
 * (stop_reason="max_tokens") is surfaced immediately with a clear message
 * instead of being retried, because it would just truncate again.
 */
async function requestCleanerJson(args: { system: string; userMessage: string }): Promise<any> {
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
        "AI response hit the output token limit before completing — the transcript is too large to clean in a single pass.",
      );
    }
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    try {
      return extractJson(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `AI returned unparseable JSON after ${MAX_JSON_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
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
// where the PRIMARY SUBJECT flips based on call type: the member for 1-on-1
// calls, a topic/module for videos/docs, and nothing (coach-only) for group
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

/** Slugs whose primary subject is the MEMBER (the non-authority participant). */
const MEMBER_SUBJECT_SLUGS: ReadonlySet<string> = new Set([
  "private_coaching",
  "one_on_one_va",
]);

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
    String.raw`^Private Coaching — .+ \((?:Coach|VA) .+\)${ISO_DATE_TAIL}$`,
  ),
  one_on_one_va: new RegExp(
    String.raw`^1-on-1 VA — .+ \((?:Coach|VA) .+\)${ISO_DATE_TAIL}$`,
  ),
  group_coaching: new RegExp(
    String.raw`^Group Coaching — (?:Coach|VA) .+${ISO_DATE_TAIL}$`,
  ),
  blitz_video: /^Blitz Video — .+$/,
  other_video: new RegExp(String.raw`^Other Video — .+?${ISO_DATE_TAIL}$`),
  reference_docs: /^Reference — .+$/,
  other_docs: /^Doc — .+$/,
};

/**
 * Render the authority as `Coach {First}` / `VA {First}` — first names only, per
 * the coach-name privacy convention. VA role → "VA", everything else → "Coach".
 * Returns null when there is no usable name.
 */
function renderAuthorityName(role: AuthorityRole, name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  if (!first) return null;
  const display = first.charAt(0).toUpperCase() + first.slice(1);
  return `${role === "va" ? "VA" : "Coach"} ${display}`;
}

/**
 * Validate + normalise a candidate date to ISO `YYYY-MM-DD`. Accepts any string
 * containing an ISO date and returns it only when it is a REAL calendar date;
 * otherwise null. Never invents a date — a non-string or non-date is null.
 */
export function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/(\d{4})-(\d{2})-(\d{2})/);
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

/** First confidently-present ISO date in free text (used by the backfill). */
function detectIsoDateInText(text: string): string | null {
  const m = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
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
 * (member for 1-on-1 types; coach for group coaching; topic for video/doc) can't
 * be determined — the admin then fills it in. The date is appended only for the
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

  if (slug && MEMBER_SUBJECT_SLUGS.has(slug)) {
    const member =
      parts.primarySubject?.trim() || memberNameFromSourceName(parts.sourceName);
    const authority = renderAuthorityName(parts.authorityRole, parts.authorityName);
    // The 1-on-1 grammar REQUIRES both the member and the authority — e.g.
    // "Private Coaching — {Member} (Coach {First})". If either is unrecoverable,
    // blank the title and flag it; never emit a partial, authority-less title.
    if (!member || !authority) return blank;
    return { title: `${prefix} — ${member} (${authority})${datePart}`, titleNeedsInput: false };
  }

  if (slug === "group_coaching") {
    const authority = renderAuthorityName(parts.authorityRole, parts.authorityName);
    if (!authority) return blank;
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
  "2. Identify the SOURCE OF AUTHORITY — the coach/VA doing the teaching/answering/",
  "   directing, as opposed to the member(s) asking questions or describing their",
  "   situation. Label that speaker with their authority role title (e.g. 'Coach'",
  "   or 'VA'), not a personal name. Label the others 'Member 1', 'Member 2', etc.",
  "   When speakers are only numbered, infer the authority PURELY from",
  "   conversational role (who teaches/answers vs who asks). No knowledge of BTS",
  "   training concepts is needed; the teacher/answerer pattern is the signal and",
  "   may only resolve by mid-call. Report your confidence + the evidence.",
  "3. AUTO-CORRECT SPELLING — do this silently, do NOT flag it:",
  "   - Normalise any term that matches the supplied canonical list to its EXACT",
  "     canonical spelling (e.g. 'DIY trax' -> 'DIYTrax').",
  "   - Members operate in MANY different niches and constantly use their OWN brand,",
  "     product, campaign, offer and traffic-source names (e.g. 'Barkchester',",
  "     'Caterpillar'). Unfamiliar proper nouns are EXPECTED and legitimate — fix",
  "     obvious mistranscriptions, pick the single most likely spelling, and use it",
  "     CONSISTENTLY throughout. NEVER flag a proper noun just because you don't",
  "     recognise it. Do not otherwise reword what people said.",
  "4. Strip useless cruft: standalone timestamps, transcription-tool artefacts,",
  "   excess blank space. Keep the actual dialogue intact.",
  "5. EXTRACT TITLE BUILDING BLOCKS — do NOT compose the final title yourself; it",
  "   is assembled downstream from these fields:",
  "   - primarySubject: this FLIPS by call type. For a 1-on-1 call (private",
  "     coaching or 1-on-1 VA) it is the MEMBER's real name — the non-authority",
  "     participant — recovered from the source / original filename FIRST, then the",
  "     transcript body; use their real name, never 'Member 1'. For a video or a",
  "     document it is a concise topic / module title (e.g. 'Reading DIYTrax",
  "     Stats'). For a GROUP coaching call there is no single subject — return",
  "     null. Return null whenever you genuinely cannot determine it.",
  "   - authority.detectedName: the coach/VA authority's name (first name is fine).",
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
  "Return ONLY a JSON object with keys: cleanedTranscript (string), authority",
  "({ label, confidence: 'high'|'low', evidence, detectedName }), primarySubject",
  "(string|null), detectedDate (string|null, ISO 'YYYY-MM-DD'), flags (array of",
  "{ type: 'garbled_content'|'uncertain_authority', text, reason, confidence }).",
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
  rosterHit: ReturnType<typeof detectRosterAuthority>;
  canonicalTerms: string[];
  sourceName?: string | null;
  proposedTitle?: string | null;
  chunkIndex: number;
  chunkCount: number;
  authorityHint: string | null;
}): string {
  const {
    chunkText,
    folder,
    rosterHit,
    canonicalTerms,
    sourceName,
    proposedTitle,
    chunkIndex,
    chunkCount,
    authorityHint,
  } = args;
  const multi = chunkCount > 1;
  const lines: (string | null)[] = [
    `Transcript type: ${folder ? folder.label : "(untagged — infer the call type)"}`,
    `Expected speakers: ${expectedSpeakers(folder)}`,
    sourceName ? `Source / original filename: ${sourceName}` : null,
    proposedTitle ? `An approved title already exists (do not override it): ${proposedTitle}` : null,
    rosterHit.labelMatched.length > 0
      ? `Known roster names present as SPEAKER LABELS (treat the matching speaker as the AUTHORITY, high confidence): ${rosterHit.labelMatched.map((m) => m.name).join(", ")}`
      : rosterHit.inlineOnly.length > 0
        ? `Roster names mentioned inline but NOT as speaker labels: ${rosterHit.inlineOnly.join(", ")}. Do NOT assume these people are the authority — they may just be talked about. Infer the authority from conversational role and report your confidence.`
        : "No known roster names detected — infer the authority from conversational role and report your confidence.",
    canonicalTerms.length > 0
      ? `Canonical BTS / Media Mavens / traffic-source terms — normalise spelling to these EXACT forms when referenced. Any OTHER proper noun is a member's own niche term: correct obvious typos, keep it consistent, and do NOT flag it. Terms: ${canonicalTerms.join(", ")}`
      : null,
  ];

  if (multi) {
    lines.push(
      "",
      `This transcript was split for size — you are cleaning PART ${chunkIndex + 1} of ${chunkCount}. Clean ONLY the text in this part and reproduce ALL of its dialogue; never summarise, drop, or merge turns across the split. Keep speaker labels consistent with the rest of the call.`,
    );
    if (chunkIndex > 0) {
      lines.push(
        authorityHint
          ? `The teaching authority for this call was already identified in part 1 as "${authorityHint}". Use that SAME label for them here, and label members consistently (Member 1, Member 2, ...).`
          : "The teaching authority was already identified in part 1 — reuse the same authority/member labelling here.",
        "Title building blocks and authority were already decided from part 1; you may return null for primarySubject / detectedDate and an empty authority object in this part.",
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
    "Return the strict JSON object now.",
  );

  return lines.filter((l) => l !== null).join("\n");
}

export async function cleanTranscript(args: {
  rawText: string;
  transcriptType?: string | null;
  sourceName?: string | null;
  proposedTitle?: string | null;
  roster: ReadonlyMap<string, string>;
}): Promise<CleanTranscriptResult> {
  const { rawText, transcriptType, sourceName, proposedTitle, roster } = args;
  const folder = resolveSourceFolder(transcriptType ?? null);
  const rosterHit = detectRosterAuthority(rawText, roster);
  const canonicalTerms = await loadCanonicalTerms();

  const chunks = splitTranscriptForCleaning(rawText);

  // Part 1 is cleaned first because it establishes the title, the AI authority
  // inference, and the speaker-label convention the remaining parts must match.
  // Given that convention the remaining parts are independent of each other, so
  // they are cleaned in parallel to keep wall-clock down on big files.
  const firstParsed = await requestCleanerJson({
    system: CLEAN_SYSTEM_PROMPT,
    userMessage: buildCleanUserMessage({
      chunkText: chunks[0],
      folder,
      rosterHit,
      canonicalTerms,
      sourceName,
      proposedTitle,
      chunkIndex: 0,
      chunkCount: chunks.length,
      authorityHint: null,
    }),
  });
  const authorityHint =
    firstParsed.authority &&
    typeof firstParsed.authority.label === "string" &&
    firstParsed.authority.label.trim()
      ? firstParsed.authority.label.trim()
      : null;

  const restParsed = await Promise.all(
    chunks.slice(1).map((chunkText, i) =>
      requestCleanerJson({
        system: CLEAN_SYSTEM_PROMPT,
        userMessage: buildCleanUserMessage({
          chunkText,
          folder,
          rosterHit,
          canonicalTerms,
          sourceName,
          proposedTitle,
          chunkIndex: i + 1,
          chunkCount: chunks.length,
          authorityHint,
        }),
      }),
    ),
  );

  const allParsed = [firstParsed, ...restParsed];
  const cleanedContent = allParsed
    .map((p, i) => {
      // Fall back to the original chunk if the model returns an empty/whitespace
      // cleaned value — never silently drop a chunk's content.
      const cleaned = typeof p.cleanedTranscript === "string" ? p.cleanedTranscript.trim() : "";
      return cleaned.length > 0 ? cleaned : chunks[i].trim();
    })
    .filter((s) => s.length > 0)
    .join("\n\n");
  const flags = dedupeFlags(allParsed.flatMap((p) => mapModelFlags(p.flags)));

  // Authority resolution. A deterministic, high-confidence swap is only safe
  // when the roster names that appear as SPEAKER LABELS resolve to a single,
  // unambiguous authority role:
  //   - exactly one distinct role among label matches → deterministic + high.
  //   - several label matches with CONFLICTING roles → ambiguous: fall back to
  //     the folder default but flag it low-confidence for manual confirmation
  //     (never silently auto-pick the first match).
  //   - no label matches → AI inference, default the role from the folder.
  let authorityRole: AuthorityRole;
  let authorityConfidence: "high" | "low";
  let authorityEvidence: string;
  const aiAuthority = firstParsed.authority ?? {};
  const labelRoles = Array.from(new Set(rosterHit.labelMatched.map((m) => m.role)));
  if (labelRoles.length === 1) {
    authorityRole = labelRoles[0];
    authorityConfidence = "high";
    const names = rosterHit.labelMatched.map((m) => m.name).join(", ");
    authorityEvidence = `Matched live roster name(s) "${names}" as speaker label(s) — deterministic authority swap.`;
  } else if (labelRoles.length > 1) {
    authorityRole = folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    authorityConfidence = "low";
    const detail = rosterHit.labelMatched.map((m) => `${m.name}=${m.role}`).join(", ");
    authorityEvidence = `Multiple roster names with different authority roles appear as speaker labels (${detail}) — cannot deterministically pick one; confirm or override.`;
  } else {
    authorityRole = folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    authorityConfidence = aiAuthority.confidence === "high" ? "high" : "low";
    authorityEvidence = String(aiAuthority.evidence ?? "Authority inferred from conversational role.");
  }

  if (authorityConfidence === "low") {
    flags.push({
      type: "uncertain_authority",
      reason: `Authority mapping is low-confidence — confirm or override. ${authorityEvidence}`,
      confidence: "low",
    });
  }

  // Auto-naming (Task #1518): assemble the title deterministically from the
  // building blocks the model extracted, picking the grammar by call type. The
  // authority name prefers a deterministic roster label match, then the model's
  // detected name. The member (1-on-1 types) prefers the model's primary subject,
  // then a cleaned source filename. The date is appended only when present.
  const rosterAuthorityName = rosterHit.labelMatched[0]?.name ?? null;
  const aiDetectedName =
    typeof aiAuthority.detectedName === "string" && aiAuthority.detectedName.trim()
      ? aiAuthority.detectedName.trim()
      : null;
  const authorityName = rosterAuthorityName ?? aiDetectedName;
  const primarySubject =
    typeof firstParsed.primarySubject === "string" && firstParsed.primarySubject.trim()
      ? firstParsed.primarySubject.trim()
      : null;
  const isoDate = normalizeIsoDate(firstParsed.detectedDate);

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

    const role: AuthorityRole = isAuthorityRole(doc.authorityRole)
      ? doc.authorityRole
      : folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    // Raw originalContent retains real speaker labels (e.g. "Bruce:"); the cleaned
    // body is frequently anonymized to "Coach"/"Member N", so prefer the original
    // for roster/authority detection and fall back to cleaned only if absent.
    const authorityBody = doc.originalContent || doc.cleanedContent || "";
    const dateBody = doc.cleanedContent || doc.originalContent || "";
    const rosterHit = detectRosterAuthority(authorityBody, roster);

    const { title, titleNeedsInput } = assembleTranscriptTitle({
      folder,
      authorityRole: role,
      authorityName: rosterHit.labelMatched[0]?.name ?? null,
      primarySubject: null,
      sourceName: doc.sourceName,
      isoDate: detectIsoDateInText(dateBody),
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
  "convention (authority role title vs Member N).",
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
  "preserving every distinct speaker and the authority labelling convention",
  "(authority role title vs Member N).",
  "",
  "Return STRICT JSON only with keys: cleanedTranscript (string, the full updated",
  "transcript), flags (array of { type, text, reason, confidence } — the refreshed",
  "review flags; flag SPARINGLY, only 'garbled_content' (a substantive passage",
  "whose meaning cannot be recovered) or 'uncertain_authority'; never flag",
  "unfamiliar proper nouns / brand / product / campaign / traffic names,",
  "already-normalised spelling, short/trivial utterances, or cosmetic issues),",
  "authority (OPTIONAL — include ONLY if the instruction changed the",
  `authority mapping: { role: one of ${AUTHORITY_ROLES.join("/")}, confidence:`,
  "'high'|'low', evidence }), message (a one-sentence summary of what you changed).",
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
    cleanedContent,
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
  const fullParsed = await requestCleanerJson({
    system: REFINE_FULL_SYSTEM_PROMPT,
    userMessage: [...sharedContext, "", "Return the strict JSON object now."].join("\n"),
  });
  const cleanedContent =
    typeof fullParsed.cleanedTranscript === "string" ? fullParsed.cleanedTranscript.trim() : currentCleaned;
  return buildRefineResult(fullParsed, cleanedContent);
}
