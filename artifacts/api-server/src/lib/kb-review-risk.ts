/**
 * Review-gate risk analysis (Task #1752 — "Sharpen the review-and-publish gate").
 *
 * PURE, line-oriented analysis of a staging draft's CURRENT text so the
 * reviewer sees risky passages before publish:
 *   - flags threaded from synthesis: inline [SITUATIONAL] / [CONTEXT-BOUND] /
 *     [ANOMALY] bullet tags and "> ⚠️ SOURCE CONFLICT (for reviewer):" blockquotes
 *     (the exact contract kb-synthesis instructs the model to emit),
 *   - situational numbers (dollar figures, per-day/week/month rates, percents)
 *     on lines NOT already tagged situational,
 *   - time-sensitive phrasing ("right now", "currently", month-year dates …),
 *   - residual private-content matches (the deterministic PRIVACY_RULES set —
 *     coach surnames, emails, phones, old brand) plus an ADVISORY capitalized
 *     First-Last heuristic for possible member names.
 *
 * This runs at REVIEW time against editedContent ?? content (so it stays
 * accurate through edits/refines) via GET /staging/:id/review-insights, and its
 * summary-level detectors also feed computeRiskFlags (kb-flags.ts) so the
 * existing chip/severity pattern surfaces the same signals at triage.
 */

import { PRIVACY_RULES } from "./content-privacy-filter";
import type { FlagSeverity } from "./kb-flags";

// Local mirror of kb-synthesis's SOURCE_CONFLICT_MARKER payload — kept as a
// bare substring (no "> ⚠️" prefix) so mangled markdown still matches. A unit
// test asserts the real marker contains this prefix so the two never drift.
export const SOURCE_CONFLICT_PREFIX = "SOURCE CONFLICT (for reviewer):";

// Local mirror of kb-nav-grounding's NAV_CONFLICT_MARKER payload — same
// bare-substring pattern; a unit test asserts the real marker contains this
// prefix so the two never drift.
export const NAV_CONFLICT_PREFIX = "NAVIGATION CONFLICT (for reviewer):";

export type ReviewHighlightKind =
  | "source_conflict"
  | "navigation_conflict"
  | "synthesis_situational"
  | "synthesis_context_bound"
  | "synthesis_anomaly"
  | "situational_number"
  | "time_sensitive"
  | "privacy_residue"
  | "possible_member_name";

export interface ReviewHighlight {
  kind: ReviewHighlightKind;
  severity: FlagSeverity;
  label: string;
  /** Exact matched substring (for in-line marking). */
  excerpt: string;
  /** 0-based line index in the analyzed content. */
  line: number;
  /** The full text of that line (for exact-match soften/remove actions). */
  lineText: string;
  note: string;
}

export const HIGHLIGHT_META: Record<
  ReviewHighlightKind,
  { severity: FlagSeverity; label: string; note: string }
> = {
  source_conflict: {
    severity: "critical",
    label: "Source conflict",
    note: "Synthesis found sources that genuinely disagree — adjudicate and rewrite or remove this blockquote before publishing.",
  },
  navigation_conflict: {
    severity: "high",
    label: "Navigation conflict",
    note: "The draft references a legacy portal location (or one the nav map can't confirm) — rewrite it to the current page name/path (or adjudicate the mapping) and remove this blockquote before publishing.",
  },
  synthesis_situational: {
    severity: "high",
    label: "Situational (from synthesis)",
    note: "Figures here are one member's situation or a point-in-time answer — keep the context attached or soften; never publish as a universal target.",
  },
  synthesis_context_bound: {
    severity: "medium",
    label: "Context-bound walkthrough",
    note: "Live screen-share narration — topic evidence, not standalone quotable teaching. Rework into general guidance or remove.",
  },
  synthesis_anomaly: {
    severity: "medium",
    label: "Segment anomaly",
    note: "The source segment boundaries were unreliable — verify this passage reads as a complete, correct thought.",
  },
  situational_number: {
    severity: "medium",
    label: "Unverified figure",
    note: "A specific number that is not tagged situational — confirm it is a universal, current figure (not one member's case) before publishing.",
  },
  time_sensitive: {
    severity: "medium",
    label: "Time-sensitive phrasing",
    note: "Phrasing tied to a point in time — this will age. Rewrite timelessly or confirm it will stay true.",
  },
  privacy_residue: {
    severity: "high",
    label: "Private-content match",
    note: "Matches the privacy scrub rules (name/email/phone/old brand). It WILL be auto-scrubbed at publish, but verify the sentence still reads correctly and no member context leaks around it.",
  },
  possible_member_name: {
    severity: "low",
    label: "Possible member name",
    note: "Advisory: looks like a First Last person name. Members must never be named — verify and generalize to \"a member\" if it is one.",
  },
};

