import { db } from "@workspace/db";
import { aiSourceDocumentsTable, blitzLessonsTable } from "@workspace/db/schema";
import { asc, ne } from "drizzle-orm";
import { fingerprintContent } from "./kb-source-windows.js";
import { blitzSourceDocTitle } from "./blitz-identity-map.js";

/**
 * Core BTS training → AI Source Knowledge mining corpus (Task: feed core
 * training into the synthesis engine).
 *
 * Loads the three core-training bodies into `ai_source_documents` as
 * NON-CITABLE mining source (never wired into any member-facing retrieval path;
 * see ai-source-documents schema/route):
 *
 *   1. The 7 Pillars™ — the foundational framework prose.
 *   2. What The Blitz™ Is (Pillars → Blitz) — the bridge prose.
 *   3. The Blitz™ curriculum — every published lesson body from the
 *      `blitz_lessons` store, filed one source doc per lesson so the topic
 *      indexer can classify each at its natural granularity (it truncates a
 *      single source to ~9k chars, so one giant concatenated body would drop
 *      most of the curriculum).
 *
 * The 7 Pillars / Pillars-to-Blitz prose lives in React pages that cannot be
 * imported into the api-server, so — like seed-process-kb — it is re-authored
 * here as plain text (brand tokens resolved to "Build Test Scale"). This is
 * mining input, not citable truth, so it is filed verbatim for the engine to
 * consolidate, never shown to members.
 *
 * All three bodies file into the `reference_docs` folder with the `curriculum`
 * authority role. Idempotent: keyed on title — an existing source doc with the
 * same title is left untouched, so re-runs (and prod boot) never duplicate.
 *
 * NOT handled here: the Blitz video transcripts land as `blitz_video` sources
 * via the Transcript Cleaner pipeline (a separate, human-gated flow); and the
 * synthesis run / review / publish / coverage steps are runtime + human-gated
 * (they need a live LLM), so they are intentionally out of this boot seed.
 */

const SOURCE_FOLDER = "reference_docs";
const AUTHORITY_ROLE = "curriculum";

interface CoreTrainingDoc {
  title: string;
  content: string;
  sourceName: string;
  provenanceNote: string;
}

