/**
 * Canonical BTS 17-step campaign roadmap — the SINGLE source of truth shared
 * by the api-server (AI assistant chronology "spine") and the portal (member
 * campaign checklist page).
 *
 * The step/substep wording is LOCKED canonical content — do not reword it
 * beyond light punctuation. Ordering and branching facts here are
 * authoritative for the AI assistant.
 *
 * GOLDEN RULES (do not break):
 *   - Every step `id` and substep `substepId` is a STABLE key. The member
 *     checklist persists per-member checked state keyed by substepId, so
 *     wording edits or reordering must NEVER change an existing id. Never key
 *     anything off display text or array index.
 *   - `network` tags mark branch-specific substeps: "media-mavens" [MM] vs
 *     "clickbank" [CB]. Untagged substeps apply to both networks.
 */

export type CampaignPhase = "build" | "test" | "scale";

export type CampaignNetwork = "media-mavens" | "clickbank";

/**
 * OPTIONAL member-display copy for a substep. This layer is rendered ONLY by
 * the member checklist page. It is NEVER read by `renderCampaignSpine()` —
 * the AI assistant sees canonical wording exclusively.
 */
export interface SubstepMemberCopy {
  /** Member-facing replacement for `action` (both networks). */
  action?: string;
  /** Per-network member-facing replacement for `action`; wins over `action`. */
  actionByNetwork?: Partial<Record<CampaignNetwork, string>>;
  /**
   * Hide this substep from the member view entirely. If hiding leaves a step
   * with NO visible member lines, the step renders as a single checkbox whose
   * checked state is keyed by the hidden substeps' canonical ids (keys stay
   * stable; only presentation changes).
   */
  hidden?: boolean;
  /**
   * Substeps sharing the same mergeGroup render as ONE member-facing line
   * (the first group member's display action). Checking the line checks ALL
   * canonical keys in the group; the line shows checked if ANY key is checked
   * (legacy-progress friendly).
   */
  mergeGroup?: string;
}

/** OPTIONAL member-display copy for a step (checklist page only, never AI). */
export interface StepMemberCopy {
  /** Member-facing replacement for `title`. */
  title?: string;
  /** Member-facing replacement for `description` (both networks). */
  description?: string;
  /** Per-network member-facing description; wins over `description`. */
  descriptionByNetwork?: Partial<Record<CampaignNetwork, string>>;
}

export interface CampaignSubstep {
  /** Stable key — persisted in member checklist progress. NEVER change. */
  substepId: string;
  /** The action line (locked wording). */
  action: string;
  /** Branch tag: substep applies only to this affiliate network. */
  network?: CampaignNetwork;
  /** Member-display overrides — NEVER read by the spine renderer. */
  member?: SubstepMemberCopy;
}

export interface CampaignStep {
  /** Stable key. NEVER change. */
  id: string;
  /** 1-based position in the 17-step chronology. */
  number: number;
  phase: CampaignPhase;
  /** Short step title (locked wording). */
  title: string;
  /** Optional constraint/description line (locked wording). */
  description?: string;
  substeps: CampaignSubstep[];
  /** Member-display overrides — NEVER read by the spine renderer. */
  member?: StepMemberCopy;
}

export const CAMPAIGN_PHASE_LABELS: Record<CampaignPhase, string> = {
  build: "Phase 1 — Build",
  test: "Phase 2 — Test",
  scale: "Phase 3 — Scale",
};

export const CAMPAIGN_STEP_COUNT = 17;

/**
 * The canonical 17-step BTS campaign chronology.
 */
