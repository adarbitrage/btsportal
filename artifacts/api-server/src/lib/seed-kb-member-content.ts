import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, toolsTable, vaultResourcesTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import {
  BLITZ_SECTIONS,
  BLITZ_PHASE_MAP,
  BLITZ_PHASE_ORDER,
  BLITZ_SECTION_COUNT,
} from "@workspace/blitz-curriculum";
import { scrubPrivateContent } from "./content-privacy-filter";

interface MemberDoc {
  title: string;
  category: string;
  content: string;
  sourcePath: string;
  sourceLabel: string;
}

function buildBlitzDocs(): MemberDoc[] {
  const phaseLabels: Record<string, string> = {
    intro: "Introduction",
    build: "Phase 1 — Build",
    test: "Phase 2 — Test",
    scale: "Phase 3 — Scale",
  };

  return BLITZ_SECTIONS.map((section) => {
    const phaseLabel = BLITZ_PHASE_MAP[section.phase]?.label ?? phaseLabels[section.phase] ?? section.phase;
    const content = [
      `${phaseLabel} · Step ${section.step}`,
      `Topic: ${section.title}`,
      `This lesson is part of the BTS Blitz™ affiliate marketing training program, ${phaseLabel}.`,
      `Learn about ${section.title} in the Build Test Scale Blitz training guide.`,
    ].join("\n");

    return {
      title: `Blitz Lesson ${section.id}: ${section.title}`,
      category: "blitz",
      content,
      sourcePath: `/blitz/guide/${section.id}`,
      sourceLabel: "Blitz Guide",
    };
  });
}

/**
 * Training/curriculum docs, single-sourced from the canonical Blitz curriculum
 * skeleton (`@workspace/blitz-curriculum`). These populate the member-facing
 * "Training" KB category (category key `curriculum`) so the AI assistant and
 * the Knowledge Base browse/search surface can answer "what does the training
 * cover / what order do I learn things" questions.
 *
 * These are deliberately structural (a program overview + one doc per phase)
 * rather than per-lesson — the per-lesson "Blitz Guide" entries already live in
 * the `blitz` category, so duplicating all 23 lessons here would just be noise.
 */
function buildCurriculumDocs(): MemberDoc[] {
  const docs: MemberDoc[] = [];

  // Program-level overview: the phases, their step counts, and the full journey.
  const overviewLines: string[] = [
    "BTS Training Curriculum Overview",
    "",
    `The BTS Blitz™ affiliate marketing training is a sequential, step-by-step program made up of ${BLITZ_SECTION_COUNT} lessons across ${BLITZ_PHASE_ORDER.length} phases. Each phase builds on the one before it, and phase gates keep you from moving on until you are ready.`,
    "",
  ];
  for (const phaseKey of BLITZ_PHASE_ORDER) {
    const phase = BLITZ_PHASE_MAP[phaseKey];
    const sections = BLITZ_SECTIONS.filter((s) => s.phase === phaseKey);
    overviewLines.push(
      `${phase.label} (${sections.length} ${sections.length === 1 ? "lesson" : "lessons"}): ${sections.map((s) => s.title).join("; ")}.`,
    );
  }
  docs.push({
    title: "BTS Training Curriculum Overview",
    category: "curriculum",
    content: overviewLines.join("\n"),
    sourcePath: "/blitz",
    sourceLabel: "Training",
  });

  // One doc per phase: the ordered list of lessons in that phase.
  for (const phaseKey of BLITZ_PHASE_ORDER) {
    const phase = BLITZ_PHASE_MAP[phaseKey];
    const sections = BLITZ_SECTIONS.filter((s) => s.phase === phaseKey);
    if (sections.length === 0) continue;

    const lines: string[] = [
      `${phase.label} — Training Curriculum`,
      "",
      `This phase of the BTS Blitz™ training contains ${sections.length} ${sections.length === 1 ? "lesson" : "lessons"}, completed in order:`,
      "",
    ];
    for (const section of sections) {
      lines.push(`${section.step}: ${section.title}`);
    }

    docs.push({
      title: `Training Curriculum: ${phase.label}`,
      category: "curriculum",
      content: lines.join("\n"),
      sourcePath: `/blitz/guide/${sections[0].id}`,
      sourceLabel: "Training",
    });
  }

  return docs;
}