const SEVEN_PILLARS_DOC: CoreTrainingDoc = {
  title: "The 7 Pillars™ of a Profitable Digital Business (Core Training)",
  sourceName: "The 7 Pillars™ — Core Training",
  provenanceNote:
    "Core training prose from the portal /core-training/7-pillars page, filed as AI source-mining material.",
  content: `The 7 Pillars™ of a Profitable Digital Business

The foundational framework behind every successful affiliate marketing business — the seven elements that turn paid traffic into a profitable digital business. This is where your path begins: it gives you the big-picture model so the hands-on build in The Blitz™ makes sense.

Welcome To The 7 Pillars™ Of A Profitable Digital Business
Welcome, and thank you for choosing to embark on this journey. Over the past 20+ years, we've immersed ourselves in the digital marketing industry, navigating its intricate pathways and learning its secrets. We've experienced the peaks of success, the valleys of failure, and the vast plains of steady progress. Each step of the way, we've gathered invaluable insights and honed strategies that work. In this training we dissect the industry, breaking it down into its core components and revealing the essential elements that make a profitable digital business. We've broken down the process of building a successful digital business into seven key pillars. These pillars are the foundation of any successful digital business, and understanding them is crucial to your success.

Pillar 1 — The Business Model
The first pillar of a successful digital business is the business model. In the vast world of online business models, one stands out for its simplicity, predictability, and scalability: Affiliate Marketing. None have proven as consistently profitable as Affiliate Marketing, particularly when combined with paid media — a strategy also known as Affiliate Arbitrage. Affiliate Arbitrage involves using paid advertising to promote affiliate offers, with the goal of earning more in affiliate commissions than you spend on advertising. If you spend $40 on ads to sell a product and earn a $60 commission, you've made a $20 profit. Scale that to 10 sales a day and you're looking at $200 daily profit.
Key Benefits of Affiliate Arbitrage: No need to build a complete website — we're in the business of making profits. No need to create your own product — leverage existing products with market demand. No merchant processing or customer support hassles. No existing audience required — start from scratch and turn a profit in your first week. Track ROI in real time — you're paid on the front-end sale.

Pillar 2 — The Market
Once you've committed to the path of affiliate arbitrage, the next crucial step is selecting the market you wish to operate in. Two primary markets consistently deliver exceptional results: Trendy Gadgets and Health & Wellness Products. Trendy Gadgets have universal appeal — there's always a new gadget catching the world's attention, and the global gadget market is valued at hundreds of billions of dollars. Health & Wellness is valued at over $300 billion globally; post-pandemic, consumers are more focused than ever on improving their health, and supplements offer affordable, scalable solutions ideal for scaling campaigns. As part of your enrollment in Build Test Scale, you'll gain access to hundreds of health and wellness offers through multiple affiliate network relationships. You will never need to hunt for offers — your pathway to success is already paved.

Pillar 3 — The Demographic
Once we've established what we'll be promoting, it's time to identify our target audience. A significant portion of online spending comes from a demographic that many marketers overlook: Baby Boomers — individuals in their late 50s to early 70s who are financially established with disposable income. Contrary to popular belief, Baby Boomers are far from technologically inept: they use smartphones, are active on social media, and regularly shop online. Studies show Boomers spend more money online than younger generations.
Why Boomers Are the Perfect Demographic: They're drawn to products that make their lives easier and more enjoyable. They're highly motivated to invest in health & wellness products. They value convenience and immediate results. They make up one of the largest, most financially capable demographic groups.

Pillar 4 — The Traffic Channel
We've identified our business model (Affiliate Marketing), our markets (Trendy Gadgets & Health), and our target demographic (Boomers). Now it's time to address WHERE we'll promote our products. The answer is through the powerful medium of email. Our strategy revolves around leveraging the power of existing email lists. Instead of building our own list, we seek out those who already have extensive email lists and place our ads within the emails they send to their subscribers.
Why Email Traffic Reigns Supreme: Enormous scale — a vast number of email lists available. Many newsletters are sent daily — plenty of inventory to purchase. Some lists have over a million subscribers for instant reach. No complicated, ever-changing algorithms like Google or Facebook. Warmer traffic — subscribers are already opted in and receptive. Less competition — most marketers are unaware of this channel. As part of your enrollment you'll gain access to hundreds of underground list management companies, brokers, publishers, and networks. You'll never be left wondering where to buy advertising.

Pillar 5 — The Strategy
The strategy is our operational blueprint. In affiliate marketing, success isn't a game of chance — it's a calculated effort. Our two-phase approach is built for simplicity and effectiveness. Phase 1: Email Sponsorships — this is where the journey begins. Email Sponsorships put your offers directly in front of highly engaged audiences, giving you the perfect testing ground; many students spend $5k+ per day, achieving ROI of 50% or higher during this phase. Phase 2: Dedicated Emails — once you've identified the highest-performing ads and landing pages, you move to Dedicated Emails, where the big results happen with massive, highly targeted audiences. Start strong with Sponsorships. Scale big with Dedicateds. This is the formula for success.

Pillar 6 — The Edge
In the fiercely competitive landscape of affiliate marketing, having an edge is a necessity. Build Test Scale provides the tools and resources you need to not just compete but to thrive. Our edge is delivered through two primary channels: our proprietary software (Paid Media Suite™) and our dedicated BTS Concierge™. The BTS Concierge™ is a dedicated group of top-tier experts who handle the creation of all your marketing materials, saving you countless hours and significant financial resources.
Proprietary Software Suite: Flexy™ (drag-and-drop landing page app), MetricMover™ (create & test hundreds of pages), DIYTrax™ (URL rotator and tracker), PixelPress™ (bulk create & split test banner ads). Additional supporting tools members use include ScrapeBot™ and CropBot™ (image scraping and cropping for ad creative) and Gifster™ (GIF creation).

Pillar 7 — The Commitment
The final pillar, and perhaps the most critical, is the commitment. Success in affiliate marketing, as in any business, requires a steadfast commitment to your goals and the willingness to put in the necessary work. Build Test Scale provides the tools, the team, and the strategy, but the commitment must come from you. Affiliate marketing is not a get-rich-quick scheme. It's a legitimate business model that requires time, effort, and dedication. You must be willing to learn, adapt, and grow, to face challenges and overcome obstacles, and — most importantly — to be committed to taking consistent action towards your goals.

Conclusion & Next Steps
Build Test Scale is a comprehensive training program that covers all aspects of affiliate marketing — from the business model to the product, the market, the demographic, the traffic, the edge, and the commitment. It's a clear, step-by-step guide to building a successful affiliate marketing business. But the training program is just a tool — a roadmap to success. You are the driver. The next step is "Before You Start The Blitz™."`,
};

