import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import {
  BLITZ_SECTION_TO_NODE,
  type Ceiling,
  type HandoffTarget,
} from "./kb-taxonomy";

/**
 * Process root content (Task #4a — Process Truth-Doc Content Campaign).
 *
 * Authors the human-verified curated/overview truth docs for the **Process**
 * root — the step-by-step of building and running a BTS campaign. Content is
 * drawn from the clean, structured training-video corpus (`video-transcripts.txt`,
 * ~1:1 with the Blitz lessons), rewritten as member-facing truth: stale brand /
 * product / portal-navigation references are translated to the current BTS terms
 * (e.g. "Flexi" → "Flexy", "DIY Tracks" → "DIYTrax", legacy company → BTS), while
 * in-app navigation (how you click around inside Flexy / DIYTrax / Caterpillar)
 * is preserved unchanged — the rule from foundation §8.1.
 *
 * Every doc is curated/overview, member-facing, stamped with a FIXED authored
 * verification date so it is immediately citable
 * ({@link "./kb-citable-filter"}: doc_class citable + last_verified NOT NULL)
 * while the freshness/aging clock stays stable across re-runs. Each doc carries
 * its Process node, the relevant concept/tool tags, and a Blitz curriculum
 * section mapping (guarded by the test against BLITZ_SECTION_TO_NODE).
 *
 * Ordering follows demand WITHIN the Process root: the highest-traffic gaps
 * (the DIYTrax overview, Flexy, MetricMover, Caterpillar/go-live) are authored
 * so the day-one no-answer window shrinks fastest. Every one of the eight
 * Process nodes gets at least one verified doc.
 *
 * Reaches production only on boot (prod is a separate DB the agent cannot
 * write). Idempotent: keyed on title, only rewrites rows whose content/taxonomy
 * actually differs, and never resets last_verified on re-run.
 */

// Fixed authored-verification date. Keep stable so the §8.5 aging signal works
// and re-runs never reset the clock. Bump ONLY when the truth is re-verified.
const PROCESS_VERIFIED_AT = "2026-06-26T00:00:00.000Z";

interface ProcessDoc {
  title: string;
  slug: string;
  node: string;
  docClass: "curated" | "overview";
  ceiling: Ceiling;
  handoff: HandoffTarget;
  tags: string[];
  /** Blitz curriculum section id (1..23) this doc hugs; must map to `node`. */
  blitzSection: number;
  content: string;
  sourcePath: string;
  sourceLabel: string;
}

// ── foundations (Blitz 1–3) ────────────────────────────────────────────────

