/**
 * Reviewer SOP — the in-app "how to review a KB draft" reference (Task #1851).
 *
 * This is the single source for the guidance shown on the Knowledge Base Review
 * screen. Its taxonomy listings (home roots + nodes, doc classes, ceilings,
 * handoffs) and its risk-flag catalog are DERIVED from the live registries
 * (kb-taxonomy.ts, kb-flags.ts) rather than restated — so the SOP can never
 * silently diverge from the vocabulary the pipeline actually enforces. The
 * `satisfies Record<...>` maps make a missing/extra key a compile error, and
 * kb-sop.test.ts guards the derivation at runtime.
 *
 * The authored PROSE (the sections) explains the review workflow, the human
 * gate, ranking mechanics, the refine chat, and what each reviewer action does.
 * It is intentionally hand-written policy — the part a human owns.
 */

import {
  HOME_ROOTS,
  ALL_NODES,
  DOC_CLASSES,
  CITABLE_DOC_CLASSES,
  CEILINGS,
  HANDOFF_TARGETS,
  HANDOFF_TARGET_NODES,
  getNodeBySlug,
  type DocClass,
  type Ceiling,
  type HandoffTarget,
} from "./kb-taxonomy.js";
import { RISK_FLAG_TYPES, type RiskFlagType } from "./kb-flags.js";

// ── Registry-derived reference tables ────────────────────────────────────────

/**
 * Per-doc-class charter: the plain-language "what belongs in this class" the
 * reviewer files against. Keyed by DocClass so a new class fails to compile
 * until its charter is written.
 */
const DOC_CLASS_CHARTERS = {
  curated: {
    label: "Curated",
    charter:
      "A verified, citable answer doc — an FAQ, glossary entry, or tool guide that directly answers a member's question. This is the workhorse citable class: one focused subject, member-facing vocabulary, grounded in the source material.",
  },
  overview: {
    label: "Overview",
    charter:
      "A verified, citable orientation / map doc — the \"here's the shape of X\" piece that frames a topic and points at the deeper curated docs. Broader than curated, but still a real answer, not a link farm.",
  },
  navigation: {
    label: "Navigation",
    charter:
      "A verified, citable click-path walkthrough for a specific portal app/area, authored from screenshots on the Navigation Docs page. Must name the current page/path — legacy locations are a navigation conflict, not content.",
  },
  transcript: {
    label: "Transcript",
    charter:
      "Training-only material derived from a recording. NEVER citable and excluded from every member-facing retrieval path. File a draft here only when it is raw call/curriculum material, not a finished answer.",
  },
} satisfies Record<DocClass, { label: string; charter: string }>;

/** Ceiling (depth domain) descriptions — how far a doc answers before handing off. */
const CEILING_DESCRIPTIONS = {
  operational:
    "Factual ops/policy answers (membership, refunds, hours, navigation). Account-specific actions hand off to support.",
  conceptual:
    "Grounded concept / strategy explanation. Deeper, member-specific strategy hands off to live coaching.",
  troubleshooting:
    "Known fixes / how-tos. Unresolved issues hand off to support.",
} satisfies Record<Ceiling, string>;

/** Handoff-target descriptions — where a doc points when its ceiling is hit. */
const HANDOFF_DESCRIPTIONS = {
  coaching:
    "A concept question that exceeds grounded depth routes to live coaching.",
  support:
    "A troubleshooting / ops question the KB can't resolve routes to support.",
} satisfies Record<HandoffTarget, string>;

/**
 * Reviewer-facing plain-language meaning for every risk flag. Keyed by
 * RiskFlagType so adding a flag fails to compile until its guidance is written.
 * The catalog itself is built by iterating {@link RISK_FLAG_TYPES}.
 */