const PILLARS_TO_BLITZ_DOC: CoreTrainingDoc = {
  title: "What The Blitz™ Is — And Why It's Built the Way It Is (Core Training)",
  sourceName: "Pillars → Blitz Bridge — Core Training",
  provenanceNote:
    "Core training prose from the portal /core-training/pillars-to-blitz page, filed as AI source-mining material.",
  content: `What The Blitz™ Is — And Why It's Built the Way It Is
A bridge from the 7 Pillars™ to your first campaign.

You've just finished the 7 Pillars™ — the foundation of everything in this business. Now you're about to open The Blitz™, the step-by-step system for actually building and launching your first campaign. Every major step in The Blitz is a direct application of one of the pillars you just learned. Nothing in it is arbitrary.

Pillar 1 — The Business Model — Affiliate Arbitrage
"Spend less on ads than you earn in commissions. Scale that and the numbers get very big, very fast."
The Blitz is built around a short Introduction, then three working phases — Build, Test, and Scale. Build is where you set everything up before spending a dollar on ads. Test is where you run small amounts of traffic to find what works. Scale is where you spend more on the combinations that are already proven profitable. The entire sequence exists for one reason — to find a reliable spread between what you spend on ads and what you earn in commissions. That's the arbitrage. The Blitz has strict rules about when you're allowed to move from one phase to the next; those rules exist to protect the math — you don't scale until the arbitrage is proven.

Pillar 2 — The Market — Health & Wellness
"Traditional supplements and wellness gadgets — two categories that work together beautifully and cover all the bases for people serious about their health."
One of your first steps in The Blitz is choosing a product to promote. You'll do this inside one of two affiliate networks — Media Mavens (BTS's in-house network) or ClickBank. Both are stocked with health and wellness products: supplements, gadgets, and wellness devices aimed at the exact market described in Pillar 2. You won't be hunting for a market or a niche — that decision has already been made. Your job is simply to choose a specific product within it.

Pillar 3 — The Demographic — Know Your Buyer
"Approximately 80% of the money that flows through the internet comes from women in their 40s, 50s, and 60s. Health and wellness products aimed at this group convert like nothing else."
A significant portion of The Blitz is devoted to creating your marketing materials — the ads people see and the landing pages they arrive at. The core principle is simple: know exactly who you're writing for before you write a single word. For the majority of health and wellness products in our networks, that person is a woman in her 40s, 50s, or 60s dealing with a real health challenge — joint pain, low energy, sleep issues, stress. That said, the demographic follows the product; some offers skew toward a broader or younger audience. Make sure every headline, image, and landing page speaks directly to that person. Your coach can help you identify the right target if you're unsure.

Pillar 4 — The Traffic Channel — Email
"We're not building our own email list. We're finding the people who already have massive lists and placing our ads inside the emails they send to their subscribers."
In The Blitz you'll be running your ads on a platform called Caterpillar — the name used throughout the guide to protect the source. Caterpillar is one of the large email publishers described in Pillar 4. When your ad runs there, it's appearing inside emails being sent to large subscriber lists. You're not on Google. You're not on Facebook. You're placing your ad inside someone else's email, reaching their audience — no algorithm changes, no account bans, warmer traffic because those subscribers already opted in.

Pillar 5 — The Strategy — Test with Sponsorships, Scale with Dedicateds
"Dedicateds are where you want to end up — that's where the big scale happens. But sponsorships are where you test. You don't spend dedicated money until you know what works."
The Blitz maps these stages directly onto this strategy. During the Test phase, your ads run as sponsorships — your ad appears alongside other content inside an email, at a lower cost per click. You run several rounds of tests to find the combination of ad and landing page that works best while keeping your spend manageable. Once you've found a profitable combination and run it for 14 or more consecutive profitable days, The Blitz graduates you to the Master Publisher — a dedicated email send where the entire email is your ad, going out to a massive list all at once. That's the dedicated email phase from Pillar 5, and The Blitz won't let you go there until you've earned it through the data.

Pillar 6 — The Edge — Proprietary Software + Your VA Team
"You don't want to be the one working your business. We are entrepreneurs — not cogs in the machine. The software and the team exist so you can focus on strategy."
Throughout the Build phase you'll use proprietary software built specifically for this system, including Flexy™, MetricMover™, and DIYTrax™. Flexy™ is the tool you'll use to build your landing pages — no coding required. MetricMover™ automatically generates 25 different versions of your landing page by combining your headlines and images, then rotates visitors through all of them to find what converts best. DIYTrax™ is your tracking dashboard — it connects your ads, your landing pages, and your affiliate link, and records exactly which combinations produce sales. At any step where you'd rather hand off the technical work, BTS Concierge™ — your VA team — can handle it for you, and that option is available at every step.

Pillar 7 — The Commitment — Perseverance over Perfection
"You're going to have days when you want to throw in the towel. What you must cultivate is a tenacity to persevere."
The first rounds of testing in The Blitz almost always lose money — and that is completely by design. You are spending money to buy data: which headlines your audience responds to, which images stop the scroll, which landing pages turn visitors into buyers. That information is what makes the later rounds — and eventually the Scale phase — profitable. The early loss is the price of the knowledge, not a sign that something is wrong. The Blitz builds the mindset pillar into its structure: rules about how long to wait before making decisions, checkpoints that prevent you from panicking and changing things too early, and clear instructions on when to ask for help.

Before You Start The Blitz™
The 7 Pillars™ shows you the destination — a profitable campaign scaling with dedicated email blasts. The Blitz™ starts you at step one of getting there. The early steps will look nothing like the finished picture, and that's exactly right. Every step you take in The Blitz is grounded in one of the pillars you just learned.`,
};