// ── Pattern vocabularies ─────────────────────────────────────────────────────

const SYNTH_TAGS: ReadonlyArray<{ tag: string; kind: ReviewHighlightKind }> = [
  { tag: "[SITUATIONAL]", kind: "synthesis_situational" },
  { tag: "[SITUATIONAL NUMBER", kind: "synthesis_situational" },
  { tag: "[CONTEXT-BOUND]", kind: "synthesis_context_bound" },
  { tag: "[CONTEXT-BOUND WALKTHROUGH", kind: "synthesis_context_bound" },
  { tag: "[ANOMALY]", kind: "synthesis_anomaly" },
  { tag: "[SEGMENT ANOMALY", kind: "synthesis_anomaly" },
];

const NUMBER_PATTERNS: ReadonlyArray<RegExp> = [
  /\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?\b/g, // $40, $1,500, $10k
  /\b\d[\d,]*(?:\.\d+)?\s*(?:\/|per\s+)(?:day|week|month|year|click|lead|sale)\b/gi,
  /\b\d{1,3}(?:\.\d+)?\s?%/g,
];

const TIME_SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:right now|currently|at the moment|as of (?:now|today|this writing)|these days|recently|lately)\b/gi,
  /\b(?:this|last|next)\s+(?:week|month|year|quarter)\b/gi,
  /\b(?:just|newly)\s+(?:launched|released|added|changed|updated|rolled out)\b/gi,
  /\bbrand[- ]new\b/gi,
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/g,
  /\b(?:in|since|back in|as of)\s+20\d{2}\b/gi,
];

// Capitalized-pair heuristic stoplist: either word in this set kills the match.
// Brand/product/heading vocabulary + common sentence-starters seen in KB docs.
const NAME_STOPWORDS = new Set(
  [
    "The", "This", "That", "These", "Those", "There", "Then", "They", "When", "What",
    "Why", "How", "Where", "Which", "While", "With", "Without", "Your", "You",
    "After", "Before", "During", "Once", "First", "Second", "Third", "Next", "Last",
    "Key", "Takeaways", "Step", "Steps", "Note", "Notes", "Important", "Warning",
    "Build", "Test", "Scale", "BTS", "Blitz", "Launch", "LaunchPad", "Pad",
    "Google", "Facebook", "Meta", "YouTube", "Instagram", "TikTok", "Bing",
    "Media", "Mavens", "ClickBank", "Ads", "Ad", "Manager", "Account", "Accounts",
    "Landing", "Page", "Pages", "Offer", "Offers", "Campaign", "Campaigns",
    "Tracking", "Pixel", "Conversion", "Conversions", "Affiliate", "Network",
    "Support", "Team", "Coach", "Coaches", "Member", "Members", "Portal",
    "Knowledge", "Base", "Source", "Sources", "Section", "Overview", "Summary",
    "Do", "Don", "Always", "Never", "Avoid", "Use", "Make", "Set", "Get", "Keep",
    "New", "Old", "Good", "Bad", "High", "Low", "Big", "Small",
  ].map((w) => w),
);

// Coach/staff/founder FIRST names are fine on their own; a First Last pair
// starting with one still deserves a look ONLY if the privacy rules didn't
// already catch the surname — the deterministic rules run first, so we skip
// pairs the privacy pass already flagged (handled by dedup below).

