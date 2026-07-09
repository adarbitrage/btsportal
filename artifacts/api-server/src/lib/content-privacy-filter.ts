/**
 * Knowledge-base content privacy filter.
 *
 * Centralized scrubbing applied to EVERY piece of content that enters the AI
 * assistant knowledge base (knowledgebase_docs) — seed ingestion, admin manual
 * create/edit, and staging "push to live" — AND at answer-retrieval time on
 * every AI surface (chat RAG, voice KB search, 800-number KB search) so that
 * PII which predates a rule or entered through any bypassed path can never
 * reach a model or caller.
 *
 * HOW TO FORBID AN ADDITIONAL NAME:
 *   Add a rule to PRIVACY_RULES below in the "ADD NEW FORBIDDEN NAMES HERE"
 *   section. Rules run top-to-bottom, so put the most specific (multi-word)
 *   phrase BEFORE the bare surname so the longer match wins.
 *   - To remove a name entirely:        replacement: ""
 *   - To replace with a neutral term:    replacement: "the instructor"
 *
 * NOTE: This intentionally does NOT touch account-access data (user logins,
 * agency API config). It only sanitizes free-text knowledge-base content.
 */

import { VA_ROSTER } from "./coaching-roster";

export interface PrivacyRule {
  /** Must include the global flag so all occurrences are replaced. */
  pattern: RegExp;
  replacement: string;
}

/** Escape a literal string for safe embedding in a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the deterministic first-name-only scrub rules for a staff roster whose
 * surnames ARE known — the reusable generalisation of the hand-written coach
 * rules in PRIVACY_RULES below. For each staff member that carries a surname it
 * emits, in order:
 *   1. a full-name rule  "First Surname" -> "First"  (whitespace-tolerant), then
 *   2. an orphaned-surname strip  "Surname" -> ""     (for chunk-split leftovers).
 * The full-name rule is emitted BEFORE the orphan strip so the longer match wins.
 * Staff with no surname produce no rules (the LLM prompt guidance is their only
 * protection until a surname is recorded). Both first name and surname are regex-
 * escaped, so a name with special characters can never break the pattern.
 */
export function buildStaffSurnameRules(
  staff: ReadonlyArray<{ name: string; surname?: string | null }>,
): PrivacyRule[] {
  const rules: PrivacyRule[] = [];
  for (const person of staff) {
    const first = person.name?.trim();
    const surname = person.surname?.trim();
    if (!first || !surname) continue;
    const firstPat = escapeRegExp(first);
    const surnamePat = escapeRegExp(surname);
    rules.push({
      pattern: new RegExp(`${firstPat}\\s+${surnamePat}`, "gi"),
      replacement: first,
    });
    rules.push({
      pattern: new RegExp(`\\b${surnamePat}\\b`, "gi"),
      replacement: "",
    });
  }
  return rules;
}

/**
 * OLD-PROGRAM / OLD-BRAND REBRAND VOCABULARY — single source of truth.
 *
 * Transcripts from the old program still reference the old brand ("Cherrington
 * Media", "TCE", "The Cherrington Experience"), the founder ("Adam Cherrington")
 * and garbled/phonetic mistranscriptions of these (e.g. "the Cherring method").
 * As part of the portal rebrand these are converted to BTS wording so the mined
 * AI source-knowledge is on-brand.
 *
 * Policy (confirmed with the user):
 *   - Company / program references (Cherrington Media, TCE, The Cherrington
 *     Experience, and garbled/phonetic variants such as "the Cherring method")
 *     -> rebrand to "BTS".
 *   - The founder's personal name "Adam Cherrington" (and misspellings like
 *     "Adam Charrington") -> reduce to just "Adam" (keep the first name, drop
 *     the surname) — consistent with the first-name-only privacy convention.
 *
 * This constant feeds BOTH the transcript-cleaner prompts (clean + refine) and
 * the retrieval-time privacy rules below, so the two stay in lockstep. The
 * cleaner rewords lightly for natural flow; the privacy filter is the blunt
 * safety net for anything the cleaner missed (including the misspellings).
 */
export const OLD_BRAND_REBRAND_GUIDANCE: string[] = [
  'Company / program names — "Cherrington Media", "TCE", "The Cherrington Experience", and obvious phonetic or garbled mistranscriptions of these (e.g. "the Cherring method", "Charrington Media", "the Cherrington program") -> rebrand to "BTS", rewording lightly so the sentence still flows naturally rather than a rigid word-for-word swap.',
  'The founder\'s personal name — "Adam Cherrington" (and misspellings like "Adam Charrington") -> reduce to just "Adam" (keep the first name, drop the surname).',
  'The flagship program\'s old day-count name — "21 Day Blitz" (and variants like "21-day Blitz", "21day Blitz") -> the current name "the Blitz" (never "the the Blitz"). EXCEPTION: the external YSE product is really named "YSE 21-Day Blitz" — leave any "YSE 21-Day Blitz" product reference untouched.',
];