function buildResourceLibraryDocs(): MemberDoc[] {
  return [
    {
      title: "Creative Drive — BTS Resource Vault",
      category: "resource",
      content:
        "Creative Drive is the ultimate BTS resource vault. It is packed with high-converting ad templates, expert-crafted guides, brand logos, copywriting blueprints, and more. It is your shortcut to affiliate arbitrage mastery. Whether you're refining your ad creatives, dialing in your messaging, or scaling your campaigns, Creative Drive has everything you need. Access proven assets and accelerate your success with high-converting ad templates and media buying resources.",
      sourcePath: "/resource-library",
      sourceLabel: "Resource Library",
    },
    {
      title: "P&L Tracker™ — Profit and Loss Spreadsheet",
      category: "resource",
      content:
        "The BTS P&L Tracker™ is a profit and loss spreadsheet designed for media buyers. Tracking is the absolute bane of the media buyer. You simply cannot grow your business if you're not able to make calculated decisions based on your numbers. Know your numbers — if you can't track it, you can't manage it. Download and use this spreadsheet to track ad spend, revenue, and profitability for your affiliate campaigns.",
      sourcePath: "/resource-library",
      sourceLabel: "Resource Library",
    },
    {
      title: "Dedicated Email Template — Proven Email Marketing Template",
      category: "resource",
      content:
        "The BTS Dedicated Email Template is a proven email advertising template with over $60 million sent through it. Over 15+ years of buying media, dozens of dedicated email templates have been tested — none compare to this one. Simple, elegant, and proven to convert. Use this template for dedicated email marketing campaigns on warm traffic platforms like LiveIntent.",
      sourcePath: "/resource-library",
      sourceLabel: "Resource Library",
    },
  ];
}