const PROSE_DOCS: readonly CoreTrainingDoc[] = [SEVEN_PILLARS_DOC, PILLARS_TO_BLITZ_DOC];

/**
 * Exact reference-doc titles of the two core-training prose docs (not
 * `blitz_lessons` rows). Single source of truth shared with the Blitz identity
 * map + its drift guard so the prose entries can't silently drift from the
 * seeder.
 */
export const CORE_TRAINING_PROSE_TITLES: readonly string[] = PROSE_DOCS.map((d) => d.title);

/**
 * A single core-training source doc in its canonical, current form — the shape
 * both the boot seed (which INSERTs missing titles) and the dormant change scan
 * (which refreshes existing titles' content) consume. This is the single source
 * of truth for "what should the core-training sources currently say", derived
 * live from the re-authored prose + the `blitz_lessons` store.
 */
export interface CoreTrainingSourceDoc {
  title: string;
  content: string;
  sourceType: string;
  authorityRole: string;
  sourceName: string;
  provenanceNote: string;
}

/**
 * Builds the current canonical set of core-training source docs: the two
 * re-authored prose bodies plus one doc per non-rejected Blitz lesson (edited
 * content preferred, else raw). Lessons with an empty body are skipped. The
 * ordering mirrors the seed (prose first, then curriculum by blitzOrder).
 */
export async function buildCoreTrainingSourceDocs(): Promise<CoreTrainingSourceDoc[]> {
  const docs: CoreTrainingSourceDoc[] = [];

  // 1 + 2) The re-authored prose bodies.
  for (const doc of PROSE_DOCS) {
    docs.push({
      title: doc.title,
      content: doc.content,
      sourceType: SOURCE_FOLDER,
      authorityRole: AUTHORITY_ROLE,
      sourceName: doc.sourceName,
      provenanceNote: doc.provenanceNote,
    });
  }

  // 3) The Blitz curriculum — every published lesson body from the store, one
  //    source doc per lesson (natural granularity for the topic indexer).
  const lessons = await db
    .select({
      title: blitzLessonsTable.title,
      content: blitzLessonsTable.content,
      editedContent: blitzLessonsTable.editedContent,
      lessonId: blitzLessonsTable.lessonId,
      blitzOrder: blitzLessonsTable.blitzOrder,
      status: blitzLessonsTable.status,
    })
    .from(blitzLessonsTable)
    .where(ne(blitzLessonsTable.status, "rejected"))
    .orderBy(asc(blitzLessonsTable.blitzOrder));

  for (const lesson of lessons) {
    const sourceTitle = blitzSourceDocTitle(lesson.title);
    const body = (lesson.editedContent?.trim() || lesson.content || "").trim();
    if (!body) continue;
    docs.push({
      title: sourceTitle,
      content: body,
      sourceType: SOURCE_FOLDER,
      authorityRole: AUTHORITY_ROLE,
      sourceName: "The Blitz™ Curriculum",
      provenanceNote: `Seeded from blitz_lessons (lessonId ${lesson.lessonId ?? "?"}, order ${
        lesson.blitzOrder ?? "?"
      }) — core Blitz training body for AI source mining.`,
    });
  }

  return docs;
}

/**
 * Idempotent boot seed. Files the core-training bodies into
 * `ai_source_documents` (reference_docs / curriculum), skipping any title that
 * already exists so re-runs never duplicate. Freshly inserted rows carry a
 * `contentHash` fingerprint so the dormant change scan can tell a genuine edit
 * from a never-hashed row.
 */
export async function seedCoreTrainingSources(): Promise<void> {
  try {
    const existing = await db
      .select({ title: aiSourceDocumentsTable.title })
      .from(aiSourceDocumentsTable);
    const existingTitles = new Set(existing.map((r) => r.title.trim()));

    const canonical = await buildCoreTrainingSourceDocs();
    const toInsert = canonical
      .filter((doc) => !existingTitles.has(doc.title.trim()))
      .map((doc) => ({
        title: doc.title,
        content: doc.content,
        sourceType: doc.sourceType,
        authorityRole: doc.authorityRole,
        sourceName: doc.sourceName,
        provenanceNote: doc.provenanceNote,
        contentHash: fingerprintContent(doc.content),
      }));

    if (toInsert.length === 0) {
      console.log("[CoreTrainingSources] All core-training sources already present, skipping seed");
      return;
    }

    await db.insert(aiSourceDocumentsTable).values(toInsert);
    console.log(`[CoreTrainingSources] Seeded ${toInsert.length} core-training source documents`);
  } catch (err) {
    console.error("[CoreTrainingSources] Error seeding core-training sources:", err);
  }
}