/**
 * OLD-BRAND REPLACEMENT patterns — the founder's name -> "Adam" and every
 * company / program reference (including phonetic/garbled variants) -> "BTS".
 * Ordered specific -> general so the longest match wins. Aligned with
 * OLD_BRAND_REBRAND_GUIDANCE (single source above).
 */
const OLD_BRAND_REPLACEMENT_RULES: PrivacyRule[] = [
  { pattern: /\bAdam\s+Ch[ae]rrington\b/gi, replacement: "Adam" },
  { pattern: /\b(?:The\s+)?Ch[ae]rrington\s+Experience\b/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rrington ?Media Support/gi, replacement: "BTS Support" },
  { pattern: /Ch[ae]rringtonmedia/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rringtong? ?Media/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rrington Mentees/gi, replacement: "BTS members" },
  { pattern: /Ch[ae]rrington Support/gi, replacement: "BTS Support" },
  // Garbled/phonetic variant of the program name (e.g. "the Cherring method").
  { pattern: /\bCh[ae]rring\s+method\b/gi, replacement: "BTS" },
  // Old program acronym (always uppercase in the wild).
  { pattern: /\bTCE\b/g, replacement: "BTS" },
  // Bare surname / -ton(g) variants -> BTS.
  { pattern: /\bCh[ae]rringtong?\b/gi, replacement: "BTS" },
  // Old day-count program name -> "the Blitz". "the 21 Day Blitz" collapses in
  // one pass (no "the the" artifact); the bare form gains a leading "the".
  // Negative lookbehind protects the REAL external product name
  // "YSE 21-Day Blitz" (see kb-legacy-crosswalk + yse product catalog).
  // Identifiers like yse_21_day_blitz never match (underscores break \b21[-\s]?day\s).
  { pattern: /\b(the)\s+21[-\s]?day\s+blitz\b/gi, replacement: "$1 Blitz" },
  { pattern: /(?<!YSE[-\s])\b21[-\s]?day\s+blitz\b/gi, replacement: "the Blitz" },
];

/**
 * Cleanup applied AFTER an old-brand replacement to tidy up artifacts the
 * replacement may leave behind (a doubled "the …" and collapsed double spaces).
 */
const OLD_BRAND_CLEANUP_RULES: PrivacyRule[] = [
  { pattern: /\bthe the (agency|support|mentees|instructor|Blitz)\b/gi, replacement: "the $1" },
  { pattern: / {2,}/g, replacement: " " },
];

/**
 * The complete old-brand rebrand rule set (replacements + cleanup) — the single
 * source of truth shared by PRIVACY_RULES (retrieval-time scrub) and
 * rebrandOldBrandContent (the stored-content backfill). Never hand-duplicate
 * these patterns elsewhere; import this instead.
 */
export const OLD_BRAND_REBRAND_RULES: PrivacyRule[] = [
  ...OLD_BRAND_REPLACEMENT_RULES,
  ...OLD_BRAND_CLEANUP_RULES,
];

/**
 * COACH & VA FIRST-NAME-ONLY GUIDANCE — the roster-driven generalisation of the
 * founder first-name rule above (single source of truth alongside
 * {@link OLD_BRAND_REBRAND_GUIDANCE}).
 *
 * Members must only ever see a coach or VA by their FIRST name, so whenever a
 * transcript names a staff member with a surname the surname is dropped. Unlike
 * the founder / coach surnames in PRIVACY_RULES below, this guidance keys only
 * on FIRST names because that is the roster field the cleaner needs — the LLM
 * sees the surname in context and drops it. The deterministic PRIVACY_RULES
 * entries below are the backstop for every staff member whose surname IS known:
 * coaches via hand-written rules, and VAs via buildStaffSurnameRules(VA_ROSTER)
 * once a VA surname is recorded in the roster (see the VA seam in PRIVACY_RULES).
 * A VA with no recorded surname still relies on this prompt guidance alone.
 *
 * Pass the live staff first names (from the roster loader) so the transcript
 * cleaner's prompts stay in lockstep with coaching-roster.ts and never drift.
 */
export function buildStaffFirstNameGuidance(staffFirstNames: string[]): string {
  const names = staffFirstNames.map((n) => n.trim()).filter((n) => n.length > 0).join(", ");
  return (
    "Coach & VA names — FIRST NAME ONLY. This is the SAME first-name-only privacy " +
    "convention as the founder rule, generalised to the whole live coach + VA " +
    "roster. Whenever a coach or VA is named with a surname, keep the FIRST name " +
    "and DROP the surname (e.g. 'Bruce Clark' -> 'Bruce'), throughout the body, " +
    "not just speaker labels. Do NOT flag this. NEVER strip a MEMBER's surname — " +
    "members keep their real name" +
    (names ? `. Live coach + VA roster (first names): ${names}` : "") +
    "."
  );
}

