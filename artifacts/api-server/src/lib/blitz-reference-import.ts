import { flattenNavigationMap } from "@workspace/portal-nav-map";
import type { BlitzPhaseKey } from "@workspace/blitz-curriculum";
import {
  resolveBlitzSourceDoc,
  resolveBlitzLessonId,
  BLITZ_MAPPING_CAVEATS,
  type BlitzIdentityEntry,
} from "./blitz-identity-map.js";
import { scrubPrivateContent, rebrandOldBrandContent } from "./content-privacy-filter.js";
import { scrubConfidentialTerm } from "./confidential-term-repair.js";
import { detectTagsFromTriggers } from "./kb-taxonomy.js";
import { getEffectiveTags, getEffectiveTagTriggers } from "./kb-tool-tags.js";
import type { RiskFlag } from "./kb-flags.js";

/**
 * Blitz reference-doc import (Task #1914) — the transformer that turns the 96
 * `ai_source_documents` reference docs (`source_type = 'reference_docs'`) into
 * clean, member-safe AI Document Review drafts (`kb_staging_docs`).
 *
 * WHAT THE TRANSFORMER DOES (pure, unit-testable):
 *   1. Strips the internal metadata header (`# 4.4: Title` heading +
 *      `**Phase:** / **Module:** / **Category:** / **Applies to:** /
 *      **Topics:**` lines) — internal mining scaffolding, never member-facing.
 *   2. Removes the internal lesson numbering ("4.4:", "3.18b:") from the title
 *      and heading. Members never see the internal numbering (see
 *      blitz-identity-map.ts — a member pointed at "3.18b" would be lost).
 *   3. Rewrites cross-references ("Proceed to Lesson 4.5, where …") to the
 *      canonical member-facing anchor via BLITZ_IDENTITY_CROSSWALK:
 *      'Section 7 ("…") in the Build phase of the Blitz guide'. Unresolvable
 *      ids (retired lessons) are neutralized and surfaced in adminNotes.
 *   4. Scrubs privacy + legacy-brand + the confidential publisher name through
 *      the SAME shared filters the rest of the pipeline uses.
 *   5. Pre-assigns the locked placement (curated / process / node /
 *      blitzSection / taxonomy tags) from the drift-guarded crosswalk — triage
 *      is filed-placement-authoritative, so these stick.
 *
 * REVIEW-EFFORT CLASSIFIER: docs whose steps click through the MEMBER PORTAL
 * ("Log in to your portal … Navigate to **Resources** > …") get a
 * `portal_nav_check` risk flag (medium when a referenced label is missing from
 * the live nav map, low when all labels match). Everything else (third-party
 * tool procedures — Flexy, DIYTrax, MetricMover …) is a skim: the portal can't
 * drift those, so the reviewer only sanity-reads. The skim/nav-check guidance
 * is derived (blitz source + presence/absence of the flag) — no flag inflation.
 */

// ── Idempotency marker ───────────────────────────────────────────────────────

/**
 * `kb_staging_docs.source` marker for every row this importer creates. The
 * idempotency key is (source = this marker, sourceVideoTitle = exact
 * `ai_source_documents.title`) — titles are the drift-guarded contract with
 * the crosswalk, so re-imports never resurrect a rejected/deleted row even if
 * the source table is reseeded with different ids.
 */
export const BLITZ_REFERENCE_IMPORT_SOURCE = "blitz_reference_import";

/** The `ai_source_documents.source_type` folder this importer reads. */
export const BLITZ_REFERENCE_SOURCE_TYPE = "reference_docs";

// ── Member-facing anchor phrases ─────────────────────────────────────────────

const PHASE_WORD: Record<BlitzPhaseKey, string> = {
  intro: "Introduction",
  build: "Build",
  test: "Test",
  scale: "Scale",
};

/**
 * The canonical textual pointer for a Blitz section — matches prompt Rule 11:
 * textual references only ("Section 6 (…) in the Build phase of the Blitz
 * guide"), never internal numbering, never links.
 */
export function blitzAnchorPhrase(entry: BlitzIdentityEntry): string {
  const where =
    entry.phase === "intro"
      ? "the Introduction of the Blitz guide"
      : `the ${PHASE_WORD[entry.phase]} phase of the Blitz guide`;
  return `Section ${entry.section} ("${entry.sectionMeta.title}") in ${where}`;
}