const FLAG_MEANINGS = {
  conflict:
    "Conflicts with a human-verified live doc. Adjudicate before overwriting — blocks bulk-confirm.",
  high_stakes:
    "Touches money / earnings, guarantees, refunds, legal, compliance, medical, or tax. Verify carefully — blocks bulk-confirm.",
  va_sourced_strategy:
    "A strategy claim sourced from a VA call. VAs are authoritative for software/setup, not strategy — confirm against a coach source.",
  weak_source:
    "Authored from a VA or internal source rather than a strategic coach / official curriculum. Corroborate before citing.",
  stale_legacy:
    "Contains legacy references (old brand names, retired coach surnames, dropped networks, old email domains). Translate to current BTS truth.",
  single_source:
    "Only one source supports the draft — not corroborated. Low severity, but weigh whether a second source is needed.",
  possible_duplicate:
    "An existing doc may already cover this material. Check for overlap and merge/supersede rather than creating a second copy.",
  source_conflict:
    "The draft still contains a \"SOURCE CONFLICT (for reviewer)\" blockquote from synthesis. Adjudicate and remove it — blocks bulk-confirm.",
  navigation_conflict:
    "The draft references a legacy portal location. Rewrite to the current page name/path and remove the blockquote before publishing.",
  navigation_drift:
    "The portal navigation map changed after this draft was written — re-check any click-paths against the current portal.",
  situational_content:
    "Carries [SITUATIONAL] / [CONTEXT-BOUND] / [ANOMALY] passages. Verify figures stay context-bound illustrations, never universal targets.",
  time_sensitive:
    "Phrases like \"right now\" / \"currently\" / dated references will age. Rewrite timelessly or confirm.",
  privacy_residue:
    "Matches the privacy scrub rules (member/coach name, email, phone, or legacy brand). Auto-scrubbed at publish, but verify the passage still reads correctly.",
  retrieval_gap:
    "The draft failed some of its own AI-generated member questions through the real retrieval path — likely too thin or missing the vocabulary members would use. Add that vocabulary.",
  non_citable_review_doc:
    "This review doc is filed under a non-citeable class (e.g. legacy transcript) and would never be surfaced to members. Re-file it as a citeable class (curated / overview / navigation) so it can be published and cited.",
} satisfies Record<RiskFlagType, string>;

// ── Public shapes ────────────────────────────────────────────────────────────

export interface SopNode {
  slug: string;
  label: string;
}
export interface SopRoot {
  slug: string;
  label: string;
  description: string;
  nodes: SopNode[];
}
export interface SopDocClass {
  slug: string;
  label: string;
  citable: boolean;
  charter: string;
}
export interface SopCeiling {
  slug: string;
  description: string;
}
export interface SopHandoff {
  target: string;
  node: string;
  nodeLabel: string;
  description: string;
}
export interface SopFlag {
  type: string;
  meaning: string;
}
export interface SopSection {
  id: string;
  title: string;
  /** Ordered prose paragraphs / bullet lines (rendered as a list by the client). */
  body: string[];
}

export interface ReviewerSop {
  intro: string;
  sections: SopSection[];
  homeRoots: SopRoot[];
  docClasses: SopDocClass[];
  ceilings: SopCeiling[];
  handoffs: SopHandoff[];
  flags: SopFlag[];
}

// ── Authored prose ───────────────────────────────────────────────────────────