function buildGlossaryDocs(): MemberDoc[] {
  const terms: Array<{ term: string; definition: string; note?: string }> = [
    { term: "Advertorial", definition: "Long-form advertisement which tells stories, gives information, and otherwise gives potential customers some material to consume before heading to the sales offer page." },
    { term: "Affiliate", definition: "Marketer that promotes sales products/offers from sellers and markets them to customers, using advertising on traffic sources." },
    { term: "Affiliate network", definition: "Platform that brings together offer owners, and affiliates who want to promote those offers to potential customers." },
    { term: "AIDA framework", definition: "Attention (image), Interest (headline), Desire (angle), Action (click): The ideas to keep in mind when making an effort to engage your avatar and elicit a click/conversion." },
    { term: "Angle", definition: "The beginning of your story. The direction from which you're coming with your effort to convince customers to enter your funnel and ultimately buy. This includes a combination of Banner image, headline, and description/any teaser headline.", note: "Preframes the offer, the journey to the purchase." },
    { term: "Anstrex", definition: "Market research platform used to search through ads running for products like yours, for ideas and research purposes." },
    { term: "AOV", definition: "Average Order Value — average amount per sale of a given product, including up-sales, down-sales, and cross-sales." },
    { term: "ATC", definition: "Add to Cart — upper funnel metric event that occurs when someone starts the process of purchasing an item." },
    { term: "Banner", definition: "One single ad, which is a combination of the image and headline(s)." },
    { term: "Conversion (CV)", definition: "A sale/purchase event." },
    { term: "CPA", definition: "Cost per acquisition — your cost to acquire a sale." },
    { term: "CPC", definition: "Cost per Click — calculated by taking the amount spent and dividing it by the number of clicks at that particular level." },
    { term: "CPM", definition: "Cost per mille, or cost per 1,000 impressions." },
    { term: "Creative", definition: "Same as the terms: ad or banner — the image and headline combination used in advertising." },
    { term: "CropBot", definition: "BTS proprietary browser extension that crops images for use in your ad creatives.", note: "BTS proprietary software." },
    { term: "CTR", definition: "Click Through Rate — percentage of individuals who have clicked through to the specified metric (Landing Page, Cart, Checkout, Purchase)." },
    { term: "Customer Avatar", definition: "A research-based snapshot of the specific type of customer that will benefit from or want to purchase the product you're offering." },
    { term: "DIYTrax", definition: "BTS proprietary tracking software that allows you to track your campaigns with up-to-date information. Also a management and analytics hub for all campaigns, including MetricMover Landing Page integration.", note: "BTS proprietary software." },
    { term: "DSP", definition: "Demand side platform — used for programmatic advertising." },
    { term: "Email Newsletter Advertising", definition: "Type of Media Buying in which you buy ad space for your ad to be placed into emails and/or newsletters, sent via the email list holders.", note: "Warm market traffic — people who already know and trust the email list owner." },
    { term: "Flexy", definition: "BTS proprietary Landing Page creation and modification tool, prepopulated with advertorials developed for use with MediaMavens products.", note: "BTS proprietary software." },
    { term: "Funnel", definition: "The whole flow/process of your campaign that the customer will go through, from your banners, to your LP, to the offer page." },
    { term: "Gifster", definition: "BTS proprietary software program that creates GIFs from your static images.", note: "BTS proprietary software." },
    { term: "Gravity Score", definition: "Formula that indicates a product is successfully converting better than others. Higher score means more affiliates are getting sales of this product." },
    { term: "Hero Shot", definition: "Main image on the Landing Page (usually the first image below the headline/sub-headline). A common split-test element for optimizations." },
    { term: "Jump Page / Bridge Page", definition: "Landing Page that helps to pre-sell the product. Can create/use LPs in Flexy." },
    { term: "KPIs", definition: "Key Performance Indicators — metrics for measuring the effectiveness of your campaign such as reach, engagement rate, conversion rate." },
    { term: "Landing Page", definition: "The web page (usually an Advertorial) that customers land on after clicking on your ad banner." },
    { term: "Listicle", definition: "A landing page that contains a list of several separate offers/products which you promote at the same time." },
    { term: "LiveIntent", definition: "Traffic Source platform which handles advertisements for clients with customer bases in the millions for newsletters, blogs, etc.", note: "Warm traffic platform of email newsletters." },
    { term: "Media Buying", definition: "The act of purchasing advertising space on a media platform." },
    { term: "MediaGo", definition: "Traffic Source platform which carries marketing traffic to premium sites like MSN, ABC, Fox, MicrosoftCasualGames, Quora, etc." },
    { term: "MediaMavens", definition: "BTS proprietary affiliate network of vetted offers/products. 100% commission goes back to BTS community members. New offers are added regularly.", note: "BTS proprietary affiliate network." },
    { term: "MetricMover", definition: "BTS Landing Page variation creator for facilitating split testing of elements of your Landing pages, like Headlines, Sub-headlines, and Hero Shot combinations.", note: "BTS proprietary software." },
    { term: "Native Advertising", definition: "Ads placed on a platform that mimic, blend in with, or look like the articles and news stories on the site/publisher.", note: "Examples of Native platforms: MediaGo, Taboola." },
    { term: "NoEscape", definition: "BTS proprietary software that allows you to add pop-ups, pop-unders, pop-overs, exit pops, and tab-overs to your advertorial or website.", note: "BTS proprietary software." },
    { term: "Offer", definition: "The product you're promoting through your affiliate campaign." },
    { term: "Offer Page", definition: "The web page for the offer product, managed/controlled by the brand owner of the product." },
    { term: "Optimization", definition: "Taking data and analyses from your testing and using that to refine and improve your campaign. Includes removing, adding, altering or iterating off of banners, images and headlines." },
    { term: "Pain Point", definition: "The main problem you're trying to help solve for your customer." },
    { term: "PixelPress", definition: "BTS program that facilitates creating finished banners, with multiple combinations of your images and headlines for split testing.", note: "BTS proprietary software." },
    { term: "Pre-Qualifying", definition: "Using your banners to get your targeted customer avatars/types ready to see your product in the funnel." },
    { term: "Rev Share", definition: "Revenue Sharing — you will be charged for any refunds/clawbacks through the platform. Refund rates should be no more than 10-20%." },
    { term: "ScrapeBot", definition: "BTS proprietary tool that searches and scrapes/gathers images from internet searches, then zips them into a folder for use.", note: "BTS proprietary browser extension." },
    { term: "Target CPA", definition: "The minimum dollar amount you want to spend in ad dollars to acquire a sale/conversion (Cost Per Acquisition). Usually roughly the same as your average commission." },
    { term: "Tracking Tokens", definition: "The item/piece of data we're passing through for automated tracking of certain information parameters. Basically the same as Macros for BTS use." },
    { term: "Vertical", definition: "Category of similar products in affiliate marketing." },
  ];

  return terms.map(({ term, definition, note }) => ({
    title: `Glossary: ${term}`,
    category: "glossary",
    content: note
      ? `${term}: ${definition}\n\nNote: ${note}`
      : `${term}: ${definition}`,
    sourcePath: "/blitz/guide",
    sourceLabel: "Blitz Glossary",
  }));
}

async function buildToolsDocs(): Promise<MemberDoc[]> {
  const tools = await db
    .select({
      slug: toolsTable.slug,
      name: toolsTable.name,
      shortDescription: toolsTable.shortDescription,
      longDescription: toolsTable.longDescription,
    })
    .from(toolsTable)
    .where(eq(toolsTable.status, "active"));

  return tools.map((t) => ({
    title: `Tool: ${t.name}`,
    category: "tools",
    content: [t.name, t.shortDescription, t.longDescription ?? ""].filter(Boolean).join("\n\n"),
    sourcePath: `/tools/${t.slug}`,
    sourceLabel: "Apps & Tools",
  }));
}