function findMatches(line: string, re: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of line.matchAll(rx)) {
    if (m[0]) out.push(m[0]);
  }
  return out;
}

/** Analyze a draft's current text. Pure — unit-tested. */
export function analyzeDraftForReview(content: string): ReviewHighlight[] {
  const lines = content.split("\n");
  const highlights: ReviewHighlight[] = [];
  const seen = new Set<string>();

  const push = (kind: ReviewHighlightKind, excerpt: string, line: number) => {
    const key = `${kind}|${line}|${excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = HIGHLIGHT_META[kind];
    highlights.push({
      kind,
      severity: meta.severity,
      label: meta.label,
      excerpt,
      line,
      lineText: lines[line],
      note: meta.note,
    });
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // 1. Source-conflict blockquotes (synthesis contract).
    if (trimmed.includes(SOURCE_CONFLICT_PREFIX)) {
      push("source_conflict", trimmed, i);
    }

    // 1b. Navigation-conflict blockquotes (navigation grounding contract).
    if (trimmed.includes(NAV_CONFLICT_PREFIX)) {
      push("navigation_conflict", trimmed, i);
    }

    // 2. Inline synthesis tags.
    let synthTagged = false;
    for (const { tag, kind } of SYNTH_TAGS) {
      const at = line.indexOf(tag);
      if (at !== -1) {
        synthTagged = true;
        // Excerpt is the exact substring from the line (through the closing
        // bracket for prefix-form tags) so inline <mark>ing always matches.
        let excerpt = tag;
        if (!tag.endsWith("]")) {
          const close = line.indexOf("]", at);
          excerpt = close !== -1 ? line.slice(at, close + 1) : line.slice(at).trimEnd();
        }
        push(kind, excerpt, i);
      }
    }

    // 3. Situational numbers — only on lines NOT already synthesis-tagged
    //    (a tagged line already carries the stronger signal).
    if (!synthTagged) {
      for (const re of NUMBER_PATTERNS) {
        for (const m of findMatches(line, re)) push("situational_number", m, i);
      }
    }

    // 4. Time-sensitive phrasing.
    for (const re of TIME_SENSITIVE_PATTERNS) {
      for (const m of findMatches(line, re)) push("time_sensitive", m, i);
    }

    // 5. Residual private-content matches (deterministic scrub rules).
    const privacyExcerpts = new Set<string>();
    for (const rule of PRIVACY_RULES) {
      for (const m of findMatches(line, rule.pattern)) {
        // Skip pure-whitespace cleanup rules and empty matches.
        if (!m.trim()) continue;
        privacyExcerpts.add(m);
        push("privacy_residue", m, i);
      }
    }

    // 6. Advisory member-name heuristic (skip headings — mostly title case).
    if (!trimmed.startsWith("#")) {
      for (const m of line.matchAll(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g)) {
        const [pair, first, second] = m;
        if (NAME_STOPWORDS.has(first) || NAME_STOPWORDS.has(second)) continue;
        // Already caught deterministically? Don't double-flag.
        if ([...privacyExcerpts].some((p) => p.includes(second) || p === pair)) continue;
        push("possible_member_name", pair, i);
      }
    }
  });

  return highlights;
}

// ── Summary-level detectors (feed computeRiskFlags) ──────────────────────────

export function hasSourceConflictMarker(content: string): boolean {
  return content.includes(SOURCE_CONFLICT_PREFIX);
}

export function hasNavigationConflictMarker(content: string): boolean {
  return content.includes(NAV_CONFLICT_PREFIX);
}

export function hasSynthesisRiskTags(content: string): boolean {
  return SYNTH_TAGS.some(({ tag }) => content.includes(tag));
}

export function hasTimeSensitivePhrasing(content: string): boolean {
  return TIME_SENSITIVE_PATTERNS.some((re) =>
    new RegExp(re.source, re.flags.replace("g", "")).test(content),
  );
}

export function hasPrivacyResidue(content: string): boolean {
  return PRIVACY_RULES.some((rule) => {
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
    const m = content.match(rx);
    return m !== null && m[0].trim().length > 0;
  });
}