// ── Metadata header parsing ──────────────────────────────────────────────────

export interface ReferenceDocHeader {
  phase: string | null;
  module: string | null;
  category: string | null;
  appliesTo: string | null;
  topics: string[];
}

const HEADING_RE = /^#\s+(.+?)\s*$/;
const LESSON_NUMBER_PREFIX_RE = /^\d{1,2}[AB]?\.\d{1,2}[ab]?\s*[:.]\s*/;
const HEADER_FIELD_RE = /^\*\*(Phase|Module|Category|Applies to|Topics):\*\*\s*(.*?)\s*$/;

/**
 * Splits a reference doc into its internal metadata header and the body.
 * The header is the leading `# …` heading plus the run of `**Field:** value`
 * lines (and blank lines) before the first real content line.
 */
export function parseReferenceDoc(content: string): {
  header: ReferenceDocHeader;
  body: string;
} {
  const header: ReferenceDocHeader = {
    phase: null,
    module: null,
    category: null,
    appliesTo: null,
    topics: [],
  };
  const lines = content.split("\n");
  let i = 0;
  // Skip leading blank lines.
  while (i < lines.length && lines[i].trim() === "") i++;
  // Leading heading (e.g. "# 4.4: Submit Ad Split Test Media to Compliance").
  if (i < lines.length && HEADING_RE.test(lines[i])) i++;
  // Metadata field lines (with interleaved blanks).
  let sawField = false;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") {
      i++;
      continue;
    }
    const m = HEADER_FIELD_RE.exec(line);
    if (!m) break;
    sawField = true;
    const value = m[2].trim();
    switch (m[1]) {
      case "Phase":
        header.phase = value || null;
        break;
      case "Module":
        header.module = value || null;
        break;
      case "Category":
        header.category = value || null;
        break;
      case "Applies to":
        header.appliesTo = value || null;
        break;
      case "Topics":
        header.topics = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        break;
    }
    i++;
  }
  void sawField;
  const body = lines.slice(i).join("\n").trim();
  return { header, body };
}

// ── Title cleanup ────────────────────────────────────────────────────────────

const CORE_TRAINING_SUFFIX_RE = /\s*\(Core Training\)\s*$/;

/**
 * Member-facing title from a crosswalk entry: the lesson title without the
 * internal `N.N[ab]:` numbering prefix and without the seeder's
 * "(Core Training)" suffix. (The `The Blitz™ Lesson — ` prefix is already
 * absent from `sectionMeta`-independent lesson titles via the raw crosswalk.)
 */
export function cleanBlitzTitle(entry: BlitzIdentityEntry): string {
  // entry.sourceDocTitle is either `The Blitz™ Lesson — {lesson title}` or the
  // prose title itself. Strip the prefix, the numbering, and the suffix.
  let t = entry.sourceDocTitle;
  const dash = "The Blitz™ Lesson — ";
  if (t.startsWith(dash)) t = t.slice(dash.length);
  t = t.replace(LESSON_NUMBER_PREFIX_RE, "");
  t = t.replace(CORE_TRAINING_SUFFIX_RE, "");
  return t.trim();
}

// ── Cross-reference rewriting ────────────────────────────────────────────────

const LESSON_ID_PATTERN = "\\d{1,2}[AB]?\\.\\d{1,2}[ab]?";
// "Lesson 4.5" / "Lessons 3.14 through 3.16" / "Lesson 2.2: \"Title\"" —
// captures the whole run of ids plus an optional quoted-title tail.
const LESSON_REF_RE = new RegExp(
  `\\bLessons?\\s+(${LESSON_ID_PATTERN})` +
    `((?:\\s*(?:,|and|or|through|to|&|–|—|-)\\s*(?:Lessons?\\s+)?${LESSON_ID_PATTERN})*)` +
    `(\\s*[:,]?\\s*(?:"[^"\\n]{0,160}"|“[^”\\n]{0,160}”))?`,
  "g",
);
const BARE_ID_RE = new RegExp(LESSON_ID_PATTERN, "g");

export interface LessonRefRewrite {
  text: string;
  /** Internal lesson ids that could NOT be resolved via the crosswalk. */
  unresolved: string[];
}

