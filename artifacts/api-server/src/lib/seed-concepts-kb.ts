import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import type { Ceiling, HandoffTarget } from "./kb-taxonomy";

/**
 * Concepts & Skills root content (Task #4b, Bucket A→B — human-verified truth
 * mined from the coaching transcripts).
 *
 * Authors the marketing-craft truth docs for the `concepts` home root: angles,
 * headlines & copy, creative strategy, offer strategy, testing methodology,
 * scaling strategy, metrics & unit economics, and traffic & placements. The
 * content is synthesised from the strategic coaching-call transcripts
 * (`knowledge-base/coaching-transcripts.txt`) — the recorded record of what the
 * BTS coaches actually teach — then verified and rewritten into current BTS
 * voice (no coach/member names, no legacy brand/nav, no transcript verbatim).
 *
 * Every doc is curated/overview, member-facing, and stamped with a FIXED
 * authored verification date so it is immediately citable
 * ({@link "./kb-citable-filter"}: doc_class citable + last_verified NOT NULL)
 * while the §8.5 freshness/aging clock stays stable across re-runs.
 *
 * Depth ceiling: every concept doc carries ceiling `conceptual` + handoff
 * `coaching` — it explains the grounded fundamentals, but account-specific
 * strategy ("what should I do with MY campaign") hands off to live coaching, so
 * the assistant never guesses past what the corpus supports. Tool tags ride on
 * docs only where the tool is relational to the concept (the Flexy example in
 * the foundation §3.2), never as a silo.
 *
 * Reaches production only on boot (prod is a separate DB the agent cannot
 * write). Idempotent: keyed on title, only rewrites rows whose content/taxonomy
 * actually differs, and never resets last_verified on re-run.
 */

// Fixed authored-verification date. Keep stable so the §8.5 aging signal works
// and re-runs never reset the clock. Bump ONLY when the truth is re-verified.
const CONCEPTS_VERIFIED_AT = "2026-06-26T00:00:00.000Z";

interface ConceptsDoc {
  title: string;
  slug: string;
  node: string;
  docClass: "curated" | "overview";
  ceiling: Ceiling;
  handoff: HandoffTarget;
  tags: string[];
  content: string;
  sourcePath: string;
  sourceLabel: string;
}

// Standard handoff line appended to every concept doc — the depth ceiling made
// explicit in the body so the answer itself routes deeper strategy to coaching.
const COACHING_HANDOFF =
  "This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.";