const SECTIONS: SopSection[] = [
  {
    id: "human-gate",
    title: "The human gate — what you are deciding",
    body: [
      "Nothing here is ever auto-approved or auto-rejected for members. Every draft is a candidate that becomes citable only when you approve it AND it clears its last-verified stamp.",
      "Your job is to decide three things: is it TRUE (grounded in the source, no invented facts), is it PLACED correctly (right shelf, node, and doc class), and is it SAFE to cite (no residual private content, no legacy references, no unresolved conflicts).",
      "Approving publishes it into the live citable corpus. Rejecting keeps it out. \"Needs review\" parks it for a second look. When in doubt on a high-stakes or conflicting draft, park it — those can never be bulk-confirmed.",
    ],
  },
  {
    id: "pipeline",
    title: "How a draft got here",
    body: [
      "Source material (calls, curriculum, uploads) is screened, then synthesized into a truth doc that consolidates the strongest sources for a node.",
      "Analysis stamps risk flags, a suggested placement (shelf / node / doc class), and a retrieval self-test before you ever see it.",
      "You review and, if needed, refine (see below). On approval the draft is pushed to the live AI documents table; an approved revision supersedes the existing published doc in place and re-stamps last-verified.",
    ],
  },
  {
    id: "placement",
    title: "Placing a draft",
    body: [
      "Every doc has exactly one home root (shelf) and, ideally, one node within it. Process and Concepts pair together; Operations stands alone as the \"how to get help\" hub.",
      "The doc class controls how the assistant may use it: curated / overview / navigation are citable; transcript is training-only and never cited.",
      "File against the charter, not the vibe. If the content genuinely belongs to a different node or is already covered elsewhere, move it or fold it in rather than publishing an overlapping copy — the refine chat will push back and help you check the live corpus.",
    ],
  },
  {
    id: "ranking",
    title: "How retrieval ranks a live doc",
    body: [
      "The assistant retrieves by a hybrid of lexical full-text match (over title + content) and semantic similarity, merged inside a tiered order: curated docs first, then a tag-boost tier, then the lexical+semantic blend.",
      "This is why member vocabulary matters: a doc that omits the words members actually use can be true and still never surface. The retrieval self-test measures exactly this against the live ranking.",
      "Only citable doc classes with a last-verified stamp are eligible — placement and verification are ranking gates, not cosmetic labels.",
    ],
  },
  {
    id: "refine-chat",
    title: "Using the refine chat",
    body: [
      "Ask questions (\"why does it say X?\", \"is this covered elsewhere?\") — questions are answered without touching the draft. Give an instruction (\"tighten the intro\") to make a surgical edit you can verify line by line.",
      "The chat is placement-aware: if an edit would add content outside this doc's charter, root, or node, it will NOT silently apply it. It checks the live corpus and advises — \"already covered in X\", \"belongs in Y\", or \"genuine gap\".",
      "That pushback is advice, not a veto. If you want the change anyway, say so (\"add it here anyway\") and it applies. When it points at a target doc, you can optionally leave a reviewer note on that doc so the overlap is on record for its future editor.",
    ],
  },
  {
    id: "self-test",
    title: "Reading the retrieval self-test",
    body: [
      "The self-test runs AI-generated member questions this doc should answer through the REAL retrieval path, with the draft injected as a candidate.",
      "A failing question means the assistant likely would NOT find this doc for that ask — usually a vocabulary gap. Fold the member's own phrasing into the draft.",
      "It is a guide, never a blocker: a retrieval_gap flag never trips \"needs expert\" and never blocks bulk-confirm.",
    ],
  },
];

const INTRO =
  "This is the standard operating procedure for reviewing knowledge-base drafts. It is derived from the live taxonomy and flag registries, so the tables below always reflect the vocabulary the pipeline actually enforces.";

// ── Builder ──────────────────────────────────────────────────────────────────

/** Build the reviewer SOP from the live registries plus the authored prose. */
export function buildReviewerSop(): ReviewerSop {
  const citable = new Set<string>(CITABLE_DOC_CLASSES);

  const homeRoots: SopRoot[] = HOME_ROOTS.map((r) => ({
    slug: r.slug,
    label: r.label,
    description: r.description,
    nodes: ALL_NODES.filter((n) => n.root === r.slug).map((n) => ({
      slug: n.slug,
      label: n.label,
    })),
  }));

  const docClasses: SopDocClass[] = DOC_CLASSES.map((slug) => ({
    slug,
    label: DOC_CLASS_CHARTERS[slug].label,
    citable: citable.has(slug),
    charter: DOC_CLASS_CHARTERS[slug].charter,
  }));

  const ceilings: SopCeiling[] = CEILINGS.map((slug) => ({
    slug,
    description: CEILING_DESCRIPTIONS[slug],
  }));

  const handoffs: SopHandoff[] = HANDOFF_TARGETS.map((target) => {
    const nodeSlug = HANDOFF_TARGET_NODES[target];
    return {
      target,
      node: nodeSlug,
      nodeLabel: getNodeBySlug(nodeSlug)?.label ?? nodeSlug,
      description: HANDOFF_DESCRIPTIONS[target],
    };
  });

  const flags: SopFlag[] = RISK_FLAG_TYPES.map((type) => ({
    type,
    meaning: FLAG_MEANINGS[type],
  }));

  return {
    intro: INTRO,
    sections: SECTIONS,
    homeRoots,
    docClasses,
    ceilings,
    handoffs,
    flags,
  };
}