function buildSystemOverviewDoc(): ProcessDoc {
  const content = [
    "How Affiliate Arbitrage Works — System Overview",
    "",
    "Affiliate arbitrage is the core BTS model. You run ads on a traffic source, send the clicks to a landing page you control, and that page sends the clicks on to a sales page the offer owner controls. When someone buys on that sales page, the offer owner pays you a commission.",
    "",
    "Your profit is the arbitrage — the spread: commissions earned minus ad spend. If you make more in commissions than you spend on ads, the gap is your profit.",
    "",
    "The BTS funnel has three steps:",
    "1. The ad (a display banner or native ad) — the beginning of the story that earns the click.",
    "2. The landing page (an advertorial on Media Mavens, or a jump/bridge page on ClickBank) — the middle of the story that pre-sells.",
    "3. The offer / sales page (an e-commerce product page on Media Mavens, or a VSL on ClickBank) — where the purchase happens and your commission is earned.",
    "",
    "You run on one of two networks:",
    "- Media Mavens (BTS's internal network): flat CPA payouts with no clawbacks on refunds/chargebacks, and a proven advertorial is provided to start. Often the lighter lift for newer members.",
    "- ClickBank (a long-established third-party network): revenue-share, so refunds/chargebacks can claw back commissions, and you build the bridge/VSL landing pages yourself.",
    "",
    "Whichever you choose, the shape is the same: set up ads, point them at a landing page, drive that traffic to a sales page, and collect commissions on the purchases.",
  ].join("\n");

  return {
    title: "How Affiliate Arbitrage Works — System Overview",
    slug: "process-affiliate-arbitrage-overview",
    node: "foundations",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["funnel", "offer", "media-mavens", "clickbank"],
    blitzSection: 1,
    content,
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildThreePhasesDoc(): ProcessDoc {
  const content = [
    "The Three Phases — Build, Test, Scale",
    "",
    "The Blitz walks you through one campaign in three phases. Work them in order; each phase has a gate you clear before moving on.",
    "",
    "Phase 1 — Build: pick your network and offer, create your ad and landing-page assets, pass compliance review, set up your site in Flexy, set up tracking in DIYTrax, and configure your traffic source to go live. This is the setup phase — the goal is a clean, live campaign.",
    "",
    "Phase 2 — Test: spend in structured rounds to find your winners from the data. Round 1 finds your top headline, Round 2 your top visual creative, and Round 3 your top placement format. You let each round run to its minimum spend so the data is meaningful before you judge it.",
    "",
    "Phase 3 — Scale: once you have a proven winner, grow it — increase budget on your top placement, test new placements and publishers, and graduate to master-publisher scaling.",
    "",
    "Budget matters at every phase. Testing requires real spend (the rounds have minimums) because you are buying data. Don't expect to judge a campaign before it has spent enough to tell you anything. For account-specific budget and 'is my campaign ready to scale' decisions, bring your numbers to a coaching call.",
  ].join("\n");

  return {
    title: "The Three Phases — Build, Test, Scale",
    slug: "process-three-phases",
    node: "foundations",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["budget", "testing", "scaling"],
    blitzSection: 2,
    content,
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

// ── network-and-offer (Blitz 4–5) ──────────────────────────────────────────

function buildChooseNetworkDoc(): ProcessDoc {
  const content = [
    "Choosing Your Affiliate Network — Media Mavens vs ClickBank",
    "",
    "Step one of building a campaign is choosing which affiliate network to run on. In the portal, open Affiliate Networks (under Resources) to see your two options: Media Mavens and ClickBank.",
    "",
    "Media Mavens — BTS's internal network:",
    "- Flat CPA payouts: you're paid a set commission per sale with no clawbacks against you for refunds or chargebacks.",
    "- A proven advertorial is provided, so it's often the lighter lift to start.",
    "- Access is exclusive to BTS members.",
    "- To use it, open the Media Mavens page from Affiliate Networks, complete the one-time onboarding (name, email, time zone, address — the optional info can be skipped), and you're in. After the first login it takes you straight to your dashboard.",
    "",
    "ClickBank — a long-established third-party network (BTS is not affiliated with them):",
    "- Revenue-share, not flat CPA — so when a customer refunds or charges back, ClickBank claws those commissions back out of your account.",
    "- Everyone has access to ClickBank; you'll typically browse the marketplace in the health niche sorted by gravity (high to low).",
    "- You build your own bridge/VSL landing pages.",
    "",
    "If you're newer to media buying, Media Mavens is often the easier starting point because of the provided advertorial and the no-clawback CPA. Either way, choose the network first, because it determines how you build the rest of the funnel.",
  ].join("\n");

  return {
    title: "Choosing Your Affiliate Network — Media Mavens vs ClickBank",
    slug: "process-choose-network",
    node: "network-and-offer",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["offer", "media-mavens", "clickbank"],
    blitzSection: 4,
    content,
    sourcePath: "/affiliate-networks",
    sourceLabel: "Affiliate Networks",
  };
}

function buildSelectOfferDoc(): ProcessDoc {
  const content = [
    "Selecting Your Offer and Getting Your Affiliate Link",
    "",
    "Once you've picked your network, choose a specific offer to promote and grab your affiliate link.",
    "",
    "On Media Mavens:",
    "- Open the Media Mavens page from Affiliate Networks and browse the offer categories — they're added to regularly. Expand a category, or click View Offer on a product that interests you to jump to its offer card.",
    "- The offer card shows an image of the offer page, a description, a link to preview the live sales page in a new tab, the consumer price, and the affiliate commission.",
    "- Your affiliate link is right there on the offer card. The letters/numbers on the end are your ref code — that's what credits the sale to your account. You don't need to leave for the Media Mavens dashboard to get it; the same link with the same ref code is available right on the offer card.",
    "- Commission and price vary a lot between products, so pick an offer you understand and would feel comfortable advertising — ideally one where you're in (or close to) the target market.",
    "",
    "On ClickBank:",
    "- Browse the marketplace (usually health, sorted by gravity high to low) and choose an offer, then get your ClickBank affiliate (hoplink) for it.",
    "",
    "Choosing the offer is a marketing decision as much as a setup step — your angle has to fit the product. If you want help deciding whether an offer is a good fit for you, bring it to a coaching call.",
  ].join("\n");

  return {
    title: "Selecting Your Offer and Getting Your Affiliate Link",
    slug: "process-select-offer",
    node: "network-and-offer",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["offer", "media-mavens", "clickbank"],
    blitzSection: 5,
    content,
    sourcePath: "/affiliate-networks",
    sourceLabel: "Affiliate Networks",
  };
}

// ── creative-assets (Blitz 6–9) ────────────────────────────────────────────

function buildCreativeAssetsOverviewDoc(): ProcessDoc {
  const content = [
    "Creative Assets Overview — Ads, Advertorials, and Landing Pages",
    "",
    "Your campaign needs three kinds of creative, one for each step of the funnel:",
    "1. The ad (a display banner or native ad) — the first point of contact. It has to capture attention and earn the click within seconds, and it's the most-seen part of the funnel, so it fatigues fastest and needs the most fresh variants.",
    "2. The landing page (an advertorial on Media Mavens, or a jump/bridge page on ClickBank) — the middle of the story that pre-sells before the offer.",
    "3. The offer/sales page — created and optimized by the offer owner; you drive traffic to it.",
    "",
    "The parts of an ad, in order of impact on conversion:",
    "- Ad angle (~70%): the single biggest lever — how all the elements work together to start the story. Get the angle right and the metrics follow.",
    "- Headline (~15%).",
    "- Image (~10%).",
    "- Supporting copy (~5%).",
    "- Layout / call-to-action: minor; useful to vary when testing.",
    "",
    "Because the ad angle dominates, that's where most of your creative thinking goes. A good rule: pull your angles from the advertorial — read it line by line and find the ideas, then build ads that stay congruent with what the visitor sees next on the page.",
    "",
    "Where the work happens: you build and edit landing pages in Flexy, create banner variants with the BTS banner tools, and split-test page elements with MetricMover. Crafting strong angles and headlines is a marketing skill — for deeper help developing them, that's a coaching topic.",
  ].join("\n");

  return {
    title: "Creative Assets Overview — Ads, Advertorials, and Landing Pages",
    slug: "process-creative-assets-overview",
    node: "creative-assets",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["creative", "native-ad", "landing-page", "angle", "headline"],
    blitzSection: 6,
    content,
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildFlexyDoc(): ProcessDoc {
  const content = [
    "Building Your Landing Pages in Flexy",
    "",
    "Flexy is the BTS drag-and-drop landing page builder. You build and edit your landing pages with your mouse — no code — using a library of templates, and pages scale automatically to look right on phones and tablets. In the BTS funnel, Flexy is where you build the middle of your funnel: your advertorial (Media Mavens) or your jump/bridge page (ClickBank).",
    "",
    "Open Flexy from the Apps page in the portal.",
    "",
    "Typical Flexy workflow in the Blitz:",
    "- Start from a provided base page/template, then clone it to create your landing page and additional variants for testing.",
    "- Edit the headline and hero shot, then make further page edits to fit your angle and offer.",
    "- Gather the URLs of your page variants so you can add them to your DIYTrax campaign for rotation/testing.",
    "",
    "Connecting a domain in Flexy:",
    "- In Flexy, go to Settings → Domains → Connect domain, and connect the domain to your funnel website.",
    "- Use the BTS template domain that matches what you're running (for example a consumerwatchdog.io subdomain for the consumer-watchdog template, or a thecuttingedge.today subdomain for the cutting-edge template). Pick a subdomain that's unique to you — don't copy the example text.",
    "- After entering the subdomain, choose 'add record manually', click 'verify records', and wait up to ~30 seconds for it to verify. Then connect it to your website.",
    "",
    "How you click around inside Flexy is the same as it's always been; only how you reach Flexy from the portal (the Apps page) is current. For a step Flexy won't resolve, open Support.",
  ].join("\n");

  return {
    title: "Building Your Landing Pages in Flexy",
    slug: "process-flexy-landing-pages",
    node: "creative-assets",
    docClass: "curated",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["landing-page", "flexy", "creative"],
    blitzSection: 8,
    content,
    sourcePath: "/apps",
    sourceLabel: "Apps",
  };
}

// ── compliance (Blitz 10) ──────────────────────────────────────────────────

function buildComplianceDoc(): ProcessDoc {
  const content = [
    "Submitting Your Assets for Compliance Review",
    "",
    "Before your ads and landing-page copy go live, they go through BTS compliance review. This protects your account and your traffic sources from being shut down over non-compliant claims.",
    "",
    "Where to submit: open Compliance Review from the portal (under Tools & Apps). Submit your ad-banner split-test media and your advertorial split-test media for review there.",
    "",
    "What to expect:",
    "- Submit the creative variants you intend to run (banners and advertorial/landing-page copy).",
    "- Wait for the review outcome before launching those assets in your live campaign.",
    "- If something is flagged, revise the flagged claim/element and resubmit.",
    "",
    "Compliance is a required gate in Phase 1 — don't skip ahead to going live with unreviewed creative. If a submission is stuck or you're unsure why something was flagged, open Support.",
  ].join("\n");

  return {
    title: "Submitting Your Assets for Compliance Review",
    slug: "process-compliance-review",
    node: "compliance",
    docClass: "curated",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["compliance", "creative"],
    blitzSection: 10,
    content,
    sourcePath: "/compliance",
    sourceLabel: "Compliance Review",
  };
}

// ── tracking-and-setup (Blitz 11–13) ───────────────────────────────────────

function buildDiytraxOverviewDoc(): ProcessDoc {
  const content = [
    "DIYTrax Overview — Tracking, Testing & Optimizing Your Campaigns",
    "",
    "DIYTrax is the BTS URL and landing-page rotator and tracker. It's where you track, test, and optimize your campaigns across traffic sources, and it's the hub that ties your ads, landing pages, and offers together so you can see what's actually working.",
    "",
    "What it does:",
    "- Creates multiple campaign types: direct-link, landing-page, multi-path, and multi-option campaigns.",
    "- Rotates and tests your landing-page variants and offers, so you can find winners by data.",
    "- Gives in-depth analytics across ads, keywords, pages, and offers, plus revenue data — so you optimize toward profit, not guesses.",
    "- Lets you add new pages or edit offers in your rotation without touching code, and adjust the rotation in real time.",
    "",
    "Where it fits in the Blitz:",
    "- After you build your landing pages in Flexy, you set up a DIYTrax campaign and add your landing-page variant URLs to it for rotation.",
    "- During testing, DIYTrax is where you read the data that tells you your winning headline, creative, and placement.",
    "- MetricMover split-test variations integrate into DIYTrax: you upload your variations and rotate through them to pinpoint winners.",
    "",
    "Open DIYTrax from the Apps page in the portal. How you work inside DIYTrax is unchanged from the training; only how you reach it from the portal (the Apps page) is current. For a specific setup step (for example placing your affiliate link in a campaign offer page, configuring a traffic source, or a final QA check), follow the matching Blitz lesson; if DIYTrax itself isn't behaving, open Support.",
  ].join("\n");

  return {
    title: "DIYTrax Overview — Tracking, Testing & Optimizing Your Campaigns",
    slug: "process-diytrax-overview",
    node: "tracking-and-setup",
    docClass: "overview",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["tracking", "diytrax", "testing"],
    blitzSection: 12,
    content,
    sourcePath: "/apps",
    sourceLabel: "Apps",
  };
}

function buildMetricMoverDoc(): ProcessDoc {
  const content = [
    "MetricMover Overview — Landing Page Split Testing",
    "",
    "MetricMover is the BTS landing-page split tester. It lets you create many split-test variations of a page quickly and rotate through them to find the winners — turning split testing from a tedious manual chore into a fast, repeatable edge.",
    "",
    "What you can test: any HTML element on your landing page — headlines, subheadlines, hero shots, lead paragraphs, calls to action, and whole layouts. If it's HTML, MetricMover can test it.",
    "",
    "How it fits with the rest of the stack:",
    "- You import your landing page into MetricMover, then create variants (for example headline variants and hero-shot variants).",
    "- Hero shots are uploaded to Flexy for use in MetricMover; the MetricMover code is embedded into your Flexy page.",
    "- MetricMover integrates with DIYTrax: you export your MetricMover campaign files, find the variant/code files, and import the page variants into DIYTrax so they rotate and you can read which variation wins.",
    "",
    "Open MetricMover from the Apps page in the portal. The in-app steps follow the MetricMover lessons in the Blitz; only the portal path to reach it (the Apps page) is current. If MetricMover itself isn't working, open Support.",
  ].join("\n");

  return {
    title: "MetricMover Overview — Landing Page Split Testing",
    slug: "process-metricmover-overview",
    node: "tracking-and-setup",
    docClass: "curated",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["testing", "metricmover", "landing-page"],
    blitzSection: 13,
    content,
    sourcePath: "/apps",
    sourceLabel: "Apps",
  };
}

// ── launch (Blitz 14) ──────────────────────────────────────────────────────

function buildCaterpillarGoLiveDoc(): ProcessDoc {
  const content = [
    "Configure Caterpillar and Go Live",
    "",
    "Caterpillar is the traffic source you configure to launch your campaign. Going live is the last step of Phase 1: with your offer chosen, creative approved by compliance, your Flexy pages built, and your DIYTrax campaign set up, you set up Caterpillar and turn the campaign on.",
    "",
    "Setting up the basic campaign info in Caterpillar:",
    "- Create a new campaign and give it a name you'll recognize — a useful convention is product + traffic source + test number (for example 'Posture Pillow Caterpillar Test 1').",
    "- Set the URL append token using only underscores — no spaces, dashes, or other punctuation (this matters especially for ClickBank, and it's a good habit either way).",
    "- Choose the offer promotion type: e-commerce for a Media Mavens product, or 'other' for ClickBank.",
    "- Set the traffic source to Caterpillar and select your affiliate network (Media Mavens or ClickBank).",
    "- Select the macro template that matches your traffic source (the Caterpillar macro template for Caterpillar), then save — the correct macro tokens are applied automatically.",
    "",
    "The full go-live sequence in the Blitz:",
    "- Configure your traffic source settings, upload your ad banners, and fund your traffic source.",
    "- Place your affiliate link in your DIYTrax campaign offer pages.",
    "- Run a final QA check on the whole campaign.",
    "- Submit your ad banners and turn the campaign toggle to active.",
    "",
    "After launch, expect the traffic source to take a little time to start delivering and to review your submitted banners. The in-app steps are the same as in the training; reach Caterpillar and the other apps from the Apps page. If something blocks your launch, open Support.",
  ].join("\n");

  return {
    title: "Configure Caterpillar and Go Live",
    slug: "process-caterpillar-go-live",
    node: "launch",
    docClass: "curated",
    ceiling: "troubleshooting",
    handoff: "support",
    tags: ["caterpillar", "tracking", "native-ad", "placement"],
    blitzSection: 14,
    content,
    sourcePath: "/apps",
    sourceLabel: "Apps",
  };
}

// ── testing (Blitz 15–20) ──────────────────────────────────────────────────

function buildTestingRoundsDoc(): ProcessDoc {
  const content = [
    "The Three Testing Rounds — Finding Your Winners",
    "",
    "Phase 2 is structured testing. You spend in rounds and let the data — read in DIYTrax — tell you what's working, one variable at a time. You don't judge a round before it reaches its minimum spend, because below that the numbers aren't meaningful yet.",
    "",
    "Round 1 — Find your top-performing headline (minimum ~$500): run your headline variants and let the data surface the winner.",
    "",
    "Between Rounds 1 and 2: while Round 1 runs, prepare additional static images so you're ready for the next round.",
    "",
    "Round 2 — Find your top-performing visual creative (minimum ~$500): test your images/creative against the winning headline.",
    "",
    "Between Rounds 2 and 3: prepare your Round 3 placement-format assets.",
    "",
    "Round 3 — Find your top-performing placement format (minimum ~$1,000): test placement formats to find the best one.",
    "",
    "Two common Round 1 situations to know:",
    "- If a campaign or banners turn off before reaching ~$1,500 in spend, there's a specific procedure to follow (covered in the Blitz lesson) rather than panicking or changing everything at once.",
    "- Know when to make a banner inactive — let the data, not impatience, drive the call.",
    "",
    "Testing is buying data, so it requires real budget and patience. For account-specific reads — 'is this enough data?', 'which of these is really my winner?' — bring your DIYTrax numbers to a coaching call.",
  ].join("\n");

  return {
    title: "The Three Testing Rounds — Finding Your Winners",
    slug: "process-testing-rounds",
    node: "testing",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["testing", "metrics", "budget", "creative", "headline"],
    blitzSection: 15,
    content,
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

// ── scaling (Blitz 21–23) ──────────────────────────────────────────────────

function buildScalingDoc(): ProcessDoc {
  const content = [
    "Scaling Your Winning Campaign — Three Methods",
    "",
    "Phase 3 is scaling: once testing has proven a winner, you grow it. There are three methods, used roughly in order as the campaign earns the right to more spend.",
    "",
    "Method 1 — Increase budget on your top-performing placement: take the placement that won in testing and raise its budget to push more profitable volume through it.",
    "",
    "Method 2 — Test new placements and publishers: expand beyond the proven placement by testing additional placements and publishers, carrying over what you learned.",
    "",
    "Method 3 — Master publisher: graduate to master-publisher scaling for your best performers.",
    "",
    "Scaling decisions are account-specific and depend on your real numbers — only scale what testing has actually proven, and scale in steps so you don't outrun your data. For a personal 'how and when should I scale this' read, bring your campaign metrics to a coaching call.",
  ].join("\n");

  return {
    title: "Scaling Your Winning Campaign — Three Methods",
    slug: "process-scaling-methods",
    node: "scaling",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["scaling", "budget", "placement", "metrics"],
    blitzSection: 21,
    content,
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

/**
 * Build the Process curated/overview docs, ordered by demand within the Process
 * root (highest-traffic gaps first: the DIYTrax overview, Flexy, MetricMover,
 * and the Caterpillar/go-live step lead).
 */
export function buildProcessDocs(): ProcessDoc[] {
  return [
    // Highest-demand tool/step gaps first.
    buildDiytraxOverviewDoc(),
    buildFlexyDoc(),
    buildMetricMoverDoc(),
    buildCaterpillarGoLiveDoc(),
    // Lifecycle coverage across the remaining Process nodes.
    buildSystemOverviewDoc(),
    buildThreePhasesDoc(),
    buildChooseNetworkDoc(),
    buildSelectOfferDoc(),
    buildCreativeAssetsOverviewDoc(),
    buildComplianceDoc(),
    buildTestingRoundsDoc(),
    buildScalingDoc(),
  ];
}

export async function seedProcessKb(): Promise<void> {
  const docs = buildProcessDocs();
  let upserted = 0;
  let errors = 0;

  for (const doc of docs) {
    const cleanTitle = scrubPrivateContent(doc.title);
    const cleanContent = scrubPrivateContent(doc.content);
    const tagsJson = JSON.stringify(doc.tags);
    try {
      await db.execute(
        sql`INSERT INTO knowledgebase_docs
              (title, category, content, audience, doc_class, slug, home_root, node,
               tags, blitz_section, ceiling, handoff, last_verified, source_path, source_label)
            VALUES
              (${cleanTitle}, 'process', ${cleanContent}, 'member', ${doc.docClass},
               ${doc.slug}, 'process', ${doc.node}, ${tagsJson}::jsonb, ${doc.blitzSection},
               ${doc.ceiling}, ${doc.handoff}, ${PROCESS_VERIFIED_AT}::timestamptz,
               ${doc.sourcePath}, ${doc.sourceLabel})
            ON CONFLICT (title) DO UPDATE SET
              category = EXCLUDED.category,
              content = EXCLUDED.content,
              audience = EXCLUDED.audience,
              doc_class = EXCLUDED.doc_class,
              slug = EXCLUDED.slug,
              home_root = EXCLUDED.home_root,
              node = EXCLUDED.node,
              tags = EXCLUDED.tags,
              blitz_section = EXCLUDED.blitz_section,
              ceiling = EXCLUDED.ceiling,
              handoff = EXCLUDED.handoff,
              source_path = EXCLUDED.source_path,
              source_label = EXCLUDED.source_label,
              updated_at = NOW()
            WHERE
              knowledgebase_docs.content IS DISTINCT FROM EXCLUDED.content
              OR knowledgebase_docs.doc_class IS DISTINCT FROM EXCLUDED.doc_class
              OR knowledgebase_docs.home_root IS DISTINCT FROM EXCLUDED.home_root
              OR knowledgebase_docs.node IS DISTINCT FROM EXCLUDED.node
              OR knowledgebase_docs.blitz_section IS DISTINCT FROM EXCLUDED.blitz_section
              OR knowledgebase_docs.ceiling IS DISTINCT FROM EXCLUDED.ceiling
              OR knowledgebase_docs.handoff IS DISTINCT FROM EXCLUDED.handoff
              OR knowledgebase_docs.tags IS DISTINCT FROM EXCLUDED.tags
              OR knowledgebase_docs.slug IS DISTINCT FROM EXCLUDED.slug
              OR knowledgebase_docs.source_path IS DISTINCT FROM EXCLUDED.source_path
              OR knowledgebase_docs.source_label IS DISTINCT FROM EXCLUDED.source_label`,
      );
      upserted++;
    } catch (err) {
      errors++;
      console.error(
        `[seed-process-kb] Error upserting "${doc.title}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-process-kb] Done. Processed: ${upserted}, Errors: ${errors}, Total: ${docs.length}`,
  );
}

// Re-exported so the Blitz→node consistency test can assert each doc's
// blitzSection maps to its declared Process node.
export { BLITZ_SECTION_TO_NODE };