/**
 * Rewrites every internal "Lesson N.N" reference to its canonical member-facing
 * anchor phrase. Ids that don't resolve (retired lessons) are replaced with a
 * neutral "a later step in the Blitz guide" and reported for adminNotes.
 * Any quoted internal lesson title directly attached to the reference is
 * dropped (the anchor phrase carries the member-facing section title).
 */
export function rewriteLessonReferences(text: string): LessonRefRewrite {
  const unresolved: string[] = [];
  const out = text.replace(LESSON_REF_RE, (_full, firstId: string, moreIds: string) => {
    const ids = [firstId, ...((moreIds || "").match(BARE_ID_RE) ?? [])];
    const phrases: string[] = [];
    for (const id of ids) {
      const entry = resolveBlitzLessonId(id);
      if (entry) {
        const phrase = blitzAnchorPhrase(entry);
        if (!phrases.includes(phrase)) phrases.push(phrase);
      } else {
        unresolved.push(id);
      }
    }
    if (phrases.length === 0) return "a later step in the Blitz guide";
    return phrases.join(" and ");
  });
  return { text: out, unresolved };
}

// ── Review-effort classifier ─────────────────────────────────────────────────

export type BlitzReviewEffort = "nav_check" | "skim";

const PORTAL_MENTION_RE = /\b(?:your|the|bts|member)\s+portal\b|\blog\s?in to (?:your|the)? ?portal\b/i;
const NAV_ACTION_RE = /navigate|go to|click|select|open|choose|>|→/i;
const BOLD_TOKEN_RE = /\*\*([^*\n]{2,60})\*\*/g;

export interface ReviewEffortClassification {
  effort: BlitzReviewEffort;
  /** Present only for nav_check docs. */
  navFlag: RiskFlag | null;
  /** Bold labels referenced near a portal mention that match / miss the nav map. */
  matchedLabels: string[];
  unmatchedLabels: string[];
}

/**
 * Classifies review effort. A doc whose steps click through the MEMBER PORTAL
 * needs a careful click-path verification (`portal_nav_check` flag); everything
 * else — third-party tool procedures (Flexy, DIYTrax, MetricMover, GIFSTER …)
 * — is a skim: portal navigation can't drift those docs.
 *
 * Label check: bold `**Label**` tokens on action lines within a few lines of a
 * portal mention are matched (case-insensitively) against the live portal nav
 * map (@workspace/portal-nav-map). Any miss escalates the flag to medium.
 */
export function classifyReviewEffort(content: string): ReviewEffortClassification {
  const lines = content.split("\n");
  const portalLineIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (PORTAL_MENTION_RE.test(lines[i])) portalLineIdxs.push(i);
  }
  if (portalLineIdxs.length === 0) {
    return { effort: "skim", navFlag: null, matchedLabels: [], unmatchedLabels: [] };
  }

  const navItems = flattenNavigationMap();
  const navLabels = navItems.map((n) => n.label.toLowerCase());
  const labelMatches = (candidate: string): boolean => {
    const c = candidate.toLowerCase().trim();
    return navLabels.some((l) => l === c || l.includes(c) || c.includes(l));
  };

  const matched = new Set<string>();
  const unmatched = new Set<string>();
  const WINDOW = 4;
  for (const idx of portalLineIdxs) {
    for (let j = idx; j <= Math.min(idx + WINDOW, lines.length - 1); j++) {
      const line = lines[j];
      if (!NAV_ACTION_RE.test(line)) continue;
      for (const m of line.matchAll(BOLD_TOKEN_RE)) {
        const label = m[1].trim();
        if (!label) continue;
        (labelMatches(label) ? matched : unmatched).add(label);
      }
    }
  }

  const unmatchedLabels = [...unmatched];
  const matchedLabels = [...matched];
  const navFlag: RiskFlag = {
    type: "portal_nav_check",
    severity: unmatchedLabels.length > 0 ? "medium" : "low",
    message:
      unmatchedLabels.length > 0
        ? "Portal click-path references labels missing from the current navigation"
        : "Portal click-path — click through and verify against the live portal",
    detail:
      (unmatchedLabels.length > 0
        ? `Not found in the current portal navigation map: ${unmatchedLabels
            .map((l) => `"${l}"`)
            .join(", ")}. `
        : "") +
      (matchedLabels.length > 0
        ? `Matched current navigation labels: ${matchedLabels.map((l) => `"${l}"`).join(", ")}.`
        : "No bold navigation labels detected near the portal mention — verify the path manually."),
  };
  return { effort: "nav_check", navFlag, matchedLabels, unmatchedLabels };
}