function buildAnglesDoc(): ConceptsDoc {
  const lines = [
    "Angles — Finding What Makes People Buy",
    "",
    "An angle is the specific reason-to-buy you lead with — the emotional or practical motivation that makes a particular audience stop and pay attention. The same product can be sold from many different angles, and finding the angle that resonates is usually the single biggest lever on whether a campaign works.",
    "",
    "How to develop angles:",
    "1. Research the audience first. Build a clear persona — who they are, their motivations, their psychographics, the problem they're trying to solve. Your angles come out of that research, not out of guessing.",
    "2. Write several distinct angles per product, not variations of one. Different emotional drivers (fear of missing out, convenience, status, relief from a pain point) are different angles; reworded versions of the same idea are not.",
    "3. Let testing pick the winner. You don't decide which angle is best — the market does. Run them and read the data (see Testing Methodology).",
    "",
    "Once a winning angle is found:",
    "- Stop testing giant new concepts and switch to micro-tweaks — small iterations on the proven angle (different headlines for that angle, hero-image variants) usually beat starting over with a fresh, unproven angle, which costs more to validate.",
    "- A working angle can often be extended to adjacent sub-audiences (for example, the same angle aimed at a different segment of the same market) — a cheaper way to grow than inventing a brand-new angle.",
    "",
    "When to walk away from an angle: if an angle has had a fair, well-run test and the economics still aren't close, that's real signal. Sometimes the honest move is a fresh angle or a different product — but only after the current one has genuinely been given a chance with clean creative and headlines.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Angles — Finding What Makes People Buy",
    slug: "concepts-angles",
    node: "angles",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["angle", "audience", "copywriting"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildHeadlinesDoc(): ConceptsDoc {
  const lines = [
    "Headlines & Copy — Writing What Gets the Click",
    "",
    "The headline is the highest-leverage piece of copy you write. Most people who land on your page don't read everything — they skim. Their decision is driven mostly by the ad headline, then the first impression of the landing-page headline and image. Get those right and the rest of the copy is supporting cast.",
    "",
    "Core principles:",
    "- Congruence is everything. The ad headline, the landing-page headline, and the image should reinforce the same idea. When someone clicks an ad and immediately sees a page that confirms 'yes, I'm in the right place,' your landing-page click-through rate goes up.",
    "- Write in the native style. On native ad placements, headlines should read like editorial content the reader already trusts, not like a hard-sell ad. (AI tools can help draft in this style if you give them clear examples of the voice you want.)",
    "- Match the medium's attention span. Traffic from these placements is largely impulse-driven, so lead with the hook and get an interested reader toward the offer faster rather than burying the point.",
    "",
    "How to improve copy methodically:",
    "1. Test the ad headline and the landing-page headline as separate elements — a strong ad headline and a strong landing-page headline are two different jobs.",
    "2. Once a headline is winning, iterate on it with micro-tweaks rather than throwing it out — small wording changes that lift click-through and conversion.",
    "3. The sub-headline is often an untouched lever. After the main headline is working, the sub-headline is real estate you can test next to add congruence.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Headlines & Copy — Writing What Gets the Click",
    slug: "concepts-headlines-and-copy",
    node: "headlines-and-copy",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["headline", "hook", "copywriting", "conversion"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildCreativeStrategyDoc(): ConceptsDoc {
  const lines = [
    "Creative Strategy — Ads, Images & Landing Pages That Work Together",
    "",
    "Creative is the whole package a prospect experiences: the ad (image/video + headline), the landing page (advertorial) it sends them to, and how those pieces fit together. Strong creative isn't one clever image — it's congruence across the chain so each step confirms the last.",
    "",
    "The pieces and how they work together:",
    "- The ad creative (image or video) and ad headline do one job: earn the click from the right person.",
    "- The landing page (advertorial) does the next job: hold attention, build interest, and send a qualified visitor through to the offer page. Don't run cold traffic straight to the sales page — the advertorial is the warm-up that makes the offer convert. Landing pages in the BTS workflow are built in DIYtrax.",
    "- The image and the headline must agree. A hero image that matches the headline's promise creates the 'I'm in the right place' moment that lifts landing-page click-through.",
    "",
    "How to approach creative testing:",
    "1. Test broad concepts first (different images, different angles), then narrow to micro-tweaks once you have a winner — variants of the winning hero shot that 'pop' a little more.",
    "2. Give creative tests enough data before judging. A common mistake is killing a landing-page or image test too early, before the numbers mean anything.",
    "3. Read creative through its job in the funnel: ad creative is judged on ad click-through and cost-per-click; the landing page is judged on landing-page click-through to the offer.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Creative Strategy — Ads, Images & Landing Pages That Work Together",
    slug: "concepts-creative-strategy",
    node: "creative-strategy",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["creative", "landing-page", "native-ad", "diytrax"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildOfferStrategyDoc(): ConceptsDoc {
  const lines = [
    "Offer Strategy — Picking & Promoting the Right Product",
    "",
    "The offer is the product you promote and the page where the sale happens. The offer interacts with everything else: a higher-priced product with a bigger commission needs more ad spend to prove out, while a cheaper, impulse-friendly product can convert faster and is more forgiving while you learn.",
    "",
    "How to think about offers:",
    "- Commission vs. cost to convert. A larger commission is attractive, but a bigger-ticket product usually takes more spend before you see conversions, so it's a tougher product to learn on. Weigh the payout against how much it costs to get a buyer.",
    "- Impulse-friendly products are easier to start with. Evergreen products at an impulse price point convert more readily and let you build skill and data without burning a large budget per test.",
    "- The funnel is part of the offer. Your job is to get an interested, qualified visitor to the offer page; only a percentage of those will buy, so the economics depend on both the cost to reach the offer page and the offer page's own conversion rate.",
    "- Where offers come from. BTS members source offers through the supported affiliate networks (Media Mavens and ClickBank). Pick offers that fit your audience and the angle you can build around them.",
    "",
    "A note on terms: 'refund' in a media-buying context can mean a clawback when a customer returns the product you promoted — that's a normal part of affiliate economics and is different from a refund of your BTS membership.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Offer Strategy — Picking & Promoting the Right Product",
    slug: "concepts-offer-strategy",
    node: "offer-strategy",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["offer", "funnel", "conversion", "media-mavens", "clickbank"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildTestingMethodologyDoc(): ConceptsDoc {
  const lines = [
    "Testing Methodology — How BTS Runs Testing Rounds",
    "",
    "Testing is how you find what works without guessing. BTS runs it in structured rounds: start broad to find your winners, then narrow to refine them. The goal of the first round isn't profit — it's to get comfortable testing concepts and to surface the angle, headline, and image that resonate.",
    "",
    "Round 1 — find the winners:",
    "- Test broad concepts: a structured matrix (for example, several images against several headlines) so you can read which angle and which creative win.",
    "- Budget for signal. Plan a defined first-round ad spend (the BTS guides give the recommended figure per workflow — for example, the Caterpillar workflow recommends roughly $500 for the first round) and let each variant spend enough to be meaningful before you judge it.",
    "- Read the right metric. Landing-page-event cost-per-click is usually the driver for deciding what carries into the next round. Take the winning headline/creative forward.",
    "",
    "Round 2 and beyond — refine the winners:",
    "- Carry the round-1 winner forward and test the next layer (for example, placements, or vertical vs. horizontal sub-campaigns). Round-2 spend is typically a bit steeper because you're validating something that already shows promise.",
    "- Then switch to micro-tweaks: instead of testing giant new concepts, test small changes on the proven combination (sub-headline, hero-image variants) to push the numbers incrementally.",
    "",
    "Principles that hold throughout:",
    "- Change one thing at a time so you can attribute the result, and give each test enough data — don't kill tests too early.",
    "- Testing gets cheaper as you improve: moving from a deep loss toward break-even means you can keep testing at lower cost. Real validation comes when you try to scale, because what works in small pockets of traffic doesn't always hold as you expand.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Testing Methodology — How BTS Runs Testing Rounds",
    slug: "concepts-testing-methodology",
    node: "testing-methodology",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["testing", "creative", "caterpillar"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildScalingStrategyDoc(): ConceptsDoc {
  const lines = [
    "Scaling Strategy — Adding Budget Without Breaking the Campaign",
    "",
    "Scaling means increasing spend on a campaign that's already profitable — carefully, so you don't blow up the cost-per-acquisition (CPA) you worked to earn. The danger is that what works in small pockets of traffic doesn't always hold as you expand, so scale in controlled steps and watch the numbers.",
    "",
    "How to scale a max-conversions campaign:",
    "- Wait for the learning phase to finish before pushing budget. Scaling while a campaign is still learning causes wild CPA swings.",
    "- Raise budget in small steps, not leaps. A common guideline is increasing the daily budget by around 20% (some sources say 20–50%) every roughly 48 hours, so the campaign re-stabilises between increases. Don't jump from, say, $500 to $1,000 in one move.",
    "- If CPA climbs while scaling, a frequency cap (e.g. 2–3 impressions per user per day) can help control cost.",
    "",
    "Know a campaign's ceiling:",
    "- Some campaigns are profitable at one level (say $500/day) but lose it when pushed to $700 or $1,000 — that campaign may simply not have more scale in it, and that's a normal outcome, not a failure.",
    "- Profitability at a sustainable level beats chasing scale that breaks the economics. Hold the level that works, and use that profit to fund testing new angles for your next scalable campaign.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Scaling Strategy — Adding Budget Without Breaking the Campaign",
    slug: "concepts-scaling-strategy",
    node: "scaling-strategy",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["scaling", "budget", "metrics"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildMetricsDoc(): ConceptsDoc {
  const lines = [
    "Metrics & Unit Economics — Reading Your Numbers",
    "",
    "Every decision in a campaign comes back to the numbers. You don't judge creative, angles, or scaling by feel — you read the metrics down the funnel and act on what they say. This is an orientation to the metrics that matter and how they connect.",
    "",
    "The metrics, in funnel order:",
    "- Ad CTR (ad click-through rate): the percentage of people who see your ad and click it. Driven by the ad creative and ad headline.",
    "- Ad CPC (cost per click): what you pay for each click to your landing page. Influenced by placement and CPM.",
    "- Landing-page click-through rate: the percentage of landing-page visitors who continue to the offer page. Driven by landing-page headline/image congruence.",
    "- Landing-page-event CPC: the blended cost to get one qualified visitor to the offer page (it combines ad CPC and landing-page click-through). This is often the truest 'apples-to-apples' number for comparing placements.",
    "- Offer-page conversion rate: the percentage of offer-page visitors who buy.",
    "- CPA (cost per acquisition): what it costs you to get one sale. As a campaign matures, CPA is the number that matters most.",
    "- ROI / payout: your commission vs. your CPA. (BTS includes a metrics tool, MetricMover, to help track and calculate campaign numbers.)",
    "",
    "How to use them:",
    "- Compare placements on blended cost, not single metrics. A cheaper ad CPC can come with a lower landing-page click-through, so a 'cheap' placement isn't actually cheaper per qualified visitor — compare on landing-page-event CPC.",
    "- Expect data lag. Traffic-source figures like CPM and ad CTR refresh on a delay (roughly every few hours), so day-of numbers fluctuate and shouldn't be over-read in real time.",
    "- Be realistic on margins. A modest positive ROI is a real, workable result; outsized ROI on a competitive product is the exception, not the plan.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Metrics & Unit Economics — Reading Your Numbers",
    slug: "concepts-metrics-and-economics",
    node: "metrics-and-economics",
    docClass: "overview",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["metrics", "conversion", "budget", "metricmover"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

function buildTrafficPlacementsDoc(): ConceptsDoc {
  const lines = [
    "Traffic & Placements — Where Your Ads Run",
    "",
    "Placements are the spots where your ads appear across the native traffic network — different sizes, shapes, and formats on publisher sites. Choosing and comparing placements well is part of getting a campaign profitable, because the same creative performs differently depending on where it runs.",
    "",
    "What to know about placements:",
    "- Formats differ in cost and engagement. Video placements tend to be more expensive (higher CPC) but can bring a more engaged audience and a higher landing-page click-through. Vertical placements often have cheaper ad CPCs but lower landing-page click-through; horizontal placements can be the reverse.",
    "- Compare apples to apples. Because placements differ on both CPC and click-through, don't compare them on ad CPC alone — compare on the blended landing-page-event CPC (see Metrics & Unit Economics).",
    "- Reach expands as you add placements. Starting narrow keeps testing cheap; once something works, expanding to more placements and sizes widens your reach.",
    "",
    "A frugal sequence:",
    "1. Prove the basics first in one placement — get the angle, headline, and image working where you've already seen conversions.",
    "2. Then expand to other placements, using your working placement as the benchmark: 'this works here; can we make it work here too, but cheaper?'",
    "3. Don't chase new placements before your core messaging is dialed in — you'll just spend more without a baseline to compare against.",
    "",
    COACHING_HANDOFF,
  ];

  return {
    title: "Traffic & Placements — Where Your Ads Run",
    slug: "concepts-traffic-and-placements",
    node: "traffic-and-placements",
    docClass: "curated",
    ceiling: "conceptual",
    handoff: "coaching",
    tags: ["placement", "native-ad", "budget"],
    content: lines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "The Blitz",
  };
}

export function buildConceptsDocs(): ConceptsDoc[] {
  return [
    buildAnglesDoc(),
    buildHeadlinesDoc(),
    buildCreativeStrategyDoc(),
    buildOfferStrategyDoc(),
    buildTestingMethodologyDoc(),
    buildScalingStrategyDoc(),
    buildMetricsDoc(),
    buildTrafficPlacementsDoc(),
  ];
}

export async function seedConceptsKb(): Promise<void> {
  const docs = buildConceptsDocs();
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
               tags, ceiling, handoff, last_verified, source_path, source_label)
            VALUES
              (${cleanTitle}, 'concepts', ${cleanContent}, 'member', ${doc.docClass},
               ${doc.slug}, 'concepts', ${doc.node}, ${tagsJson}::jsonb, ${doc.ceiling},
               ${doc.handoff}, ${CONCEPTS_VERIFIED_AT}::timestamptz, ${doc.sourcePath},
               ${doc.sourceLabel})
            ON CONFLICT (title) DO UPDATE SET
              category = EXCLUDED.category,
              content = EXCLUDED.content,
              audience = EXCLUDED.audience,
              doc_class = EXCLUDED.doc_class,
              slug = EXCLUDED.slug,
              home_root = EXCLUDED.home_root,
              node = EXCLUDED.node,
              tags = EXCLUDED.tags,
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
        `[seed-concepts-kb] Error upserting "${doc.title}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-concepts-kb] Done. Processed: ${upserted}, Errors: ${errors}, Total: ${docs.length}`,
  );
}