export const CAMPAIGN_ROADMAP: readonly CampaignStep[] = [
  {
    id: "orient",
    number: 1,
    phase: "build",
    title: "Orient",
    description: "Start with the 7 Pillars and the three-phase path (Build → Test → Scale).",
    substeps: [],
  },
  {
    id: "know-the-gates",
    number: 2,
    phase: "build",
    title: "Know the gates",
    description:
      "Each phase has an exit gate; know the testing budgets before you start; compliance approval is required before any ad creative or landing page creative runs.",
    substeps: [],
  },
  {
    id: "choose-network",
    number: 3,
    phase: "build",
    title: "Choose your network",
    description:
      "Media Mavens or ClickBank. This choice changes how you'll build your landing page assets, Flexy website, MetricMover split test, and DIYTrax setup.",
    substeps: [],
    member: {
      descriptionByNetwork: {
        "media-mavens":
          "You've selected Media Mavens — the steps below are tailored to it.",
        clickbank: "You've selected ClickBank — the steps below are tailored to it.",
      },
    },
  },
  {
    id: "select-offer",
    number: 4,
    phase: "build",
    title: "Select your offer & get your affiliate link",
    description:
      "The affiliate link is required later for the DIYTrax Offer Pages tab when you complete your DIYTrax setup.",
    substeps: [
      {
        substepId: "select-offer-review-presell",
        action:
          "Review the presell page for the offer: the advertorial [MM] or the VSL [CB].",
        member: {
          actionByNetwork: {
            "media-mavens": "Review the advertorial for the offer.",
            clickbank: "Review the VSL for the offer.",
          },
        },
      },
    ],
  },
  {
    id: "finalize-angles",
    number: 5,
    phase: "build",
    title: "Finalize your angles",
    description:
      "5 angles, extracted from the advertorial/VSL and customer avatar research; done first — your native ad assets and landing page assets build on them.",
    substeps: [],
    member: {
      descriptionByNetwork: {
        "media-mavens":
          "5 angles, extracted from the advertorial and customer avatar research; done first — your native ad assets and landing page assets build on them.",
        clickbank:
          "5 angles, extracted from the VSL and customer avatar research; done first — your native ad assets and landing page assets build on them.",
      },
    },
  },
  {
    id: "create-ad-assets",
    number: 6,
    phase: "build",
    title: "Create native ad assets",
    description: "~10 ad headlines + 1 description + ad image.",
    substeps: [],
  },
  {
    id: "create-lp-assets",
    number: 7,
    phase: "build",
    title: "Create landing page assets",
    description: "5 LP headlines + 5 hero shots (both networks).",
    member: { description: "5 LP headlines + 5 hero shots." },
    substeps: [
      {
        substepId: "create-lp-assets-cb-bridge-copy",
        action:
          "Capture the VSL/transcript, then generate base-page copy plus a control headline/subheadline and hero shot via the Bridge Page Copy Bot.",
        network: "clickbank",
      },
      {
        substepId: "create-lp-assets-mm-advertorial-copy",
        action:
          "Landing-page copy comes from the pre-built advertorial (optimized later when you set up your website in Flexy).",
        network: "media-mavens",
        member: { hidden: true },
      },
    ],
  },
  {
    id: "submit-compliance",
    number: 8,
    phase: "build",
    title: "Submit for compliance review",
    description:
      "Submit all creatives. Compliance blocks publishing/go-live only; you can keep building your DIYTrax campaign and Flexy website while you wait.",
    substeps: [],
  },
  {
    id: "create-diytrax-campaign",
    number: 9,
    phase: "build",
    title: "Create your DIYTrax campaign",
    substeps: [
      {
        substepId: "create-diytrax-campaign-create",
        action: "Create the campaign in DIYTrax.",
        member: {
          mergeGroup: "diytrax-create-basic-info",
          action: "Create the campaign in DIYTrax and fill in the Basic Info tab (and save).",
        },
      },
      {
        substepId: "create-diytrax-campaign-basic-info",
        action: "Fill in the Basic Info tab (and save).",
        member: { mergeGroup: "diytrax-create-basic-info" },
      },
      {
        substepId: "create-diytrax-campaign-flexy-custom-values",
        action:
          "One-time global setup: copy the T2 landing-page URL from the Links & Pixels tab and paste it into Flexy Custom Values.",
        member: {
          action:
            "One-time global setup: copy the T2 landing-page URL from the Links & Pixels tab in your DIYTrax campaign and paste it into Flexy Custom Values.",
        },
      },
    ],
  },
  {
    id: "flexy-website",
    number: 10,
    phase: "build",
    title: "Set up your website in Flexy",
    substeps: [
      {
        substepId: "flexy-website-clone-site",
        action: "Clone the site → create a subdomain → connect the subdomain to the cloned site.",
      },
      {
        substepId: "flexy-website-mm-clone-advertorial",
        action: "Clone the advertorial page for your offer.",
        network: "media-mavens",
      },
      {
        substepId: "flexy-website-cb-clone-template",
        action: "Clone a template and format it to be ready for your base-page copy.",
        network: "clickbank",
      },
      {
        substepId: "flexy-website-optimize-page",
        action:
          "Optimize the page for desktop and mobile: font size/style, headline/subheadline/hero-shot element spacing.",
      },
    ],
  },
  {
    id: "metricmover-split-test",
    number: 11,
    phase: "build",
    title: "Build your landing page split test in MetricMover",
    description:
      "Requires your formatted Flexy page and your compliance-approved assets.",
    substeps: [
      {
        substepId: "metricmover-split-test-cb-fill-copy",
        action:
          "Fill the page with your approved base-page copy, control headline/subheadline, and hero shot.",
        network: "clickbank",
      },
      {
        substepId: "metricmover-split-test-mm-page",
        action: 'Create a blank "MM" page with a custom code box in Flexy.',
        member: {
          action: "Create a blank MetricMover page with a custom code box in Flexy.",
        },
      },
      {
        substepId: "metricmover-split-test-build-5x5",
        action: "Build the 5×5 (25 combinations) in MetricMover.",
      },
      {
        substepId: "metricmover-split-test-embed-publish",
        action: 'Paste the MetricMover embed code into the Flexy "MM" page and publish.',
      },
    ],
  },
  {
    id: "complete-diytrax-setup",
    number: 12,
    phase: "build",
    title: "Complete your DIYTrax setup",
    substeps: [
      {
        substepId: "complete-diytrax-setup-landing-pages-tab",
        action:
          "Landing Pages tab: import the MetricMover (trax-import) CSV; all active, equal share; auto-optimization off.",
      },
      {
        substepId: "complete-diytrax-setup-offer-pages-tab",
        action: "Offer Pages tab: add your offer link with your affiliate ID at 100%.",
      },
      {
        substepId: "complete-diytrax-setup-cb-enable-ipn",
        action: "Enable IPN so sales are recorded.",
        network: "clickbank",
      },
    ],
  },
  {
    id: "caterpillar-go-live",
    number: 13,
    phase: "build",
    title: "Configure Caterpillar & go live",
    substeps: [
      {
        substepId: "caterpillar-go-live-traffic-source-tab",
        action:
          "Configure the Traffic Source tab for Caterpillar: select product, create subcampaigns, create ads.",
      },
      {
        substepId: "caterpillar-go-live-qa",
        action:
          "QA before going live: all DIYTrax settings, full-funnel click-through using the campaign URL, all ads in approved status.",
      },
    ],
  },
  {
    id: "round-1-headline-test",
    number: 14,
    phase: "test",
    title: "Round 1 — headline test",
    description: "Prepare Round 2 image assets while Round 1 runs.",
    substeps: [],
  },
  {
    id: "round-2-image-test",
    number: 15,
    phase: "test",
    title: "Round 2 — image (visual creative) test",
    substeps: [],
  },
  {
    id: "round-3-placement-test",
    number: 16,
    phase: "test",
    title: "Round 3 — placement test",
    substeps: [],
  },
  {
    id: "scale",
    number: 17,
    phase: "scale",
    title: "Scale",
    description:
      "Only after Rounds 1–3 are complete and the campaign is profitable. Order: increase budget on the winning placement → expand to new placements/publishers (Grasshopper, Crane) → Master Publisher after 14+ consecutive profitable days.",
    substeps: [],
  },
];

