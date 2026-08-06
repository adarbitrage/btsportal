import { db } from "@workspace/db";
import { kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { scrubPrivateContent, rebrandOldBrandContent } from "./content-privacy-filter.js";
import { scrubConfidentialTerm } from "./confidential-term-repair.js";

/**
 * Headline-concept KB doc set (Task #1994, extended by Task #1997) — seeds
 * 10 DRAFTS into the `kb_staging_docs` AI Document Review queue on boot:
 *
 *   - 7 new concept documents (6 headline-concept docs + 1 upgraded Copy
 *     Blocks foundation doc) distilled from the Creative Drive headline PDFs,
 *     the Copy Blocks Essential Understanding house teaching, and the
 *     completed external research on advertorial-vs-jump-page headlines.
 *   - 1 companion word-choice doc (Task #1997) distilling the Context Word
 *     Dictionary and Power Word Dictionary (Creative Drive) into conceptual
 *     teaching, ending with a handoff to those dictionaries.
 *   - 1 reconciliation REVISION draft of the existing live doc
 *     "Headlines & Copy — Writing What Gets the Click" (staged with
 *     updateKind='update' + targetLiveDocId so reviewer tooling applies it as
 *     a revision — the live row is never touched here).
 *
 * HUMAN GATE ABSOLUTE: everything lands with the default `pending_review`
 * status. Nothing auto-approves; nothing writes to `ai_live_documents`.
 *
 * IDEMPOTENCY CONTRACT (same as blitz-reference-import.ts): the key is
 * (source = HEADLINE_CONCEPTS_SEED_SOURCE, sourceVideoTitle = per-doc slug).
 * If a row exists for the key — whatever its status or edits — the insert is
 * skipped entirely. Insert-only; never updates. Reviewer edits (title/content
 * changes, rejections, soft-deletes — the row stays either way) are never
 * clobbered or resurrected.
 */

// ── Idempotency marker ───────────────────────────────────────────────────────

/** `kb_staging_docs.source` marker for every row this seed creates. */
export const HEADLINE_CONCEPTS_SEED_SOURCE = "headline_concepts_seed";

/** Title of the live doc item 8 revises (resolved to an id at seed time). */
export const HEADLINE_LIVE_DOC_TITLE = "Headlines & Copy — Writing What Gets the Click";

function scrubAll(text: string): string {
  return scrubPrivateContent(rebrandOldBrandContent(scrubConfidentialTerm(text)));
}

// ── Shared provenance footer (admin-only; attribution lives here ONLY) ──────

const SOURCE_SET_NOTE =
  "Source set (admin-only provenance — body text carries NO attribution per the unified-house-teaching rule): " +
  "Copy Blocks Essential Understanding (house PDF); Stefan Georgi 'Writing Killer Headlines' (RMBC Module 8) — 7-element checklist; " +
  "external research synthesis on advertorial vs. jump-page headlines (Rachel Mazza next-commitment chain, Flexxable/Wardrope clarity+benefit split tests, LanderLab, Alex Cattoni/Copy Posse, Outbrain/Taboola/FTC compliance guidance, Eugene Schwartz awareness stages); " +
  "Creative Drive PDF distillations (Boduch 'Great Headlines Instantly', Copyblogger 'Magnetic Headlines' incl. the 4U framework, Suzanne Pope rhetorical toolkit, Andy Owen 'Powerful Headlines', Blair Warren 'One-Sentence Persuasion', Pascoe 'Headline Writing Blueprint', Klettke journey-stage model). " +
  "BTS curriculum is the primary authority where public literature is thin (jump-page specifics); external sources corroborate, they don't override. " +
  "All examples are fictional toy domains — no real BTS funnels, offers, coaches, or members.";

// ── Documents ────────────────────────────────────────────────────────────────

interface HeadlineSeedDoc {
  slug: string; // stored in sourceVideoTitle — the stable idempotency key
  title: string;
  docClassTarget: "curated" | "overview";
  taxonomyTags: string[];
  content: string;
  adminNotes: string;
  // Item 8 revision fields
  isRevision?: boolean;
  updateSummary?: string;
}

const DOC_1_CONTENT = `Headline Jobs by Surface — Ad, Advertorial, and Jump Page

This is the anchor document for headline writing in the BTS system. It defines the vocabulary every other headline doc uses: the three headline surfaces, the two funnel routes, and the single job each headline has. Before giving or taking any headline advice, first establish which surface the headline lives on — the right advice for an ad headline is often the wrong advice for a jump-page headline.

The two funnel routes

BTS campaigns run on two parallel routes (not a sequence of both):

- Route A: native ad → advertorial → e-commerce sales page.
- Route B: native ad → jump page (also called a bridge page) → VSL (video sales letter).

Both routes start with the same kind of ad on native placements. What differs is the middle page — a long-form editorial advertorial on Route A, a short momentum-building jump page on Route B — and the destination it hands the reader to.

The one universal law: a headline sells only the next commitment

A headline never sells the product. It sells exactly one thing: the very next step. The ad headline sells the click. The advertorial headline sells the read. The jump-page headline sells the play — pressing play on the video. The sales page or VSL sells the purchase. Nobody in the chain should try to do anybody else's job. When a headline reaches past its own step — an ad headline that tries to close a sale, a jump-page headline that tries to deliver the video's whole argument — it leaks tension the next step needed, and response drops.

This is also why "is this a good headline?" is an incomplete question. A headline can only be judged against the commitment it is supposed to win.

The headline unit

Throughout the BTS headline docs, "headline" means the headline unit — the headline alone, or the headline plus subheadline working together as one persuasion unit. The psychological elements (see Copy Blocks — The Five Building Blocks of Persuasive Copy) are distributed across the pair; there are no fixed rules about which element must sit in the headline versus the subheadline. The split is decided by above-the-fold hierarchy and scannability: the headline carries the sharpest, most magnetic part of the idea, and the subheadline carries supporting weight (proof, constraints, mechanism detail) that would make the headline bulky. If everything fits cleanly in one line, you may not need a subheadline at all.

The three surfaces

1. The ad headline — sells the CLICK.
The reader is at their coldest: scrolling a content feed in discovery mode, not searching for anything. The ad headline's job is to stop the scroll, signal "this is for me," and win a qualified click to the next page. It is the most curiosity-weighted surface — you open a loop and deliberately do not close it. Register is editorial/news style: it must read like content the reader already trusts, never like a coupon or a hard-sell ad. This surface also carries the tightest platform-policy exposure: native networks review ad headlines directly, so honest framing and claim discipline are survival requirements, not fine print (see Credibility & Promise Calibration — Believability, Proof, and Compliance). Success metric: click-through rate — but a qualified one. A curiosity trick that wins cheap, wrong clicks poisons everything downstream.

2. The advertorial headline — sells the READ.
The reader just clicked an editorial-style ad and landed on what looks and feels like an article. The advertorial headline's job is to make the click feel worth it and pull the reader into the first screen of copy. It borrows credibility from the article format itself — the editorial dress does persuasive work, so the headline stays in a news/editorial register and lets the format lend trust. Industry split-testing has consistently found that on this surface, a headline that is clear about the subject and benefit-led beats a pure curiosity tease: the reader already spent their click, and now they need to know they arrived somewhere relevant. Curiosity stays open — you still withhold the "how" — but clarity about the subject leads. Success metrics: read-through and click-through to the sales page.

3. The jump-page headline — sells the PLAY.
The reader clicked the ad and landed on a short page whose only purpose is to get the video playing. This is the most direct, promise-forward surface in the system. The jump page cannot borrow credibility from an article format — it has almost no format at all — so it manufactures momentum through the promise instead: a direct, confident statement of the transformation the video explains, plus an open loop that only pressing play can close. The headline hands the curiosity loop to the video's first line; it does not resolve it. Treat the jump page as a second ad: short headline unit, a tight paragraph or two derived from the video's hook and mechanism, and a dominant watch-the-video call to action. Success metrics: play rate and early watch time.

One deliberate spectrum on this surface: promise density. Some winning jump-page headlines are a short, minimal transformation line — just enough curiosity to press play. Others stack promise on promise into a mega-promise unit. The literature and testing do not settle this; treat promise density as a testing variable, not a rule. What is shared: the headline sells the watch decision, nothing more.

Surface calibration at a glance

- Register: ad = editorial/news; advertorial = editorial/news; jump page = direct response, promise-forward.
- Promise strength: lowest at the ad (near-zero explicit promise, curiosity does the work), moderate and benefit-clear at the advertorial, highest at the jump page.
- Curiosity weighting: heaviest at the ad, balanced with clarity at the advertorial, handed off to the video at the jump page.
- Compliance exposure: heaviest at ad and advertorial (native platform review), still real at the jump page.
- Success metric: CTR (ad) → read-through/CTR (advertorial) → play rate (jump page).

Why promise strength differs by surface: it must match the reader's actual warmth and the surface's job — and warmth depends on the route. A cold feed-scroller has no context for a big promise and will not believe it. On the advertorial route, a reader who chose to click and then chose to keep reading has demonstrated interest and can absorb a more direct promise. On the jump-page route, the reader is only one click warmer than the feed — the jump page is a second ad — so its headline is direct and promise-forward not because the reader is warm, but because the surface's entire job is to sell the watch decision; believability discipline still applies in full, and the video does the proving. Matching promise strength to the reader's actual state and the surface's job is the deeper principle behind all the per-surface rules (see Angle Selection — Choosing the Big Idea Before Writing a Word for the awareness-stage lens).

Message match across the chain

Whatever surfaces your route uses, the same core idea must run through all of them. The ad opens an angle; the advertorial or jump page continues that exact angle; the destination pays it off. A reader should land on each page and feel "yes — this is the thing I clicked on" within a second. Congruence of idea, not identical wording: each surface re-expresses the angle for its own job. A mismatch shows up in the numbers as a decent ad CTR followed by a poor next-step rate.

Worked contrast (fictional example — a posture-support cushion offer)

- Ad headline: "Why Desk Workers Are Rethinking the Way They Sit". Editorial, curiosity-weighted, no product, no promise numbers — it sells the click.
- Advertorial headline unit: "The 'Sitting Posture Mistake' Most Desk Workers Make Every Day — and the Simple Change That Relieves the Ache" — subject-clear, benefit-led, mechanism withheld — it sells the read.
- Jump-page headline unit: "Ease Years of Desk-Chair Back Ache — Watch How the 3-Point Support Method Works in Under 5 Minutes" — direct promise, mechanism named but not explained, loop handed to the video — it sells the play.

Same angle, three different jobs, three different headlines.

How to use this doc

When a member asks a headline question, first identify (or ask) which surface they mean. Then advise per that surface's job, register, promise strength, and metric. The companion docs go deeper: Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap; Credibility & Promise Calibration — Believability, Proof, and Compliance; Angle Selection — Choosing the Big Idea Before Writing a Word; Headline Quality Rubric — The Two-Pass Headline Evaluation; Rhetorical Tools for Headlines — The Craft Toolbox; and the foundation, Copy Blocks — The Five Building Blocks of Persuasive Copy. For layout, character limits, and platform mechanics, see Headlines & Copy — Writing What Gets the Click.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_2_CONTENT = `Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap

Purpose: this doc teaches how curiosity actually works in headlines — what creates it, what kills it, and how much of it each surface should carry. Curiosity is the engine of the click, but badly-built curiosity produces cheap clicks that never convert. The goal is motivated curiosity: attention that leads somewhere.

The curiosity gap

Curiosity is the tension created by a gap between what the reader knows and what they want to know. In direct response, the gap that matters is a very specific one: the gap between the reader's pain and the promise — bridged by something new they haven't tried. The productive question a headline plants is: "What is this new thing, how does it get me from my current pain to the result I want, and how is it different from everything I've already tried?"

That last clause matters. Most of your readers have tried things. Curiosity that suggests "another one of those" is dead on arrival; curiosity that signals this is different from what failed you is magnetic.

Withhold the how, not the what

The single most common curiosity mistake is withholding the wrong thing. A headline should be clear about WHAT the story or page is about — the subject, the problem space, who it's for — and withhold HOW the result happens: the mechanism. "One Weird Trick Changes Everything" withholds the what, and reads as clickbait; the reader has no reason to believe it's for them. "The 10-Minute Evening Routine Helping Light Sleepers Fall Asleep Faster" is clear about the what (sleep, light sleepers, an evening routine) while withholding the how (what the routine actually is). Clarity qualifies the reader; mystery about the mechanism pulls them forward.

The mechanism tease and the Curiosity Block

In Copy Blocks terms (see Copy Blocks — The Five Building Blocks of Persuasive Copy), the Curiosity Block is the bridge between the Pain Block and the Promise Block — usually the name of, or an allusion to, the unique mechanism. A named mechanism does double duty: it creates curiosity ("what is that?") and it implies differentness ("I haven't tried that").

Mechanism naming sits on a spectrum from blind to obvious:

- Blind: "a weird 7-second secret" — maximal mystery, zero information. Blind teases can pull clicks but strain believability and often attract the wrong reader.
- Evocative (the middle): "the 7-minute morning cocktail", "muscle confusion", "metabolic reset" — the name suggests a category of how without giving it away. It feels concrete and new at the same time.
- Obvious: naming the actual ingredient or method outright — full clarity, no gap left; curiosity collapses because there is nothing left to find out.

The best mechanism names sit toward the evocative middle: they reveal just enough to feel real and withhold enough to require the next step. A fictional example for a houseplant-care offer: "the bottom-watering reset" is evocative — a reader can half-picture it, but has to read on to learn what it is and why it works — where "a weird plant secret" is blind and "watering from a saucer" is obvious.

Open loops and fascinations

An open loop is any promise of information made and deliberately left unresolved — the headline poses it, the next step resolves it. The headline itself is the funnel's first open loop. Within body copy, fascinations (curiosity-driven bullet lines) chain smaller loops to keep a reader moving. The discipline that keeps loops honest: every loop you open must be one the destination genuinely closes. A loop the page never pays off is a trust withdrawal the funnel pays for at the order button.

Two failure modes kill curiosity:

1. Giving it away. If the headline explains the mechanism, there is no reason to click. Keep the resolution on the other side of the next commitment.
2. Empty intensifiers. Words like "amazing", "shocking", "incredible" attempt curiosity without a gap — there is no specific unknown, just volume. Specific-but-incomplete beats loud-but-vague every time (see Rhetorical Tools for Headlines — The Craft Toolbox for devices that create real gaps).

Curiosity must stay anchored to pain → promise

Random curiosity ("You Won't Believe What This Gardener Found") can win clicks from anyone — which is precisely the problem. Unanchored curiosity attracts unqualified readers who bounce at the first mention of the actual topic. Anchor every curiosity device to the avatar's pain and the offer's promise so that the only people who feel the pull are the people the funnel can serve. Curiosity is a targeting tool, not just an attention tool.

Surface calibration

- Ad headline: curiosity carries the most weight here. The reader is cold, in discovery mode, and needs a reason to leave their feed. Keep the subject clear (what/who it's for) and hold back the mechanism entirely or tease it lightly. The loop opened here is the one the advertorial or jump page continues.
- Advertorial headline: curiosity is balanced with clarity. The click is already spent; the reader now needs confirmation they're in the right place plus a reason to read. Lead with a benefit-clear subject and keep the mechanism withheld or half-named — the article body is where the mechanism unfolds. A pure mystery tease on an advertorial reads as a bait-and-switch.
- Jump-page headline: curiosity's job here is a handoff. The headline names or strongly teases the mechanism inside a direct promise, and passes the open loop to the video — the video's first line inherits and deepens it. Do not resolve the mechanism on the page; a jump page that explains everything makes the video optional.

Quality check for any curiosity device

Ask three questions: (1) Is the subject clear enough that the right reader knows this is for them? (2) Is the mechanism withheld enough that the next step is required? (3) Does the destination actually close the loop this headline opens? If any answer is no, the curiosity is decorative, deceptive, or leaky — fix it before testing wording.

Related docs: Headline Jobs by Surface — Ad, Advertorial, and Jump Page (which surface carries how much curiosity); Credibility & Promise Calibration — Believability, Proof, and Compliance (curiosity's ceiling is believability); Headline Quality Rubric — The Two-Pass Headline Evaluation (curiosity as a scored element).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_3_CONTENT = `Credibility & Promise Calibration — Believability, Proof, and Compliance

Purpose: this doc teaches the discipline that keeps headlines believed — how to size a promise, when and how to add proof, how to address skepticism, and where compliance constrains what a headline may say. A headline the reader doesn't believe performs worse than a smaller headline they do.

The believability ceiling

Every promise has a ceiling: the largest version of it the reader will still believe. Push past the ceiling and response doesn't just flatten — it collapses, because an unbelievable promise re-frames the whole page as a scam. The ceiling is set by the reader, not the writer: by their past failures ("I've tried five of these"), their sophistication in the niche, and how warm they are. Over-promising kills response on every surface; the temptation is strongest where the reward seems biggest.

Practical rule: write the promise as big as it is true AND believable, then spend your remaining words making it more believable rather than bigger. A slightly smaller promise with proof beats a bigger promise with none.

Specificity is proof

The cheapest credibility device is specificity. "Sharpen Any Garden Tool in 90 Seconds" out-believes "Sharpen Your Tools Fast" — the precise figure implies measurement, and measurement implies reality. Odd, non-round numbers read as more honest than suspiciously round ones. Specificity works on outcomes, timeframes, audiences ("for gardeners over 50"), and mechanisms. Two cautions: specificity must be honest (a made-up precise number is a lie with a decimal point), and specific claims are exactly what platform reviewers and regulators check first.

Proof is avatar-relative

Proof is anything that gives the reader a reason to believe the promise will work for them. Forms include credentials, social proof, studies, testimonials, demonstrations, and before/after outcomes. The critical subtlety: what counts as proof depends entirely on the avatar and market. A laboratory credential is powerful proof for a skincare audience — and an anti-credential in a market that distrusts the scientific establishment; in natural-health niches, conventional authorities are often cast as the villain, and citing them costs trust rather than adding it. A "9-figure" business credential impresses in a business-opportunity market and means nothing to an arthritis sufferer. Before reaching for proof, ask: who does THIS avatar already believe? (See Copy Blocks — The Five Building Blocks of Persuasive Copy on Proof Blocks and anti-credentials.)

Tiny social-proof numbers backfire ("Join 47 happy customers" reads as a warning label). If the number is small, use a different proof form.

Addressing skepticism directly

Mature markets read every promise through a skeptical filter: "sure it does." Strong headline units often pre-empt the objection instead of ignoring it — acknowledging the reader's disbelief ("skeptical? so was she"), leaning on a demonstration rather than a claim, or scoping the promise honestly ("works even if you've failed before" — see the "even if / without" tools in Rhetorical Tools for Headlines — The Craft Toolbox). Handling skepticism is also the natural job of the subheadline in a headline unit: headline carries the promise, subheadline carries the reason to believe.

Timeframes — the double-edged element

A timeframe ("in 30 days") makes a promise concrete and testable — that's why it persuades, and also why it's dangerous. On regulated surfaces (native ads especially), results-timeframe claims draw reviewer scrutiny, and in health-adjacent niches they are frequently disallowed outright. Use timeframes where they are true, provable, and permitted; prefer process timeframes ("a 10-minute routine") over results timeframes ("results in 3 days") when compliance pressure is high. Deliberately omitting a timeframe is often the compliant choice, not a copy weakness.

Industry evidence worth knowing

Split-testing across native advertising has repeatedly found that trust-framed, softer editorial approaches outperform direct offer-first framing on cold traffic — and separately, that advertorial headlines that clearly show what the article is about and lead with a benefit beat pure curiosity teases. The pattern behind both findings: on cold surfaces, believability and relevance do more work than aggression. Save headline directness for surfaces whose job demands it — the advertorial-route reader who has read on and warmed, or the jump page, where the page's whole job is to sell the watch decision.

Compliance is a headline constraint, not fine print

On native platforms, the headline itself is reviewed — and regulators judge ads by the impression the headline creates, not just the page behind it. Non-negotiables on ad and advertorial surfaces:

- No disease or cure claims, no "reverse/prevent" medical language, no "better than medication" framing.
- No fake urgency, invented scarcity, or fabricated news framing ("Breaking:" on an ad is non-compliant).
- No false editorial impression: advertorials must be visibly labeled as advertising content; the editorial STYLE is legitimate, disguising the commercial nature is not.
- Every claim in the headline must be one the page (and the offer) can honestly support.

These rules are platform survival: accounts that fight them lose. Write inside them from the first draft rather than sanding down violations later.

Surface calibration

- Ad headline: heaviest compliance exposure and lowest believability budget — the reader is cold, so promises stay small or implicit and curiosity does the lifting. Proof appears as light seasoning at most (an authority hint, a specific detail), never a stacked case.
- Advertorial headline: still inside native review; benefit-clear but claim-careful. The format lends borrowed credibility, and the subheadline can carry a proof element. Precision beats size here.
- Jump-page headline: direct and promise-forward — not because the reader is warm (they are one click past the feed and still mostly cold), but because the surface's whole job is to sell the watch decision; proof can be stacked more aggressively (a credential plus a specific outcome in one unit) because the page must earn its credibility on the spot. The believability ceiling applies in full — directness is earned by the page's job, never a license for dishonesty. Platform rules still reach this page via the ad that leads to it.

Fictional worked example (sourdough-baking offer): "Bake a Bakery-Quality Loaf on Your First Try — the No-Knead Overnight Method Even Beginners Get Right" carries a big promise (bakery-quality, first try), sized believable by the mechanism (overnight no-knead), scoped by the constraint ("even beginners"), with no regulated claims. The same idea over-promised — "Never Buy Bread Again: Perfect Loaves Guaranteed Every Time Forever" — sails past the ceiling and dies.

Related docs: Headline Jobs by Surface — Ad, Advertorial, and Jump Page (why directness differs by surface); Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap (curiosity's ceiling is believability); Headline Quality Rubric — The Two-Pass Headline Evaluation (believability and skepticism-handling as scored dimensions).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_4_CONTENT = `Angle Selection — Choosing the Big Idea Before Writing a Word

Purpose: this doc teaches the step that comes before headline writing: choosing the angle — the big idea the headline expresses. Angles are identified first, headlines are written second — always. A brilliantly-worded headline on a weak angle loses to a plain headline on a strong one, and no amount of word-tweaking rescues a wrong big idea.

What an angle is

An angle is the big idea the ad leads with — the specific doorway through which the reader enters the story. It is not the product, not the benefit, and not a headline. The same product with the same benefit can be introduced through a dozen different doorways, and which doorway you pick usually matters more than any wordsmithing afterward. A funnel tells one story — the ad is the beginning, the advertorial or jump page is the middle, the sales page or VSL is the end — and the angle is how the ad starts that story.

Hold an angle as an angle statement: one plain line naming the doorway, written with no craft at all ("Warning angle: your current fix is quietly failing and you don't know it"). If it reads like an ad, you've skipped ahead. A good angle statement could produce ten different headlines; a headline can only produce itself.

A gallery of lenses, not a fence

Angles are countless. An angle lives at the intersection of a product, a specific reader, and a specific moment; nobody has catalogued them all, because they can't be catalogued. Certain doorways recur often enough to have earned names — Story, Warning, Discovery/News, Contrarian, Local, Unique Mechanism, Transformation, Social Proof/Authority, plus the honest benefit lead — and they're genuinely useful as lenses: point each one at the product and see what it shows you. But hold them the right way: they are a gallery, never a fence. The families combine freely (a local everywoman stumbling across a discovery is Local + Story + Discovery in one angle); different teachers group them differently, and none of those lists is official; and an angle that fits no family is not a mistake — unclassifiable might mean unfenced, and unfenced might be the edge. The families are lenses for generating and naming angles, never a checklist to test through. Nobody runs one of each.

The three questions every angle must answer

Angles can come from anywhere — the page, the audience's day-to-day life, a customer review, a competitor's ad in a spy tool. The source doesn't matter. What matters is that every angle, wherever it came from, answers three questions before it goes near traffic:

1. Who exactly is this doorway for? Not a demographic — a person. An angle that can't name its one specific reader isn't an angle yet; if you're marketing to everyone, you're marketing to no one.
2. What on the page pays it off? The advertorial and sales page are fixed; whatever doorway the ad opens, those pages must deliver on it. The test is sentiment paid off proportionally — mention is not payoff. You must be able to point at the part of the page (a line or a passage) that delivers the doorway's promise, in roughly the amount the doorway suggests. If you can't point at anything, the angle is wrong for this offer, no matter how good it is.
3. Why hasn't this reader already walked past it? A doorway can name its reader and be fully paid off and still be dead because it's saturated — the reader has seen it forty times this month. Spy tools and feed research show which angles are already invisible to this reader. Fresh doesn't mean exotic; it means this reader hasn't been approached through this door lately.

The three questions are a filter, not a workflow: every generator's output goes through them, and they take well under a minute per angle once the habit is set.

Mine the advertorial first

The most reliable generator of angles is the page itself: the advertorial and sales page were researched, written, and usually tested with real spend before the media buyer arrived, and angles mined from them arrive with the first half of question 2 built in. The full mining workflow — gold lines, naming the idea, loose sorting, merging duplicates, the congruency lift — lives in Extracting Angles from an Advertorial — The Mining Workflow. Mining is the right first move on nearly every campaign, but it is a generator, not the only source, and any teaching that says angles can only come from one place is selling a fence.

Other legitimate sources

Audience observation (the concrete, everyday behaviors the product touches — angles built on observed behavior land as recognition, not advertising); the audience's own words in reviews, ad comments, and forum threads; competitor ads via spy tools (with the caution that a borrowed angle was built to be paid off by the competitor's page — re-check question 2 against yours); and plain invention, which is legitimate as long as the invented angle can still point at its payoff on the page.

Matching the lens to the reader's state

The biggest input to which doorway to lead with is the reader's stage of awareness — question 1 sharpened into what state of mind the reader is in when the ad interrupts them. Unaware readers respond to Warning and Story (surface the pain, or let them recognize themselves in someone else). Problem-aware readers respond to Discovery/News and vivid Transformation. Solution-aware readers who have tried and failed respond to Unique Mechanism and Contrarian (why this attempt ends differently; why the old advice was the problem). Product-aware, skeptical readers respond to proof-heavy Story, Social Proof, and Local. The angle stays constant along the funnel; its directness rises with awareness (see Headline Jobs by Surface — Ad, Advertorial, and Jump Page).

Payoff and proportion

Congruence is sentiment-level and proportional. The page must deliver the feeling and promise the doorway creates, in roughly the amount the doorway suggests — a page that spends one throwaway sentence on the angle's promise before four paragraphs of something else is a bait, whatever it technically "contains." Passage-anchored angles are valid: some angles are carried by the page's arc rather than any quotable line, and they pass the payoff test by pointing at the passage instead. But every angle needs a pointable anchor — no line and no passage means invention, not extraction. Angle drift between funnel steps shows up as good CTR followed by a poor next-step rate: the numbers' way of saying the reader felt a bait-and-switch.

Angle before headline

Keep the wall between the two steps. Deciding which story to start and writing the sentence that starts it are different skills, done at different times. Once the angle list is set, each angle gets several competing headlines — never one headline per angle, and never headlines drafted straight from the advertorial with no angle decision in between. Test breadth first (genuinely different doorways, not synonym swaps), then depth within the winner. A batch of near-duplicate headlines that all rephrase one idea is one angle wearing five outfits, and it teaches nothing about the market.

Fast checklist

- Hold every candidate as a plain angle statement, written for one nameable reader.
- Run the three questions: specific reader? pointable, proportional payoff on the page? not already saturated for this reader?
- Use the families as lenses to generate and name — never as a checklist to test through.
- Mine the page first (see the mining workflow doc), then widen to audience research and spy tools as needed.
- Match doorway to awareness stage; keep one angle running the whole route, directness rising with warmth.
- Only then write headlines — several per angle (see Headline Quality Rubric — The Two-Pass Headline Evaluation for evaluating them).

Related docs: Extracting Angles from an Advertorial — The Mining Workflow (the full extraction workflow this doc hands off to); Headline Jobs by Surface — Ad, Advertorial, and Jump Page (jobs and metrics per surface); Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap (mechanism-led doorways); Headline Quality Rubric — The Two-Pass Headline Evaluation (evaluating expressions of an angle).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_10_CONTENT = `Extracting Angles from an Advertorial — The Mining Workflow

Purpose: this doc teaches the full workflow for mining an existing advertorial and sales page for angles — the most reliable generator of angles, because its output arrives already anchored to what the page can pay off. For what an angle is, the three questions every angle must answer, and the gallery of recurring angle families, see Angle Selection — Choosing the Big Idea Before Writing a Word; this doc assumes that foundation.

Why mine the page first

Two reasons. First, the material is pre-proven: the advertorial and sales page were researched, written, and (on a scaling offer) tested with real ad spend before the affiliate arrived. The writer packed the page with claims, stories, mechanisms, and proof points, and each one is a potential doorway. The job is not to out-write that page; it is to mine it. Second, an idea extracted from the page is by definition already in the page the click lands on — the first half of the payoff question is built in. Whether the page pays it off proportionally still needs checking; mention is not payoff.

Mining is a generator, not an exemption: a mined angle still needs its specific reader, and still has to be a doorway this reader hasn't already walked past — which is exactly where a saturated offer's most obvious gold lines fail. And the reader question works during the mining, not after: which lines read as gold depends entirely on who you're reading for.

Gold lines

A gold line is any line in the advertorial or sales page that could carry an ad on its own — a sharp claim, a human moment, a named villain, a quantified saving, a revealed insider. Gold lines are concrete and specific; filler is abstract and interchangeable. Two things a gold line is not: it is not an angle yet (a typical advertorial yields five to fifteen gold lines containing only three to five genuinely different angles, because good advertorials hammer their central idea from many directions), and gold lines are not the only place page angles live — some angles are carried by the page's arc (the long build of frustration before the reveal, the unnamed villain the whole page circles) rather than any quotable sentence. Those passage-anchored angles are real, and they pass the payoff test by pointing at the passage. Quotable lines are the strongest evidence of payoff, not the definition of it. An angle with no line and no passage to point at is invented, not extracted.

The five-step workflow

Work the advertorial top to bottom, then the sales page, reading as the specific reader — not as the media buyer holding the highlighter.

1. Highlight the gold lines. Mark every sentence that would make that reader feel something specific or learn something concrete, and record the exact quote. If an idea grips but no single line carries it, note the passage instead — an anchor is required either way, because the anchor is the payoff answer.
2. Name the big idea. For each highlight, write the idea in three words or fewer ("hidden failure", "inventor's story", "saves money", "new mechanism"). If it can't be named that tightly, it's two ideas tangled together, or none.
3. Sort with the families — loosely. Try each idea against the recurring families, or flag it as a benefit lead. The families are a loose sorting aid here, not a test: an idea that fits no family but would still make the reader click is still an angle. Lines playing a purely supporting role (statistics, credentials, guarantees) are set aside as proof material — unless one creates its own distinct reason to care for this reader, in which case it stays a candidate angle.
4. Merge the duplicates. The step that turns gold lines into angles, and the one most often skipped. The rule: two entries expressing the same underlying idea are one angle wearing two outfits — merge them, keeping the strongest source quotes attached as proof material. Family labels help spot merge candidates, but the test is always the idea, not the label: two same-family entries can be genuinely different doorways, and one idea can hide under two labels. An advertorial's central thesis typically shows up in four or five gold lines dressed as its mechanism, its myth-busting, its diagnosis, and its analogy — after merging, that's one angle. A list that survives this step honestly is short. Short is correct.
5. Flag the congruency lift, then run the three questions. The advertorial's own headline (or lead claim) goes on the list as angle #1, labeled the congruency lift — the maximum-scent baseline every other angle is trying to beat, and usually worth testing in its own right. It isn't a new angle; it's the purest execution of one angle running the whole route. Then every surviving angle goes through the three questions from Angle Selection: name its specific reader and awareness stage; check proportional payoff (mention is not payoff — a doorway the page only gestures at is still a bait); and check freshness against what's already running on the offer, because the most obvious gold line on a scaling offer is usually the most saturated one.

The output is a deduplicated, source-anchored, stage-tagged angle list — angle statements, not headlines. Headline writing is a separate act that comes afterward: several competing headlines per angle, never one headline per gold line.

Auditing an AI's extraction

Much of this workflow now runs through an AI assistant, and that's a fine way to work — but left to itself, an AI makes one predictable error: it returns gold lines dressed up as angles. Ask for ten angles and half collapse into the same doorway restated as its mechanism, its myth, its diagnosis, and its analogy. The workflow above is the audit of the machine, and what's being checked is distinct underlying ideas, each anchored to the page — not whether the AI used approved family names (its labels are made up on the spot, and labels are cheap; ideas are what get counted).

- Demand anchors: every proposed angle must point at an exact quoted line or a named passage. No anchor means the machine invented it.
- Count ideas, not entries: name each proposal's underlying idea in three words or fewer and force the merge rule — same underlying idea = merge, whatever the labels say. Ten entries collapsing to four ideas is the normal outcome, not a failure.
- Demand the lift: if the batch doesn't include the page's own headline labeled as the congruency-lift baseline, add it — and watch for the sneaky version where the AI includes the page's headline as just another unlabeled "angle".
- Make it answer the three questions: specific reader and awareness stage per angle, proportional payoff, freshness against what's running.
- The member keeps the judgment: the assistant highlights and sorts faster, but which doorway fits the reader is a call only the buyer can calibrate against their own results.

Related docs: Angle Selection — Choosing the Big Idea Before Writing a Word (what an angle is, the three questions, the family gallery — read it first); Headline Jobs by Surface — Ad, Advertorial, and Jump Page (where the mined angle runs); Headline Quality Rubric — The Two-Pass Headline Evaluation (evaluating the headlines written from the angle list).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_5_CONTENT = `Headline Quality Rubric — The Two-Pass Headline Evaluation

Purpose: this is the evaluation doc — the structured way to critique any headline unit, your own or a member's. It is deliberately two passes: first a presence pass (are the right persuasion ingredients here?), then an execution pass (how well is each ingredient done?). Running execution questions before presence questions is how critiques go wrong — polishing the wording of a headline that's missing its Promise Block is rearranging deck chairs.

Before either pass: establish context

A headline can only be judged inside its context. Confirm three things first:

1. Surface — ad, advertorial, or jump page (see Headline Jobs by Surface — Ad, Advertorial, and Jump Page). Each has a different job; the same line can be strong on one surface and wrong on another.
2. Avatar — who is this for, what do they already believe, what have they tried? Blocks only exist relative to an avatar (a credential that's Proof in one market is an anti-credential in another).
3. Angle — what big idea is this headline expressing (see Angle Selection — Choosing the Big Idea Before Writing a Word)? If the angle is weak, fix that first; the rubric evaluates expressions of an angle, not the angle itself.

Pass 1 — Presence (Copy Blocks)

Identify which of the five Copy Blocks are present in the headline unit, given this avatar (full teaching: Copy Blocks — The Five Building Blocks of Persuasive Copy):

- Pain — is the reader's problem named or clearly implied?
- Promise — is a desired outcome stated or strongly implied?
- Curiosity/Mechanism — is there a bridge: something new, teased but not explained?
- Proof — is there a reason to believe, meaningful to this avatar?
- Constraint — is a key objection pre-empted ("without…", "even if…", "in only…")?

Then ask the two presence questions:

- What's missing that this avatar needs? A skeptical market usually needs Proof or a Constraint present; a pain-numb market needs Curiosity/Mechanism (newness); an unaware reader needs Pain or identity relevance before any promise means anything.
- What's present that this surface can't carry? Not every headline needs all five — strong lines usually run two or three blocks. An overstuffed unit scans badly and dilutes its own strongest element.

A useful drafting habit: label the blocks in a draft (mark which phrase is Pain, which is Promise, and so on). Gaps and bloat become visible instantly.

Pass 2 — Execution quality

For each block that is present, score how well it's executed. The execution dimensions, distilled from a checklist used by top direct-response copywriters:

- Specificity — are the claims concrete? Precise details (numbers, timeframes, named mechanisms, defined audiences) out-persuade abstractions. "Vague but big" loses to "specific and slightly smaller."
- Simplicity — does it scan in one breath? Could a distracted reader repeat the idea back after one glance? Complex constructions, stacked clauses, and clever-but-unclear wordplay fail this dimension even when each block is individually strong.
- Believability / skepticism-handling — is the promise inside the avatar's believability ceiling, and is disbelief pre-empted where the market is burned out? (Full treatment: Credibility & Promise Calibration — Believability, Proof, and Compliance.)
- Timeframe — if a when is present, is it honest, permitted, and motivating? A timeframe is a Constraint-block flavor (it answers "how long will this take?"); powerful when allowed, dangerous where compliance forbids results-timing claims. Absence of a timeframe can be the correct compliant choice.

How the external checklist maps onto Copy Blocks (stated once, so there is one system, not two): the widely-taught seven headline elements — curiosity, calling out a pain point, promising a solution, specificity, simplicity, credibility/addressing skepticism, and timeframe — corroborate the house framework directly. Curiosity → the Curiosity Block; pain callout → the Pain Block; promised solution → the Promise Block; credibility → the Proof Block. The remaining three (specificity, simplicity, timeframe) are not extra blocks: specificity and simplicity are quality dimensions of how well every block is executed, and timeframe is a flavor of the Constraint Block. Presence questions belong to Copy Blocks; execution questions refine them.

Two cross-cutting tests

Run these against the unit as a whole:

- Benefit-clear test: after one glance, can the right reader say what's in it for them (or, on an ad, at least whose problem this is about)? Curiosity never excuses total opacity about the subject.
- Message-match test: does this headline continue the exact idea of the step before it, and can the step after it honestly pay off what this headline opens? A headline can score perfectly in isolation and still fail the funnel.

Surface pass — what weighs most where

- Ad headline: Curiosity and Pain (or identity relevance) weigh most; Simplicity is at maximum weight (feed scanning is brutal); Promise stays light; Proof is optional seasoning; compliance-clean phrasing is a hard gate, not a score.
- Advertorial headline: the benefit-clear test weighs most, with Curiosity still open; Pain + Promise pairing across headline and subheadline is the classic structure; Proof fits comfortably in the subheadline; editorial register is a hard gate.
- Jump-page headline: Promise weighs most, executed with maximum Specificity, and Proof stacks more aggressively; the Curiosity/Mechanism block should point INTO the video (tease, never resolve); a Constraint often earns its place ("even if…"). Promise density is a spectrum here — a minimal transformation line and a stacked mega-promise unit are both testable structures, not a right and a wrong (see Headline Jobs by Surface — Ad, Advertorial, and Jump Page).

Worked critique (fictional — houseplant-care offer, advertorial headline)

"This Watering Mistake Is Slowly Killing Your Houseplants — the 'Bottom-Water Reset' That Revives Them in a Week"

Presence: Pain ("slowly killing your houseplants") ✓; Curiosity/Mechanism ("Bottom-Water Reset") ✓; Promise ("revives them") ✓; Constraint/timeframe ("in a week") ✓; Proof — absent. Execution: specificity is decent (named mechanism, one-week frame) but the timeframe claim should be verified honest; simplicity is good (two clean clauses); believability holds — the promise is modest and mechanism-backed; skepticism is not addressed, acceptable for a low-burn niche. Surface fit: benefit-clear ✓, editorial register ✓, curiosity open (the reset is named, not explained) ✓. Verdict: strong advertorial unit; the highest-value test is a variant with a light Proof element in a subheadline.

Critique in this order — context, presence, execution, cross-cutting tests, surface fit — and the feedback stays diagnostic ("your unit has no reason-to-believe for a skeptical market") instead of cosmetic ("try a stronger word here").

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_6_CONTENT = `Rhetorical Tools for Headlines — The Craft Toolbox

Purpose: this doc is the craft toolbox — the recurring rhetorical devices that make a sound headline sharper. Tools come AFTER strategy: pick the surface (Headline Jobs by Surface — Ad, Advertorial, and Jump Page), choose the angle (Angle Selection — Choosing the Big Idea Before Writing a Word), get the right blocks present (Copy Blocks — The Five Building Blocks of Persuasive Copy) — then reach into this box to execute better. A device can polish a strong idea; it cannot rescue a missing one. And these are thinking tools, not templates: understand why each works and build your own lines with them.

1. Questions

A question headline recruits the reader into answering it — and the answer they give themselves is the qualification. "Tools going dull halfway through the season?" makes the right reader nod and the wrong reader scroll on: exactly what you want. Two disciplines: the question must be one your reader answers "yes" (or "I need to know") to — a question inviting a bored "no" ends the interaction; and rhetorical questions with obvious answers read as condescending.
Per surface: shines on ads (self-qualification in discovery mode) and works on advertorials as a pain-confirming opener; usually too soft for jump pages, where a direct promise outworks an inquiry.

2. Numbers and specificity

Numerals stop the scanning eye and imply measured reality. "Revive a Dying Houseplant in 9 Days" out-pulls "Revive Your Houseplants Quickly" — the 9 feels observed. Odd and precise beats round and suspicious. Use numerals, not spelled-out numbers; one strong number beats three competing ones.
Per surface: works everywhere. On ads, numbers add concreteness to an otherwise curiosity-led line; on jump pages they are the natural spine of a specific promise. Caution: results-numbers attract compliance scrutiny on ad/advertorial surfaces — process numbers ("a 10-minute routine") are safer than outcome numbers where review is strict (see Credibility & Promise Calibration — Believability, Proof, and Compliance).

3. Pattern interrupts

A pattern interrupt violates the reader's expectation just enough to force a second look — an unexpected pairing ("the lazy way to a spotless kitchen"), a reversal of received wisdom ("stop watering your plants weekly"), an incongruous detail. The interrupt earns attention; the rest of the unit must immediately convert that attention into relevance, or you've built clickbait.
Per surface: strongest on ads, where the enemy is the scroll. On advertorials, mild interrupts work in service of the story. On jump pages, mostly unnecessary — the reader is already here; clarity of promise beats novelty.

4. Authority reframes

Borrowing a credible frame to reposition the subject: "the pruning rule professional growers won't skip", "why master bakers salt the water, not the dough." The authority is generic and truthful (a profession, a craft tradition) rather than a named endorsement, and it converts a plain tip into insider knowledge. Keep it honest — an invented authority is a lie, and avatar-relative: cite an authority this market actually respects (see the anti-credential warning in Credibility & Promise Calibration — Believability, Proof, and Compliance).
Per surface: excellent on advertorials (editorial register loves an authority frame); useful on ads in small doses; on jump pages, real proof elements (specific results, credentials) do this job better than a soft frame.

5. Negative framing

Leading with what to avoid, stop, or never do: "the watering mistake killing your houseplants", "never sharpen a blade dry." Negativity is magnetic because loss looms larger than gain, and mistake-framing flatters the reader ("you're smart enough to want to know"). It pairs naturally with a Pain Block. Discipline: the page must resolve the negative into a positive path quickly, and fear-mongering past what's true is both a compliance and a trust violation.
Per surface: a workhorse on ads and advertorials (mistake/warning frames are native to editorial style). On jump pages, use sparingly — the surface's job is promise-forward momentum, and dwelling in the negative drains it.

6. "Even if" / "without" clauses

The constraint-killer clause: "…without expensive equipment", "…even if you've killed every plant you've owned." This is the Constraint Block wearing its most common outfit — it names the reader's disqualifying objection and removes it in-line. Choose the ONE constraint that most blocks this avatar; stacking three "withouts" reads desperate and bloats the unit. The clause must be true: an "even if" the offer can't honor is a refund request in advance.
Per surface: valuable everywhere; near-mandatory on jump pages, where a still-mostly-cold reader — one click past the feed — needs their "yeah, but…" answered before pressing play. On ads, one short "without X" can double as a curiosity hook (how could that be possible?).

7. Fascinations

Fascinations are curiosity-driven micro-headlines — specific-but-incomplete lines that each open a small loop: "why the cheapest sharpening stone often beats the premium one (page 3)". They are a body-copy and bullet device more than a headline device, but headline writers train on them because every fascination is a headline in miniature: a specific, concrete detail with the resolution withheld (see Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap).
Per surface: in headline units, a fascination-style line can serve as an ad headline for content-flavored angles. On advertorials, fascinations belong in the body and subheads to sustain read-through. On jump pages, one fascination aimed at the video's content ("at 2:14 you'll see the jig in action") can lift play-through, but the main headline still carries the promise.

Combining tools

Strong units usually run one primary device plus at most one supporting device: a negative frame carried by a number ("the 30-second mistake…"), a question sharpened by an "even if." Three or more devices in one unit compete for the reader's single glance and lose it. When a unit feels overloaded, move the second-best device to the subheadline or cut it — then run the unit through Headline Quality Rubric — The Two-Pass Headline Evaluation before testing.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_7_CONTENT = `Copy Blocks — The Five Building Blocks of Persuasive Copy

Purpose: this is the foundation document for the house copy framework. Copy Blocks are the essential building blocks that every piece of effective sales copy contains — and the scope is ALL copy: headlines, subheadlines, ads, advertorials, emails, VSL scripts, body copy. The headline docs apply Copy Blocks to headline units specifically; this doc teaches the framework itself.

The five blocks

Copy Blocks are often very short phrases — snippets inside a headline or sentence. The five:

1. Promise — the outcome the reader wants.
2. Pain — the problem state they want out of.
3. Proof — the reason to believe.
4. Constraint — the objection named and removed.
5. Curiosity (Mechanism) — the new "how" that bridges pain to promise.

A worked example (fictional — a sourdough-baking offer): "Retired Pastry Chef Reveals the 'Overnight No-Knead Method' That Lets First-Time Bakers Pull a Bakery-Quality Loaf From Their Own Oven — Without Special Equipment or Years of Practice." Proof: "Retired Pastry Chef." Curiosity: "'Overnight No-Knead Method'." Constraint (identity): "First-Time Bakers." Promise: "a bakery-quality loaf from their own oven." Constraint: "without special equipment or years of practice." Connector and filler words are not part of any block — a block is the most concise phrase that carries the element, and no more. (When drafting, it's a useful habit to label each block in your draft so gaps jump out; any annotation style works.)

The canyon metaphor

Picture your customer avatar standing on one side of a canyon — on Pain Plateau — trying to reach the other side, the Promised Land. The Pain Block is where they are now: the complaints, fears, and negative experiences of life without their desired result. The Promise Block is the far side: where they want to go, the transformed life. The Curiosity Block is the bridge — the unique mechanism (or a phrase hinting at it) that answers "what is this new thing, how does it get me from my pain to my promise, and how is it different from everything I've tried?" The Proof Block is the trust that lets them take the first step onto the bridge. And the Constraints are the heavy backpack of mental baggage — the reasons they believe they can't cross — that must be taken off their shoulders before they'll move.

The avatar-context rule (the most important rule in the framework)

Copy Blocks cannot exist outside the psychology of a specific customer avatar in a specific market. Every market has its own pains, its own attractive promises, its own constraints, and its own accepted authorities. The same phrase can be a different block — or no block at all — depending on who is reading. A business credential is Proof to an audience that wants business results and noise to everyone else. In some natural-health markets, conventional medical authorities are cast as the villain, and citing them is an anti-credential — the opposite of Proof. To identify or create blocks, start from the avatar's psychology, the market environment, and the niche sentiment. Never from the phrase alone.

Pain Blocks in detail

Pain Blocks describe the negative experience of living with the core problem: the primary complaint and the secondary ones around it, fears, negative emotions, things the avatar must do but hates doing — real or anticipated. Pain Blocks are NOT every phrase describing the avatar's current state. "Stuck in a rut" is Pain; "brand-new baker" is not — it's an Identity Constraint. The test: a Pain phrase completes "I hate that…", while an identity phrase completes "this isn't for me because I'm a…". Confusing the two leads to copy that describes the reader without moving them.

Promise Blocks in detail

Promise Blocks describe the desired outcome — the experience of life on the other side of the transformation. They often form by reversing the Pain Blocks. They range from generic to deeply specific, and the strongest copy builds a desire progression through four levels:

1. General benefit — the plain result ("you'll bake bread you're proud of").
2. Vivid language — the direct, dimensional impact, often in threes ("the crust will crackle, the crumb will be light, and your kitchen will smell like a bakery").
3. Dimensional language — the result experienced in daily life, including social reactions ("your friends will ask which bakery it came from — and you'll smile and say you made it").
4. Transformative language — the identity shift ("you'll think of yourself as someone who bakes — not someone who tries recipes").

Promises can be logical, emotional, or both; the most effective ones make the future tangible enough to feel.

Proof Blocks in detail

Proof Blocks give the reason WHY the reader should believe the promise will work for them. Forms: credibility markers, social proof, testimonials, studies, endorsements, case studies, before-and-after outcomes, demonstrations. A testimonial quote is typically one whole Proof Block — and often contains other blocks nested inside it (a testimonial that narrates pain-then-promise is Proof wrapping a Pain Block and a Promise Block). Remember avatar-relativity: proof is whatever THIS avatar accepts as evidence, and anti-credentials exist. Avoid proof that undermines itself, like conspicuously tiny counts.

Constraint Blocks in detail

A Constraint is any idea the avatar uses as a reason not to act — the objections they raise with themselves, consciously or not. Whether a constraint is factually true is irrelevant; it is 100% real in the avatar's mind, and it must be addressed, not argued with. The taxonomy:

- Identity Constraints — who they believe they are and what they're capable of ("I'm not a natural baker").
- Values Constraints — what they actually value and whether the offer delivers it ("I don't want shortcuts that sacrifice quality").
- Belief Constraints — limiting beliefs about themselves or about solutions ("good bread needs a professional oven").
- Experience Constraints — past failures restricting what future they can envision ("I tried baking before; it was a disaster").
- Resource Constraints — "I can't do X because I lack Y": time, money, energy, skill, equipment.

Constraint Blocks can state the constraint, allude to it, or handle it. They can be framed positively ("in only 20 minutes of hands-on time") or negatively ("without a stand mixer"). A refined Constraint Block can collapse several objections at once: "in one evening, with supermarket flour, and no special equipment" answers time, resources, and skill together. Constraints are also frequently handled across sentences rather than in one markable phrase — especially in body copy.

Curiosity Blocks in detail

Curiosity Blocks are by far the most important block to understand correctly. This is not curiosity for its own sake — in direct response we want curiosity around the pain and the promise: motivated attention around something NEW that bridges the gap. The Curiosity Block is usually the name of the unique mechanism, or a phrase alluding to it. Beyond the main mechanism, curiosity is also created by tips/tricks/secrets framing, open loops ("in a moment I'll show you…"), fascinations that chain small loops through body copy, and curiosity about aspects of the solution (an ingredient, a module).

The reveal/conceal tension runs on a spectrum from blind to obvious. Blind: "a weird 45-second dough trick" — all mystery, no information; pulls clicks but strains belief. Obvious: naming the technique outright — all information, no gap; nothing left to find out. The best mechanism names sit toward the evocative middle — "the Overnight No-Knead Method", "the bottom-water reset" — revealing enough to feel concrete and real while concealing enough that the reader must take the next step. (Full treatment: Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap.)

Using the framework

Analysis: take any headline or copy section and identify its blocks, in avatar context. Weak copy is usually diagnosable as a missing block (no reason to believe; no constraint handled; no bridge) or a mis-identified one. Construction: strong lines typically combine three to five blocks; not every line needs all five, and overstuffing scans badly. Surface calibration for headlines specifically — ads carry fewer blocks (curiosity-weighted, simple), advertorial units distribute blocks across headline and subheadline, jump-page headlines can stack the most — lives in Headline Jobs by Surface — Ad, Advertorial, and Jump Page, with the evaluation procedure in Headline Quality Rubric — The Two-Pass Headline Evaluation.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_8_CONTENT = `Headlines & Copy — Writing What Gets the Click

Short summary
- Headlines do the heaviest lifting in your funnel, and every headline has exactly one job: winning the next commitment. The ad headline sells the click; the advertorial/landing-page headline sells the read; the jump-page headline sells the play. This doc is the practical/tactical companion — layout, platform rules, fold mechanics, and shipping checklists. For the concepts behind these rules, start with Headline Jobs by Surface — Ad, Advertorial, and Jump Page and Copy Blocks — The Five Building Blocks of Persuasive Copy.

Deep dive

What headlines and copy do across the funnel
- Ads:
 - Job: stop the scroll, signal "this is for me," spark curiosity, and sell the click to your advertorial or jump page — not the product.
 - Style: editorial/news tone (not hype, not coupon-y). Write for interruption contexts; put the core idea first so it survives truncation; assume some placements won't show the full description.
 - Image vs. copy roles: the image catches the eye; the headline converts that attention into the click. Keep images clean — avoid text on images; let the headline do the work.
 - Scope: keep ad headlines broad enough to attract qualified interest; move tighter qualifiers (specific sub-problems, detailed proof) to the landing page. Exception: for low-priced, impulse-friendly offers, you can test product-mention variants in an editorial tone (especially if your image shows the product) to pre-frame buyer intent without going "salesy." Keep the curiosity loop open overall (no product names, prices, or fully explaining the "how" in ads — see Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap).
 - Caterpillar platform constraints: max 90 characters per headline and per description, including any dynamic macros. Use Title Case; avoid ALL CAPS. Macros are optional and count toward 90 characters; use lowercase tokens in curly braces (e.g., {state}, {city}, {year}, {month}, {day_of_week}, {date}, {os}). Use 0–1 macro naturally; 2 only if it reads smoothly and stays location/date-agnostic.
- Landing page / advertorial
 - Job: sell the read — make the click feel worth it, confirm relevance, and pull the reader into the first screen of copy so they keep reading and click through to the offer/VSL.
 - Style/layout: lead with a focused headline; add a concise subheadline when it complements or completes the headline. Headline and subheadline work as one headline unit — persuasion elements are distributed across the pair, and the split is decided by above-the-fold hierarchy and scannability (constraints, proof, or mechanism detail usually ride in the subheadline). Keep a clear visual hierarchy. Aim to keep the headline unit and at least part of the hero image visible above the fold — especially on mobile — using appropriate font sizing and spacing. Use a news-style treatment so it reads like a real headline.
 - Visual synergy and "don't bury the lead": the hero image stops the eye; the headline determines whether they read. Elevate the primary angle/pain into the headline; move broader descriptors into the subheadline. Aim for "click → makes sense → scroll" in under a second; each headline should pair with a believable hero image. As a rule of thumb, if no part of the hero image appears above the fold on a real phone, your headline unit is likely too long — tighten wording or move details below the fold. Keep bylines/badges/decorative elements from crowding the fold; reduce padding/line spacing and shrink logos as needed for mobile.
- Jump pages (bridge pages) to VSLs
 - Job: sell the play. Treat as a second ad: a short headline unit from your chosen angle — the most direct, promise-forward surface in the funnel — a tight paragraph, and a clear "Watch the Video" CTA. Create multiple variants across angles. Keep curiosity, but make the problem/solution category clear; derive angles and language from the VSL's hook, mechanism, and pains, and hand the open loop to the video rather than resolving it on the page. Keep this page very short and tightly matched to the VSL. Promise density here is a testing variable — from a minimal transformation line to a stacked promise unit (see Headline Jobs by Surface — Ad, Advertorial, and Jump Page).
- Offer pages
 - Fixed by the affiliate network — you can't edit the offer page's headline; pre-frame visitors with congruent ad and LP headlines so the offer feels like the natural next step.

Copy Blocks — the analysis tool (full teaching: Copy Blocks — The Five Building Blocks of Persuasive Copy)
- Purpose: Use Copy Blocks to analyze and edit headlines; it's a flexible tool, not a mandatory formula. It's most impactful on landing pages/advertorials/jump pages where you have room; ad headlines are usually simpler and focused on qualifying the click.
- Five blocks
 - Promise: the outcome/benefit they want (tangible or emotional).
 - Pain: the frustration/problem they feel now (in their words).
 - Proof: credibility that fits the avatar (authority, social proof, research).
 - Constraint: what's not required ("without meds," "no training," "in minutes a day").
 - Curiosity: the mechanism or intriguing gap that bridges Pain to Promise.
- How to use them
 - Where they matter most: Use more blocks on landing pages/advertorials/jump pages; for ads, keep headlines simple to qualify the right click and let the page carry Proof/Constraint.
 - Treat blocks like building bricks — combine only what serves the angle. Not every headline needs all five; strong lines often mix two or three. Label blocks in drafts to spot gaps and tighten.
 - Curiosity that sells: hint a concrete, unique mechanism ("how it works") — what it is, how it moves me from pain to promise, and how it differs from what I've tried; avoid empty intensifiers.
 - Proof that fits: pick authority that resonates with your audience; the same credential can attract one avatar and repel another. Avoid oddly tiny social-proof counts.
 - Copy velocity: front-load impact; condense each element to its smallest effective phrasing so benefits/mechanism/credibility land fast. Move extra constraints/proof to the subheadline if the headline gets bulky.

Angle first, words second (full teaching: Angle Selection — Choosing the Big Idea Before Writing a Word)
- Define a specific "reason to buy" frame (e.g., expert breakthrough, social momentum, non-chemical solution, mechanism/tech benefit, personal story, cost/value contrast).
- Breadth then depth: start by testing distinctly different angles; when one wins, iterate smaller wording changes within that angle. Avoid batches of near-duplicates that just swap synonyms.
- Two-headline concept across steps: the ad opens a curiosity gap and earns "I see me"; the LP continues the same angle/story, pays off the promise/mechanism quickly, and earns "I see the solution/what I'm after."
- Congruence: keep the same core idea across ad headline → LP headline and article/jump-page lead. Mirror the ad's promise/mechanism in the LP headline unit. Don't invent details the body copy can't support; derive angles from the advertorial/VSL's story, mechanism, and claims so the headline flows naturally into the page.
- Guardrails and targeting: decide who you're speaking to and why it matters; you can tailor by audience segment when it clarifies fit (e.g., younger "work-stress/unwind" vs. older "fall/stay asleep").

How to write high-performing ad headlines
- Strategy and style
 - Spark curiosity and pre-qualify the right click; let the advertorial or VSL do the deeper selling.
 - Prefer clarity + curiosity over vague clickbait. Short and substantive beats short and vague. Tease the fix; don't pitch the product.
 - Keep descriptors varied; don't repeat the same jargon/mechanism term across most lines. Include the core problem keyword for clarity when helpful.
 - Don't bury the lead: put the core idea up front so it survives truncation; assume many placements won't show a description.
- Platform rules (native/Caterpillar)
 - ≤90 characters for each headline AND description, including macro tokens.
 - Title Case; avoid ALL CAPS. Avoid text on images; Caterpillar prefers clean image + headline units.
 - Macros are optional and count toward 90 chars; use lowercase tokens in curly braces (e.g., {state}, {city}, {year}, {month}, {day_of_week}, {date}, {os}). Use naturally; 1 macro per headline is typical (2 only if it reads smoothly). Keep promises location/date-agnostic so macro swaps don't break meaning. Mix macro/no-macro variants.
- Content ingredients to consider
 - Pre-frame who it's for (avatar/pain), hint the mechanism ("how it works"), seed light credibility, and use specific words. Lead with the buyer's emotion/problem; echo their language when helpful.
 - Keep initial ad headlines broad enough to invite a wide swath of qualified prospects; move narrower qualifiers to the landing page. Avoid weather/time-dependent or hyper-narrow hooks unless intentionally micro-targeting.
- Descriptions (when shown)
 - Use one ultra-brief, universal description across your Round-1 headlines. Its job: reinforce the hook (benefit/mechanism/authority), sustain curiosity, subtly pre-qualify, and add a low-friction CTA. Do not duplicate or complete the headline; keep ≤90 characters; macros optional. "Learn More" is a safe default CTA.

How to write high-performing landing-page headlines
- Strategy and style
 - Pay off the click with clear problem/solution framing, hinting at "how it works" (unique mechanism), appropriate proof, and timeframes as needed — keeping every claim inside the believability ceiling and platform rules (see Credibility & Promise Calibration — Believability, Proof, and Compliance). Longer is fine if it stays readable and scannable above the fold on mobile. Use a subheadline when it adds clarity; skip it when the headline carries the job on its own.
 - Treat LP headlines as a separate set from ad headlines; adapt them to the LP's job (explain/engage) while staying angle-congruent. Don't import jump-page "mystery box" teasers into full advertorials.
 - Ensure the headline–image pair produces "click → makes sense → scroll" quickly; you should be able to imagine a matching hero shot for each headline; mismatches kill engagement.
- Subheadlines and hierarchy
 - Subheadlines are optional — use them to bridge pain → solution and to carry extras (authority, constraints, specificity). Maintain above-the-fold integrity on mobile with a clear visual hierarchy (headline is primary, subheadline secondary). Aim to keep the headline unit and at least part of the hero image visible above the fold; if the hero image doesn't peek above the fold, the unit is probably too long and needs tightening. Tighten line spacing, trim padding, and shrink secondary elements to fit real phones.
- Message match and narrowing
 - Ads "fish wide"; the LP narrows to the solution. Maintain strict alignment so visitors feel "I landed where I expected." Keep the body copy stable while testing headline/hero variations early on; isolate impact to learn which angle pulls readers into the same advertorial.

Jump pages to VSLs
- Treat these as short "second ads": a clear, angle-led headline unit — direct and promise-forward — 1–2 tight paragraphs derived from the VSL's core hook/mechanism/pain points, and a dominant "Watch the Video" CTA. Build multiple angle variants. Curiosity is welcome, but the primary line should still name the problem/solution category; the open loop belongs to the video.

Quality checklist before you ship
- Angle congruence: ad headline ↔ LP headline ↔ article/jump-page opening are the same idea; LP feels like a natural continuation within one second.
- Copy Blocks audit: right mix of elements without bloat; can you add Curiosity or Proof without clutter? Can constraints move to the subheadline? For ads, keep it light (1–2 blocks). (Full two-pass procedure: Headline Quality Rubric — The Two-Pass Headline Evaluation.)
- Copy velocity and clarity: no filler; sharp words first; Title Case; avoid random capitalization. Use numerals; drop weak qualifiers; compress to one clause where possible.
- Editorial native tone: no hype, price-first, or product-stuffed headlines. Avoid "Breaking"/"Breaking News" language in ads — it's non-compliant.
- Distinct angles: are variants meaningfully different in idea, not just minor word tweaks?
- Visual synergy: clean, readable unit — avoid text on images; the image stops the scroll, the headline qualifies the click. On LPs, headline and hero image deliver the same idea at a glance; keep bylines/badges from crowding the fold.
- Mobile first: aim to keep the headline unit and at least part of the hero image visible above the fold; obvious scan path; headline clearly primary; subheadline secondary; reduce padding/line spacing; test on a real phone.
- Macro correctness (ads): lowercase tokens in curly braces (e.g., {state}, {city}, {year}, {month}, {day_of_week}, {date}, {os}); count tokens toward the 90-char limit; keep promises location/date-agnostic; mix macro/no-macro variants.
- Description (ads): one universal line that supports but doesn't duplicate the headline; ≤90 characters; stands on its own when some placements hide it.

Common pitfalls
- Overstuffing every headline with all five blocks; bulky, hard-to-scan lines underperform. Move extras to the subheadline.
- Angle lock-in: repeating one trope (e.g., locale/inventor/mechanism term) across most lines.
- Angle mismatch between ad and LP causing decent ad CTR but low LP CTR.
- Vague curiosity-only ad headlines that don't pre-frame the pain/problem — cheap clicks, poor downstream performance.
- Broad, catch-all headlines that "talk to everyone" instead of the subset you want.
- Burying the lead: hiding the real angle in body copy or a subheadline; letting a long headline unit push key content below the fold on mobile; subheadlines visually competing with the headline.
- Text on images (especially in Caterpillar) and "advertising-y" phrasing in ads that tries to sell too early.
- Reusing the same headline across ad and LP by default; each surface has a different job — adapt the copy while keeping the same angle.
- Copying competitor headlines verbatim from spy tools rather than translating the angle to your audience and traffic source.`;

const DOC_9_CONTENT = `Word Choice for Headlines — Concrete Words, Emotional Charge, and Word Economy

Purpose: this doc teaches how individual word choices make or break a headline — why concrete words out-pull abstract ones, how emotionally charged words work (and when they backfire), and how to make every word earn its place. It explains the concepts; the practical tools for applying them are the Context Word Dictionary and the Power Word Dictionary in the Creative Drive (see the handoff at the end).

Concreteness beats abstraction

Concrete words engage the reader's mind like a near-experience: a word that names a specific time, a motion, a place, or a sensation makes the reader briefly live the line instead of merely parsing it. Abstract words slide off — the reader agrees vaguely and keeps scrolling. This is the word-level version of a principle the headline set already teaches: specificity is proof (see Credibility & Promise Calibration — Believability, Proof, and Compliance). A headline built from concrete context words feels observed and real; a headline built from abstractions feels like marketing.

Concrete context words come in a few useful families:

- Time words anchor the line in a lived moment: tonight, overnight, mornings, every winter, before, finally. Fictional before/after (a houseplant-care offer): "Improve Your Plant Care Routine" is timeless and weightless; "The Overnight Watering Reset That Revives a Wilting Fern by Morning" happens somewhere in time — the reader can picture the evening and the morning.
- Insight words mirror the reader's mental journey — discovering, realizing, noticing, wondering, understanding, secret (in its honest sense: something not yet known to the reader): "Better Sleep Advice" is inert; "What Light Sleepers Finally Understand About Their 3 A.M. Wake-Ups" dramatizes the moment of realization the reader wants to have.
- Motion, space, and relativity words give the line physical direction — from, toward, behind, under, climbing, dropping, front, edge: "Manage Desk Discomfort Effectively" floats in abstraction; "The Small Change Behind the Chair That Takes Desk Ache from Constant to Gone" has geography and movement.

The test in every case: can the reader picture it or feel it happening? "Effectively," "efficiently," "solution," "optimize," "improve" fail that test; "overnight," "behind," "wilting," "3 a.m." pass it.

Emotional charge is a dial, not a switch

Power words are words that carry a specific emotion — and the emotion is the point. A charged word works when it attaches the right feeling to the right part of the persuasion, which in Copy Blocks terms (see Copy Blocks — The Five Building Blocks of Persuasive Copy) means matching the word's emotion to the block it lives in:

- Fear and pain words belong in Pain and negative framing — warning, mistake, ruined, draining, trap, silently. Fictional line: "The Repotting Mistake That's Quietly Killing Healthy Houseplants" — one fear-family word ("mistake," amplified by "quietly killing") powers the Pain Block.
- Desire and aspiration words belong in the Promise — thriving, effortless, finally, transform, lush. "From Struggling Stems to a Lush Windowsill — Without New Equipment" puts the charge where the promise lives.
- Temptation and curiosity words belong in the Curiosity Block — little-known, unexpected, behind-the-scenes, overlooked, unconventional. "The Overlooked Step Professional Growers Never Skip" charges the gap, not the claim.
- Security and trust words belong in Proof and constraint-softening — proven, tested, reliable, backed, gentle. "The Nursery-Tested Method Even First-Time Plant Owners Get Right" spends its charge on believability.

The dial discipline: one deliberately charged word per line. A single charged word in an otherwise plain, concrete sentence stands out and does real emotional work. Stack several — "Shocking Secret Miracle Method Destroys Plant Problems Forever" — and the words cancel each other into hype; the reader's scam-alarm fires and the whole page loses credibility. Charge is powerful precisely because it is scarce.

Before/after for over-charge: "Insane Game-Changing Hack Obliterates Brown Leaf Tips Instantly" (four charged words, zero believability) versus "The Ten-Second Trim That Stops Brown Leaf Tips from Spreading" (one modestly charged idea, concrete and believable).

The anti-power-word: empty intensifiers

"Amazing," "incredible," "unbelievable," "shocking," "mind-blowing" are the opposite of power words. They simulate charge without carrying a specific emotion or pointing at a specific unknown — volume with no signal. A true power word makes the reader feel something particular (fear of a named mistake, desire for a pictured outcome); an empty intensifier just announces that the writer wants them to feel something. This is the same failure the Curiosity Mechanics doc flags: loud-but-vague loses to specific-but-incomplete every time (see Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap). If a word could be deleted and replaced with any other superlative without changing the meaning, it is empty — cut it and spend the slot on something concrete.

Word-choice implications for compliance

Some charge families are restricted regardless of craft: cure/reverse/prevent medical language, "guaranteed" and "risk-free" claims, and fabricated-urgency vocabulary ("last chance," "expires tonight" when nothing expires) are native-platform review triggers and are mostly off-limits on cold surfaces. This doc does not re-teach compliance — the full rules live in Credibility & Promise Calibration — Believability, Proof, and Compliance. The word-choice takeaway is simply: when reaching for a fear, greed, or urgency word, check whether it belongs to a restricted family before checking whether it is persuasive.

Word economy

Every word in a headline pays rent or gets evicted:

- Verbs over adjectives: verbs create motion, adjectives decorate. "Revive a Wilting Fern" beats "Great Results for Unhealthy-Looking Ferns."
- Numerals over spelled-out vagueness: a numeral is concrete, scannable, and stops the eye.
- Cut the freeloaders: qualifiers ("really," "very," "quite"), throat-clearing ("Here's why…"), and duplicate modifiers add length without adding pull.
- Front-load the strongest word: the reader decides in the first beat of the line, and on ad placements the tail may be truncated anyway — the word that carries the headline should come as early as grammar allows.

Audience mirroring

The highest-charge word available is usually the one the avatar already uses. A phrase lifted from how real prospects describe their problem — forum language, review language, the words they type into search — lands with more force than any copywriter's synonym, because it produces instant recognition: "that's exactly it." Before hunting a dictionary for a stronger word, hunt the audience's own language for the word they would have written. This is the word-level application of angle work (see Angle Selection — Choosing the Big Idea Before Writing a Word).

Descriptiveness scales with the surface

How many descriptive words a headline can carry is set by reader warmth and available room, not by a count. A cold feed reader gives the line one glance, so an ad headline compresses: fewer words, each concrete, strongest first. A reader who clicked has granted more attention, so an advertorial or jump-page headline unit can breathe — more descriptive weight, spread across headline and subheadline. The real ceiling on any surface is scannability and the mobile fold: the moment a line stops being graspable in one glance, it is too long, whatever its word count (see Headline Jobs by Surface — Ad, Advertorial, and Jump Page).

Ad vs. advertorial word deployment

The same word-choice doctrine deploys differently by surface:

- Context words: on an ad, plant one front-loaded concrete anchor — a single vivid time/place/sensation detail early enough to survive truncation. On an advertorial or bridge-page headline unit, concreteness can layer: a concrete headline anchor plus further concrete detail in the subheadline.
- Power words: scrutiny inverts with warmth. The ad faces the coldest reader plus direct platform review, so high-charge fear, greed, and urgency words carry double risk there — the reader disbelieves them and the reviewer flags them. The advertorial reader has self-selected by clicking, so moderate charge lands as resonance rather than hype (restricted compliance families stay off-limits content-wide).
- Charge budget scales with the unit: one charged word absolute on a standalone ad headline. An advertorial headline unit may distribute charge across the pair — for example a pain word in the headline and a trust word in the subheadline — without any single line reading as hype.

Your practical tools: the two dictionaries in the Creative Drive

This doc teaches why word choice works; the working inventories live in the Creative Drive. The Context Word Dictionary collects concrete context words organized by family (time, insight, relativity/motion/space) — use it when a line feels abstract and you need a concrete anchor. The Power Word Dictionary collects emotionally charged words grouped by the emotion they trigger (fear, desire, encouragement, anger, greed, security, temptation) — use it when a line is concrete but flat and you know which emotion the block calls for. Draft first, then reach for the dictionaries deliberately: pick the family that matches the job, choose one word, and re-read the line against the one-charged-word rule.

Related docs: Headline Jobs by Surface — Ad, Advertorial, and Jump Page; Credibility & Promise Calibration — Believability, Proof, and Compliance; Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap; Headline Quality Rubric — The Two-Pass Headline Evaluation; Rhetorical Tools for Headlines — The Craft Toolbox; Copy Blocks — The Five Building Blocks of Persuasive Copy.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const HEADLINE_SEED_DOCS: HeadlineSeedDoc[] = [
  {
    slug: "headline-jobs-by-surface",
    title: "Headline Jobs by Surface — Ad, Advertorial, and Jump Page",
    docClassTarget: "overview",
    taxonomyTags: ["headline", "copywriting"],
    content: DOC_1_CONTENT,
    adminNotes:
      "Anchor/router doc for the headline concept set (Task #1994): defines the three surfaces (ad/advertorial/jump page), the two funnel routes, the destination-defined jobs (click/read/play), the headline-unit convention, and the promise-density spectrum. All other headline docs use this vocabulary. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "curiosity-mechanics",
    title: "Curiosity Mechanics — Open Loops, Mechanism Teases, and the Curiosity Gap",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "hook", "copywriting"],
    content: DOC_2_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994): curiosity gap, open loops, withhold-the-how-not-the-what, blind→obvious mechanism-naming spectrum, curiosity anchored to pain→promise, per-surface curiosity weighting. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "credibility-promise-calibration",
    title: "Credibility & Promise Calibration — Believability, Proof, and Compliance",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "copywriting"],
    content: DOC_3_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994): believability ceiling, specificity-as-proof, avatar-relative proof and anti-credentials, skepticism handling, timeframe caution, native-platform compliance woven in (no disease/cure claims, honest framing, labeling). Evidence references (soft-trust-vs-direct split test; benefit-clarity findings) are unattributed in body per the house rule. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "angle-selection",
    title: "Angle Selection — Choosing the Big Idea Before Writing a Word",
    docClassTarget: "curated",
    taxonomyTags: ["angle", "headline"],
    content: DOC_4_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994; rewritten Task #2095 to match the reworked Copywriting Foundations angle docs): angles-first-headlines-second, angle statements, gallery-of-lenses-not-a-fence (recurring families — Story/Warning/Discovery/Contrarian/Local/Unique Mechanism/Transformation/Social Proof + benefit lead — never a taxonomy or checklist), the three-question test (specific reader / proportional pointable payoff — mention is not payoff / not already saturated), mine-the-advertorial-first as the most reliable generator (hands off to the mining-workflow doc), awareness-stage lens matching, breadth-then-depth. Complements the existing live 'Angles — Finding What Makes People Buy' doc (angles node) — this one is scoped to angle selection FOR HEADLINES. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "angle-extraction-workflow",
    title: "Extracting Angles from an Advertorial — The Mining Workflow",
    docClassTarget: "curated",
    taxonomyTags: ["angle", "headline", "copywriting"],
    content: DOC_10_CONTENT,
    adminNotes:
      "Angle doc set (Task #2095): the standalone extraction-workflow companion to 'Angle Selection — Choosing the Big Idea Before Writing a Word'. Mirrors the member doc 'Extracting Angles from Existing Copy' (Copywriting Foundations doc 3): gold lines (not angles yet; passage-anchored angles are real), five-step workflow (highlight → name the idea → sort loosely → merge duplicates → congruency lift + three questions), and the AI-audit rules (demand anchors, count ideas not entries, demand the lift, three-questions answers, buyer keeps judgment). Points back to Angle Selection for the three questions and the family gallery. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "headline-quality-rubric",
    title: "Headline Quality Rubric — The Two-Pass Headline Evaluation",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "copywriting"],
    content: DOC_5_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994): the evaluation doc. Two-pass structure per the settled framework: presence pass = Copy Blocks; execution pass = the external 7-element checklist's quality dimensions (specificity, simplicity, believability/skepticism, timeframe) — presented as corroboration of the house framework with the explicit element→block mapping, never as a rival checklist. The scoring/critique ORDER is our synthesis (the source deconstructs examples but has no scoring framework). " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "rhetorical-tools",
    title: "Rhetorical Tools for Headlines — The Craft Toolbox",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "hook", "copywriting"],
    content: DOC_6_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994): craft toolbox — questions, numbers/specificity, pattern interrupts, authority reframes, negative framing, even-if/without clauses, fascinations — each with per-surface shine/misfire notes. Deliberately NO fill-in-the-blank templates (anti-regurgitation guardrail): devices are taught as thinking tools with fictional annotated examples only. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "copy-blocks-essential",
    title: "Copy Blocks — The Five Building Blocks of Persuasive Copy",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "copywriting"],
    content: DOC_7_CONTENT,
    adminNotes:
      "Headline concept set (Task #1994): the upgraded Copy Blocks foundation doc, distilled from the house 'Copy Blocks Essential Understanding' PDF — full 5-block teaching, canyon metaphor, avatar-context rule, pain-vs-identity-constraint distinction, constraint taxonomy (identity/values/belief/experience/resource), promise desire-progression (general→vivid→dimensional→transformative), proof avatar-relativity + anti-credentials, curiosity blind→obvious spectrum. Scope: ALL copy, not just headlines. The emoji marker notation from the PDF is intentionally NOT reproduced as a convention (mentioned only as an optional annotation habit). " +
      "SUPERSESSION NOTE: this doc replaces the coverage of the thin live doc 'What is Copy Blocks?' (one paragraph). On approval, consider retiring/merging that live doc — do NOT delete it as part of this seed. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "headlines-and-copy-revision",
    title: HEADLINE_LIVE_DOC_TITLE,
    docClassTarget: "curated",
    taxonomyTags: ["headline", "hook", "copywriting", "conversion"],
    content: DOC_8_CONTENT,
    isRevision: true,
    updateSummary:
      "Reconciliation revision (Task #1994), light edit not a rewrite: aligns vocabulary with the new headline concept set (three surfaces ad/advertorial/jump page; 'sells the click/read/play' jobs; 'headline unit' for headline+subheadline; 'jump page' as primary term over 'bridge page'), adds cross-references to the new concept docs by title, and deliberately re-scopes this doc as the practical/tactical companion — fold/layout rules, hero-image pairing, platform 90-char limits and macros, mobile checks, ship checklist all stay — while conceptual depth (curiosity mechanics, believability calibration, angle theory, Copy Blocks foundation, two-pass rubric) is deferred to the new docs. Also replaces the 'Lego' brand mention with a neutral phrase.",
    adminNotes:
      "REVISION PROPOSAL for the live doc 'Headlines & Copy — Writing What Gets the Click' (staged with updateKind='update' + targetLiveDocId; the live row is untouched until approval). See updateSummary for the change scope. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "word-choice-for-headlines",
    title: "Word Choice for Headlines — Concrete Words, Emotional Charge, and Word Economy",
    docClassTarget: "curated",
    taxonomyTags: ["headline", "copywriting"],
    content: DOC_9_CONTENT,
    adminNotes:
      "Headline concept set companion (Task #1997): word-choice doctrine — concreteness beats abstraction (context-word families: time/insight/relativity-motion-space, before/after pairs per family), emotional charge as a dial (power-word emotion families mapped to Copy Blocks; one-charged-word rule; stacked charge = hype), empty-intensifier ban restated as the anti-power-word, short compliance word-family deferral, word economy (verbs/numerals/front-loading), audience mirroring, surface-scaled descriptiveness, and an explicit ad-vs-advertorial word-deployment section (house-doctrine synthesis — the dictionary sources make no surface distinction). Ends with the Creative Drive handoff naming the Context Word Dictionary and Power Word Dictionary. Deliberately NO raw word lists, density percentages, or word-count rules — conceptual teaching with small curated example word sets and fictional toy-domain examples only. " +
      "Doc-specific provenance (admin-only, never in body): Sharethrough/Nielsen context-word research and the Context Word Dictionary (Creative Drive); SmartBlogger power-word dictionary; Brax article on power words in native ads. " +
      SOURCE_SET_NOTE,
  },
];

// ── Idempotent seed ──────────────────────────────────────────────────────────

/**
 * Seeds the 10 headline-concept drafts into the AI Document Review queue.
 * Insert-only: rows already present for (source, sourceVideoTitle) are skipped
 * entirely so reviewer edits/decisions are never clobbered. Returns a summary
 * for boot logging.
 */
export async function seedHeadlineConceptsStaging(): Promise<{
  inserted: number;
  skipped: number;
}> {
  // Serialize concurrent boots: without this, two API processes booting at
  // the same moment both pass the check-then-insert and seed duplicates
  // (observed once: double the expected row count). Uses a TRANSACTION-scoped advisory
  // lock on a pinned connection — `db` is backed by a pg.Pool, so a
  // session-level lock acquired via a bare db.execute() could land on a
  // different connection than the seed queries (no real mutual exclusion) and
  // the unlock could land on yet another (leaked lock). The xact lock
  // auto-releases on commit/rollback, and running the whole body through `tx`
  // pins every query to the locked connection.
  const SEED_LOCK_KEY = 0x68646c73; // "hdls"
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    return seedHeadlineConceptsLocked(tx);
  });
}

type SeedExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedHeadlineConceptsLocked(tx: SeedExecutor): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;

  // Resolve the item-8 revision target ONCE, by exact live-doc title.
  const [liveTarget] = await tx
    .select({ id: aiLiveDocumentsTable.id })
    .from(aiLiveDocumentsTable)
    .where(eq(aiLiveDocumentsTable.title, HEADLINE_LIVE_DOC_TITLE))
    .limit(1);

  for (const doc of HEADLINE_SEED_DOCS) {
    const [existing] = await tx
      .select({ id: kbStagingDocsTable.id })
      .from(kbStagingDocsTable)
      .where(
        and(
          eq(kbStagingDocsTable.source, HEADLINE_CONCEPTS_SEED_SOURCE),
          eq(kbStagingDocsTable.sourceVideoTitle, doc.slug),
        ),
      )
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }

    if (doc.isRevision && !liveTarget) {
      // Never guess the revision target. Loud skip; retried next boot.
      console.error(
        `[seedHeadlineConceptsStaging] SKIPPING revision draft "${doc.slug}": live doc "${HEADLINE_LIVE_DOC_TITLE}" not found in ai_live_documents — cannot resolve targetLiveDocId.`,
      );
      continue;
    }

    await tx.insert(kbStagingDocsTable).values({
      title: scrubAll(doc.title),
      category: "curriculum",
      content: scrubAll(doc.content),
      tags: doc.taxonomyTags.join(", "),
      source: HEADLINE_CONCEPTS_SEED_SOURCE,
      sourceVideoTitle: doc.slug,
      // status defaults to 'pending_review' — human review gate absolute.
      homeRoot: "concepts",
      node: "headlines-and-copy",
      taxonomyTags: doc.taxonomyTags,
      docClassTarget: doc.docClassTarget,
      ceiling: "conceptual",
      handoff: "coaching",
      docType: "truth_draft",
      originType: "ai_synthesized",
      adminNotes: doc.adminNotes,
      ...(doc.isRevision && liveTarget
        ? {
            updateKind: "update",
            targetLiveDocId: liveTarget.id,
            updateSummary: doc.updateSummary,
          }
        : {}),
    });
    inserted++;
  }

  console.log(
    `[seedHeadlineConceptsStaging] done: ${inserted} inserted, ${skipped} already present (of ${HEADLINE_SEED_DOCS.length}).`,
  );
  return { inserted, skipped };
}