export const PRIVACY_RULES: PrivacyRule[] = [
  // --- Generic PII: email addresses ---
  // Matches any RFC-5321-style address regardless of domain or who it belongs
  // to. Must run BEFORE named-person rules so an address like
  // "coach@buildtestscale.com" is caught here and not partially munged below.
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[contact redacted]",
  },

  // --- Generic PII: phone numbers ---
  // Covers the common North-American and international formats found in
  // knowledge-base content:
  //   +1 555-555-5555  /  (555) 555-5555  /  555.555.5555  /  5555555555
  // The leading word-boundary anchor (\b or a look-behind) is intentionally
  // omitted because phone numbers can appear without surrounding spaces (e.g.
  // after a colon). The trailing \b prevents a partial match on longer digit
  // strings (credit cards, etc.).
  {
    pattern: /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g,
    replacement: "[phone redacted]",
  },

  // --- Coaches: full name -> first name only ---
  // NOTE: surnames have spelling variants in the source content (e.g. the
  // transcripts/QA articles use both "Wissbaum" and "Wisbaum"); each pattern
  // must tolerate every variant seen in the wild.
  { pattern: /Sasha\s+Bob[iy]lev/gi, replacement: "Sasha" },
  { pattern: /Bruce\s+Clark/gi, replacement: "Bruce" },
  { pattern: /Michael\s+Wiss?baum/gi, replacement: "Michael" },
  { pattern: /Todd\s+Rupp/gi, replacement: "Todd" },
  // Shephard / Shepard / Shepherd / Sheperd / Shephrd — tolerates any
  // h-insertion and the a/e vowel variant seen across source files. The vowel is
  // OPTIONAL ([ae]?) so the vowel-less "Shephrd" mistranscription also collapses.
  { pattern: /Robin\s+Sheph?[ae]?rd/gi, replacement: "Robin" },

  // --- Coaches: strip orphaned surnames (left over from chunk splits) ---
  { pattern: /\bBob[iy]lev\b/gi, replacement: "" },
  { pattern: /\bWiss?baum\b/gi, replacement: "" },
  { pattern: /\bRupp\b/gi, replacement: "" },
  { pattern: /\bSheph?[ae]?rd\b/gi, replacement: "" },
  { pattern: /\bClark\b/gi, replacement: "Bruce" },

  // --- VAs: surname strip (roster-driven, same protection as coaches) ---
  // VA surnames are captured in VA_ROSTER (coaching-roster.ts) via an optional
  // `surname` field. buildStaffSurnameRules derives the SAME two-rule pattern the
  // coaches use above (full name -> first name, then an orphaned-surname strip)
  // for every VA whose surname is KNOWN, so scrubPrivateContent deterministically
  // reduces that VA to first-name-only even if the model echoes the full name.
  // VAs with no recorded surname produce no rule (the LLM first-name-only prompt
  // guidance stays their protection). To protect a VA deterministically, record
  // their real surname in VA_ROSTER — never invent one here.
  ...buildStaffSurnameRules(VA_ROSTER),

  // ============================================================
  // ADD NEW FORBIDDEN NAMES HERE.
  // Example — remove a full name entirely:
  //   { pattern: /\bJane Doe\b/gi, replacement: "" },
  // Example — replace with a neutral term:
  //   { pattern: /\bJohn Smith\b/gi, replacement: "the coach" },
  // ============================================================

  // --- Old-brand rebrand + trailing cleanup (shared single source) ---
  // Founder -> "Adam"; company/program (incl. garbled variants) -> "BTS", then
  // collapse the artifacts. Kept LAST so the whitespace cleanup also tidies the
  // coach-surname removals above. See OLD_BRAND_REBRAND_RULES.
  ...OLD_BRAND_REBRAND_RULES,
];

/** Apply every privacy rule to a single string. Returns "" for nullish input. */
export function scrubPrivateContent(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let out = text;
  for (const rule of PRIVACY_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

/**
 * Rewrite ONLY old-brand references (founder -> "Adam"; company / program ->
 * "BTS") in a single string, using OLD_BRAND_REBRAND_RULES. Unlike
 * scrubPrivateContent this does NOT strip coach / VA names — it is safe to run
 * over raw mining source (ai_source_documents / transcript_cleaner_documents)
 * where authority attribution must be preserved.
 *
 * Content that carries NO old-brand reference is returned byte-for-byte
 * unchanged: the trailing whitespace/artifact cleanup only runs once a brand
 * replacement has actually fired, so the stored-content backfill never rewrites
 * unrelated rows (e.g. collapsing legitimate double spaces) and stays
 * idempotent. Returns "" for nullish input.
 */
export function rebrandOldBrandContent(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let out = text;
  for (const rule of OLD_BRAND_REPLACEMENT_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  // No old-brand reference present -> leave the input untouched.
  if (out === text) return text;
  for (const rule of OLD_BRAND_CLEANUP_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

/**
 * Convenience helper for knowledge-base docs: scrubs `title` and `content`
 * (leaving other fields untouched). Only scrubs fields that are present.
 */
export function scrubKbDoc<T extends { title?: string | null; content?: string | null }>(
  doc: T,
): T {
  const out: T = { ...doc };
  // Only scrub when the field is a non-null string — preserve null/undefined as-is
  // so the caller's DB constraints (NOT NULL vs nullable) are not silently violated.
  if (doc.title != null) out.title = scrubPrivateContent(doc.title) as T["title"];
  if (doc.content != null) out.content = scrubPrivateContent(doc.content) as T["content"];
  return out;
}