/* ------------------------------------------------------------------------ *
 * Member-display copy layer (checklist page ONLY — never the AI spine).
 * ------------------------------------------------------------------------ */

/** Effective member-facing step title (fallback to canonical). */
export function memberStepTitle(step: CampaignStep): string {
  return step.member?.title ?? step.title;
}

/** Effective member-facing step description (per-network > shared > canonical). */
export function memberStepDescription(
  step: CampaignStep,
  network: CampaignNetwork | null,
): string | undefined {
  if (network !== null) {
    const byNetwork = step.member?.descriptionByNetwork?.[network];
    if (byNetwork !== undefined) return byNetwork;
  }
  return step.member?.description ?? step.description;
}

/** Effective member-facing substep action (per-network > shared > canonical). */
export function memberSubstepAction(
  sub: CampaignSubstep,
  network: CampaignNetwork | null,
): string {
  if (network !== null) {
    const byNetwork = sub.member?.actionByNetwork?.[network];
    if (byNetwork !== undefined) return byNetwork;
  }
  return sub.member?.action ?? sub.action;
}

/**
 * One member-facing checkable line. May represent SEVERAL canonical substeps
 * (merge groups): checking the line checks every key; the line counts as
 * checked when ANY key is checked.
 */
export interface MemberChecklistItem {
  /** All canonical persisted keys this line represents (>= 1). */
  keys: string[];
  /** Stable primary key (first canonical key) — use for list identity/testids. */
  primaryKey: string;
  /** The member-facing display text. */
  action: string;
}

