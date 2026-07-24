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

export interface CampaignSubstep {
  /** Stable key — persisted in member checklist progress. NEVER change. */
  substepId: string;
  /** The action line (locked wording). */
  action: string;
  /** Branch tag: substep applies only to this affiliate network. */
  network?: CampaignNetwork;
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
      },
      {
        substepId: "create-diytrax-campaign-basic-info",
        action: "Fill in the Basic Info tab (and save).",
      },
      {
        substepId: "create-diytrax-campaign-flexy-custom-values",
        action:
          "One-time global setup: copy the T2 landing-page URL from the Links & Pixels tab and paste it into Flexy Custom Values.",
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