async function buildVaultResourceDocs(): Promise<MemberDoc[]> {
  const resources = await db
    .select({
      id: vaultResourcesTable.id,
      collectionId: vaultResourcesTable.collectionId,
      title: vaultResourcesTable.title,
      description: vaultResourcesTable.description,
      longDescription: vaultResourcesTable.longDescription,
    })
    .from(vaultResourcesTable)
    .where(eq(vaultResourcesTable.status, "published"));

  return resources.map((r) => ({
    title: `Resource: ${r.title}`,
    category: "resource",
    content: [r.title, r.description ?? "", r.longDescription ?? ""].filter(Boolean).join("\n\n"),
    sourcePath: `/resource-library`,
    sourceLabel: "Resource Library",
  }));
}

const QA_ARTICLES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../knowledge-base/qa-articles.txt",
);

const COACHING_TITLE_KEYWORDS = [
  "coaching call",
  "coaching calls",
  "kick-off call",
  "kickoff call",
  "launchpad onboarding call",
  "book a session with the bts concierge",
  "book a 1-on-1",
  "thursday live coaching",
  "missed my launchpad onboarding call",
];

function isCoachingEntry(title: string): boolean {
  const lc = title.toLowerCase();
  return COACHING_TITLE_KEYWORDS.some((kw) => lc.includes(kw));
}

function parseQAArticlesFile(): Array<{ title: string; content: string }> {
  let raw = "";
  try {
    raw = fs.readFileSync(QA_ARTICLES_PATH, "utf-8");
  } catch {
    console.warn("[seed-kb-member] Could not read qa-articles.txt — coaching/faq docs skipped.");
    return [];
  }
  const entries: Array<{ title: string; content: string }> = [];
  const parts = raw.split(/\n### /);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lines = part.split("\n");
    const title = lines[0].trim();
    if (!title) continue;
    const rest = lines.slice(1).join("\n");
    const contentMatch = rest.match(/Content:\s*\n([\s\S]*?)(?:\* \* \*|$)/);
    const content = contentMatch
      ? contentMatch[1].trim()
      : rest.replace(/Description:.*\n/, "").trim();
    if (title && content && content.length > 30) {
      entries.push({ title, content: content.slice(0, 6000) });
    }
  }
  return entries;
}

function buildCoachingDocs(): MemberDoc[] {
  return parseQAArticlesFile()
    .filter((e) => isCoachingEntry(e.title))
    .map((e) => ({
      title: e.title,
      category: "coaching",
      content: e.content,
      sourcePath: "/coaching",
      sourceLabel: "Coaching",
    }));
}

function buildFaqDocs(): MemberDoc[] {
  return parseQAArticlesFile()
    .filter((e) => !isCoachingEntry(e.title))
    .map((e) => ({
      title: e.title,
      category: "faq",
      content: e.content,
      sourcePath: "/support",
      sourceLabel: "Support",
    }));
}

export async function seedMemberBroadContent(): Promise<void> {
  console.log("[seed-kb-member] Seeding member-facing broad content index...");

  const [toolDocs, vaultDocs] = await Promise.all([buildToolsDocs(), buildVaultResourceDocs()]);

  const allDocs: MemberDoc[] = [
    ...buildBlitzDocs(),
    ...buildCurriculumDocs(),
    ...buildResourceLibraryDocs(),
    ...buildGlossaryDocs(),
    ...buildCoachingDocs(),
    ...buildFaqDocs(),
    ...toolDocs,
    ...vaultDocs,
  ];

  let upserted = 0;
  let errors = 0;

  for (const doc of allDocs) {
    const cleanTitle = scrubPrivateContent(doc.title);
    const cleanContent = scrubPrivateContent(doc.content);
    try {
      await db.execute(
        sql`INSERT INTO knowledgebase_docs (title, category, content, audience, source_path, source_label)
            VALUES (${cleanTitle}, ${doc.category}, ${cleanContent}, 'member', ${doc.sourcePath}, ${doc.sourceLabel})
            ON CONFLICT (title) DO UPDATE SET
              category = EXCLUDED.category,
              content = EXCLUDED.content,
              source_path = EXCLUDED.source_path,
              source_label = EXCLUDED.source_label,
              audience = EXCLUDED.audience,
              updated_at = NOW()`,
      );
      upserted++;
    } catch (err) {
      errors++;
      console.error(
        `[seed-kb-member] Error upserting "${doc.title}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[seed-kb-member] Done. Upserted: ${upserted}, Errors: ${errors}, Total: ${allDocs.length}`,
  );
}