/** Substeps eligible for this network (shared + own branch), member-hidden included. */
function networkEligibleSubsteps(
  step: CampaignStep,
  network: CampaignNetwork | null,
): CampaignSubstep[] {
  return step.substeps.filter(
    (s) => s.network === undefined || (network !== null && s.network === network),
  );
}

/**
 * The member-facing checkable lines of a step: network-filtered, member-hidden
 * substeps removed, merge groups collapsed into a single line.
 */
export function memberChecklistItems(
  step: CampaignStep,
  network: CampaignNetwork | null,
): MemberChecklistItem[] {
  const visible = networkEligibleSubsteps(step, network).filter((s) => !s.member?.hidden);
  const items: MemberChecklistItem[] = [];
  const groupIndex = new Map<string, number>();
  for (const sub of visible) {
    const group = sub.member?.mergeGroup;
    if (group !== undefined && groupIndex.has(group)) {
      items[groupIndex.get(group)!].keys.push(sub.substepId);
      continue;
    }
    if (group !== undefined) groupIndex.set(group, items.length);
    items.push({
      keys: [sub.substepId],
      primaryKey: sub.substepId,
      action: memberSubstepAction(sub, network),
    });
  }
  return items;
}

/**
 * The canonical persisted keys backing a step in the member view. For steps
 * whose visible member lines all got hidden (e.g. the MM landing-page-assets
 * note), the hidden substeps' keys back the step's single checkbox — keys
 * never change with presentation.
 */
export function memberStepKeys(
  step: CampaignStep,
  network: CampaignNetwork | null,
): string[] {
  if (step.substeps.length === 0) return [step.id];
  const eligible = networkEligibleSubsteps(step, network);
  const visible = eligible.filter((s) => !s.member?.hidden);
  return (visible.length > 0 ? visible : eligible).map((s) => s.substepId);
}

/**
 * Canonical substep-id groups that render as ONE member-facing line. The
 * checklist API uses this to normalize legacy per-substep checked state:
 * if ANY id in a group is checked, ALL ids in the group are checked.
 */
export const MEMBER_MERGED_KEY_GROUPS: readonly (readonly string[])[] = (() => {
  const byGroup = new Map<string, string[]>();
  for (const step of CAMPAIGN_ROADMAP) {
    for (const sub of step.substeps) {
      const group = sub.member?.mergeGroup;
      if (group === undefined) continue;
      const list = byGroup.get(group) ?? [];
      list.push(sub.substepId);
      byGroup.set(group, list);
    }
  }
  return Array.from(byGroup.values()).filter((g) => g.length > 1);
})();

/** Header line of the rendered spine block (also referenced by prompt rules). */
export const CAMPAIGN_SPINE_HEADER = "## BTS Campaign Roadmap (Authoritative Chronology)";

const NETWORK_TAG: Record<CampaignNetwork, string> = {
  "media-mavens": "[MM]",
  clickbank: "[CB]",
};

/**
 * Render the compact prompt "spine" block from the roadmap module. Appended to
 * the chat assistant's system prompt at runtime on EVERY request — kept in the
 * ~500–600 token range. Numbered steps under phase headers, substeps folded as
 * terse sub-lines, [MM]/[CB] branch tags preserved.
 */
export function renderCampaignSpine(): string {
  const lines: string[] = [
    CAMPAIGN_SPINE_HEADER,
    "Authoritative 17-step BTS campaign chronology: ordering, prerequisites, phases, network branching. [MM]=Media Mavens, [CB]=ClickBank; untagged lines apply to both networks.",
    "The list numbers below are INTERNAL ordering markers only — never surface them to members. Refer to steps by phase + title (per the campaign-step naming rule).",
  ];

  let currentPhase: CampaignPhase | null = null;
  for (const step of CAMPAIGN_ROADMAP) {
    if (step.phase !== currentPhase) {
      currentPhase = step.phase;
      lines.push(`### ${CAMPAIGN_PHASE_LABELS[currentPhase]}`);
    }
    const desc = step.description ? ` — ${step.description}` : "";
    lines.push(`${step.number}. ${step.title}${desc}`);
    for (const sub of step.substeps) {
      const tag = sub.network ? `${NETWORK_TAG[sub.network]} ` : "";
      lines.push(`  - ${tag}${sub.action}`);
    }
  }

  return lines.join("\n");
}