/**
 * Recomputes the `portal_nav_check` flag for a blitz-reference staging doc's
 * EFFECTIVE content. kb-triage overwrites `riskFlags` wholesale on every
 * analysis run, so it calls this to re-append the flag for
 * `source = 'blitz_reference_import'` docs — the classification survives
 * re-analysis and tracks content edits + live nav-map changes.
 */
export function computePortalNavCheckFlag(effectiveContent: string): RiskFlag | null {
  return classifyReviewEffort(effectiveContent).navFlag;
}

// ── Full transform ───────────────────────────────────────────────────────────

export interface BlitzReferenceTransform {
  entry: BlitzIdentityEntry;
  title: string;
  content: string;
  /** Legacy free-text tags column (from the header's Topics line). */
  tags: string;
  /** Registry-controlled taxonomy tags detected from title + topics + module. */
  taxonomyTags: string[];
  header: ReferenceDocHeader;
  effort: BlitzReviewEffort;
  riskFlags: RiskFlag[];
  adminNotes: string;
  unresolvedRefs: string[];
  ceiling: "operational" | "conceptual";
}

function scrubAll(text: string): string {
  return scrubPrivateContent(rebrandOldBrandContent(scrubConfidentialTerm(text)));
}

/**
 * Pure transform of one reference doc into its staging-row shape. Returns null
 * when the source title is not in the drift-guarded crosswalk (should never
 * happen for the 96-doc set — the caller reports it loudly).
 */
export function transformBlitzReferenceDoc(
  sourceTitle: string,
  rawContent: string,
): BlitzReferenceTransform | null {
  const entry = resolveBlitzSourceDoc(sourceTitle);
  if (!entry) return null;

  const { header, body } = parseReferenceDoc(rawContent);
  const title = scrubAll(cleanBlitzTitle(entry));

  const { text: rewritten, unresolved } = rewriteLessonReferences(body);
  const content = scrubAll(`# ${title}\n\n${rewritten}`).trim();

  const classification = classifyReviewEffort(content);
  const riskFlags: RiskFlag[] = classification.navFlag ? [classification.navFlag] : [];

  const topics = header.topics.map((t) => scrubAll(t));
  const tagQuery = [title, topics.join(" "), header.module ?? ""].join(" ");
  // Effective (DB-merged) tag vocabulary — TOOL tags are admin-managed data.
  const taxonomyTags = detectTagsFromTriggers(tagQuery, getEffectiveTags(), getEffectiveTagTriggers());

  const noteLines: string[] = [
    classification.effort === "nav_check"
      ? "Review guidance: NAV CHECK — this doc walks the member through the portal; click through the path and verify every label/step against the live portal before approving."
      : "Review guidance: SKIM — third-party tool / in-tool procedure (no portal click-path); sanity-read for accuracy, no portal verification needed.",
  ];
  if (entry.caveat) {
    noteLines.push(`Mapping caveat: ${BLITZ_MAPPING_CAVEATS[entry.caveat]}`);
  }
  if (unresolved.length > 0) {
    noteLines.push(
      `Unresolved internal cross-reference(s) to retired lesson(s): ${[...new Set(unresolved)].join(", ")} — replaced with a neutral phrase; verify the surrounding sentence still reads correctly.`,
    );
  }
  noteLines.push(
    `Imported from AI Source Knowledge reference doc "${sourceTitle}" (internal metadata header stripped, lesson numbering removed, cross-references rewritten to member-facing Blitz guide sections).`,
  );

  return {
    entry,
    title,
    content,
    tags: topics.join(", "),
    taxonomyTags,
    header,
    effort: classification.effort,
    riskFlags,
    adminNotes: noteLines.join("\n\n"),
    unresolvedRefs: [...new Set(unresolved)],
    ceiling: entry.kind === "prose" ? "conceptual" : "operational",
  };
}

// ── Idempotent import ────────────────────────────────────────────────────────

// NOTE: the old blanket importer (`importBlitzReferenceDocs`) was retired with
// the section-anchored reference-doc rebuild. The transform helpers above stay
// exported for tests + kb-triage (BLITZ_REFERENCE_IMPORT_SOURCE handling of
// pre-existing staging rows).
