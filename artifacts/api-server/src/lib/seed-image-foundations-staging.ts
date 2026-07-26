import { db } from "@workspace/db";
import { kbStagingDocsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { scrubPrivateContent, rebrandOldBrandContent } from "./content-privacy-filter.js";
import { scrubConfidentialTerm } from "./confidential-term-repair.js";

/**
 * Image Foundations KB doc set (Task #2010) — seeds 8 DRAFTS into the
 * `kb_staging_docs` AI Document Review queue on boot:
 *
 *   - 7 new concept documents on image selection for native-ad affiliate
 *     campaigns (image jobs by funnel stage, faces & gaze, visual curiosity,
 *     color evidence-vs-folklore, thumbnail composition, the UGC-style
 *     default, and the absolute compliance bans), grounded in the completed
 *     deep research at research/image-foundations/report.md (~70 tier-rated
 *     sources).
 *   - 1 reconciliation REVISION draft of the existing live doc
 *     "Creative Strategy — Ads, Images & Landing Pages That Work Together"
 *     (staged with updateKind='update' + targetLiveDocId so reviewer tooling
 *     applies it as a revision — the live row is never touched here).
 *
 * ROLE FRAMING (applied throughout): BTS members are performance affiliate
 * marketers running UGC-style advertorial funnels on native networks — NOT
 * brand advertisers. Brand-advertiser doctrine (brand colors, logos, CTAs or
 * text in creative, feed auditing, polish-for-luxury) is filtered out or
 * inverted. Standing scope rulings: concept-only (no example images), no
 * testing doctrine, no offer-specific winner lists, compliance = the seven
 * absolute bans taught as universal, no text in images ever, no pricing in
 * images, no white/light backgrounds, UGC-style is the default doctrine.
 *
 * HUMAN GATE ABSOLUTE: everything lands with the default `pending_review`
 * status. Nothing auto-approves; nothing writes to `ai_live_documents`.
 *
 * IDEMPOTENCY CONTRACT (same as seed-headline-concepts-staging.ts): the key
 * is (source = IMAGE_FOUNDATIONS_SEED_SOURCE, sourceVideoTitle = per-doc
 * slug). If a row exists for the key — whatever its status or edits — the
 * insert is skipped entirely. Insert-only; never updates. Reviewer edits are
 * never clobbered or resurrected.
 */

// ── Idempotency marker ───────────────────────────────────────────────────────

/** `kb_staging_docs.source` marker for every row this seed creates. */
export const IMAGE_FOUNDATIONS_SEED_SOURCE = "image_foundations_seed";

/** Title of the live doc item 8 revises (resolved to an id at seed time). */
export const IMAGE_LIVE_DOC_TITLE =
  "Creative Strategy — Ads, Images & Landing Pages That Work Together";

function scrubAll(text: string): string {
  return scrubPrivateContent(rebrandOldBrandContent(scrubConfidentialTerm(text)));
}

// ── Shared provenance footer (admin-only; attribution lives here ONLY) ──────

const SOURCE_SET_NOTE =
  "Source set (admin-only provenance — body text carries NO attribution per the unified-house-teaching rule): " +
  "Image Foundations deep research report (research/image-foundations/report.md, July 2026; ~70 tier-rated sources). " +
  "Academic anchors: gaze-cueing replication line (Frontiers in Psych 2017 banner study; Applied Cognitive Psych 2011; Psych & Marketing 2023; JCR 2021 'How the Eyes Connect to the Heart'; JAR 2018), " +
  "picture-word consistency (JMR 1987 lineage), visual concealment/curiosity (Journal of Marketing 2020 six-experiment concealment paper; Loewenstein 1994), " +
  "color science (Journal of Marketing 2024 'Color Me Effective' saturation-potency; JCR 2017 saturation-size; color-in-context theory; JAMS 2012 congruence-over-hue), " +
  "visual complexity inverted-U (JAMS 2025; IJRM 2025), UGC/authenticity (JIM 2023 meta-analysis; JM 2019 'Does It Pay to Be Real?'; JAR 2025 luxury counter-evidence), " +
  "post-click quality penalties (KDD 2015; WWW 2016 native-ad pre-click quality). " +
  "Platform doctrine and policy: Taboola/Realize creative best practices + prohibited content + health & beauty FAQ (2025), Outbrain/Teads guidelines, MGID Compliance Guidebook, Revcontent policies, FTC native advertising guide (net-impression doctrine). " +
  "BTS curriculum is the primary authority where public literature is thin (jump-page specifics, UGC-advertorial role framing); external sources corroborate, they don't override. " +
  "All examples are fictional toy domains — no real BTS funnels, offers, coaches, or members. Deliberate scope rulings: concept-only, no testing doctrine, no winner archetypes, compliance = seven universal bans only, no text/pricing in images, no white backgrounds, UGC-style is the default.";

// ── Documents ────────────────────────────────────────────────────────────────

interface ImageSeedDoc {
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

const DOC_1_CONTENT = `Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page

This is the anchor document for image selection in the BTS system. It defines the vocabulary every other image doc uses: the three image surfaces and the single job each image has. Before giving or taking any image advice, first establish which surface the image lives on — the right advice for a native ad thumbnail is often the wrong advice for a jump-page image.

The three surfaces

BTS campaigns put images to work on three surfaces, matching the two funnel routes (native ad → advertorial → sales page, or native ad → jump page → VSL):

1. The native ad thumbnail — wins QUALIFIED attention.
The reader is at their coldest: scrolling an editorial feed in discovery mode, not shopping. The thumbnail's job is to stop the scroll for the RIGHT person and open a visual question the next page will answer. It is not a maximum-clicks device: an image that wins cheap, wrong clicks poisons everything downstream — the network's quality systems read poor post-click engagement and throttle or reprice the campaign. The thumbnail must read as content, not as an ad: one clear subject, candid and unpolished, no text, no pricing, nothing that looks designed. Success is a click from someone the advertorial can actually convert.

2. The advertorial image — confirms the scent.
The reader just clicked an editorial-style ad and landed on what looks and feels like an article. The advertorial's imagery must make that click feel correct within a second: same subject matter, same tone, same implicit promise as the thumbnail that earned the click. This is congruence — the "scent" the reader is following. A jarring visual shift (new subject, new mood, suddenly polished product photography) breaks the scent and shows up in the numbers as a decent ad CTR followed by poor read-through. Advertorial imagery stays in the editorial register: photos that could plausibly illustrate a real article, advancing the story the copy is telling.

3. The jump-page image — builds credibility and momentum.
On the short page whose only job is to get the video playing, the image supports the promise the headline is making and gives the page just enough visual credibility to feel legitimate. It cannot borrow trust from an article format, so the image works with the headline as one unit: subject matter that makes the transformation concrete and believable. This is the one surface where slightly cleaner imagery can serve — trust elements can look composed — but it never becomes studio-branded advertising polish.

The one universal law: congruence through the chain

Whatever the surfaces, the same visual idea must run through all of them. The thumbnail opens a visual question; the advertorial's imagery continues that exact subject and mood; the destination pays it off. Congruence of idea, not identical images — each surface re-expresses the angle for its own job. When members ask "is this a good image?", the first question back is always: for which surface, and does it carry the same angle as the pages around it?

Why the jobs differ: reader warmth

The reader gets warmer at every step. A cold feed-scroller has no context and no patience — the thumbnail must communicate in a glance. A reader who clicked has demonstrated interest — the advertorial image can carry more story. A reader who read the advertorial has invested attention — the jump-page image can support a direct promise. Matching the image's assertiveness to reader warmth is the deeper principle behind all the per-surface rules.

How to use this doc

When a member asks an image question, first identify (or ask) which surface they mean, then advise per that surface's job. The companion docs go deeper: Faces & Gaze Direction in Ad Images; Visual Curiosity & the Concealment Rule; Color for Ad Images — Evidence vs. Folklore; Thumbnail Composition — One Subject, Instant Legibility; The UGC-Style Default — Why Authentic Beats Produced; and Image Compliance — The Absolute Bans. For how images pair with headlines and angles across the whole funnel, see Creative Strategy — Ads, Images & Landing Pages That Work Together.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_2_CONTENT = `Faces & Gaze Direction in Ad Images

Faces are the strongest attention device available in ad imagery — and the most commonly wasted one. The human visual system locks onto faces before conscious thought. In a native feed full of editorial photos, a clear human face reliably captures the first glance. But capturing attention is only half the job: a face that grabs the eye and does nothing with it is attention-stealing decoration. This doc covers how to make a face earn its place.

Why faces work

Face detection is pre-attentive — it happens before the reader decides to pay attention. Replicated eye-tracking research across print, banner, and feed formats shows faces pull the first fixation. That makes a face the most reliable scroll-stopper in the toolkit, and it costs nothing: a candid photo of a person is exactly the kind of image an editorial feed expects to contain.

The gaze rule: a face must do a job

What the face's eyes are doing decides what the face accomplishes:

- Direct gaze (looking at the camera/reader) creates connection. The reader feels addressed. Use it when the image's job is relatability and trust — "this is a person like me, and this is about people like me." Direct gaze suits testimonial-flavored moments and relatable-problem framing.
- Aimed gaze (looking at something in the frame) transfers attention. The reader's eye follows the gaze to whatever the face is looking at — replicated repeatedly in eye-tracking work, where a face gazing toward an object pulls fixations to that object and measurably lifts interest in it. Use it when there is a subject the reader should end on: the person looking at the thing the story is about. Aimed gaze is also the device that can make a two-element composition work: a gaze leading from one part of the frame to the other gives the eye a reading order instead of two competing subjects (see Thumbnail Composition — One Subject, Instant Legibility on when a side-by-side is worth attempting).
- Jobless gaze (looking off-frame at nothing, or a face pasted in with no relationship to anything) captures attention and wastes it. The reader's eye lands on the face, finds no direction, and moves on. This is the most common face mistake: adding "a person" because faces work, without deciding what the face is doing there.

Expression must match the promise

The face's emotion is a claim. A worried expression promises a problem story; a relieved expression promises a resolution story; an amazed expression promises a discovery story. The expression must match the angle the headline is carrying — an amazed face over a calm, practical headline reads as fake, and readers discount the whole unit. One caution from the research: do not assume every audience reads an expression identically — exaggerated, theatrical expressions are the ones most likely to misread. Natural, recognizable emotion in context beats acted intensity.

Craft rules at feed size

- Shoulders up. At the size a thumbnail renders in a feed, a full-body shot makes the face a smudge. Crop tight: head and shoulders, or closer. The expression must be legible at a glance on a phone.
- One face. Two or more faces split the first fixation and dilute the emotional read. Group shots are for brand advertising, not for this system.
- Real over posed. A candid, imperfect face in a real setting belongs in the feed; a stock-styled model grin reads as an ad and gets scrolled past (see The UGC-Style Default — Why Authentic Beats Produced).
- Never a real, identifiable person you don't have rights to — and never a celebrity or public figure, period (see Image Compliance — The Absolute Bans). AI-generated faces are acceptable; check them for artifacts before use.
- Hands count. When a face isn't the right device, hands doing something carry much of the same human-first power — see the section below.

When hands are the subject: the human-first image without a face

A face is not the only way to put a person in the frame. Hands doing something — gripping, opening, applying, mid-task — are the second-strongest human signal in imagery, and one we teach constantly. An object alone on a table is a product shot: static, anonymous, and ad-like. The same object in a hand is a moment: someone is using this, right now, and the reader's eye completes the story of what's happening. The hand converts an object into an action.

Hands earn their place for three reasons:

- They demonstrate instead of displaying. A hand mid-action answers the reader's silent question — "what is this and what do you do with it?" — in a single glance, before any words are read.
- They read as UGC by default. A hand-held shot implies a phone in the other hand: it looks like a photo a real person took of their own life, which is exactly the register the feed expects (see The UGC-Style Default — Why Authentic Beats Produced). Object-on-white-table implies a studio; hand-in-real-setting implies a person.
- First-person point of view puts the reader in the scene. Shot from the owner's perspective — your own hands, doing the thing — the image stops being about someone else and becomes a preview of the reader's own experience. First-person POV is the most immersive framing available without a face, and it sidesteps every casting question: no expression to match, no face to relate to, no likeness concerns.

Craft rules for hand-led images follow the same feed-size logic as faces: crop tight enough that the action is unmistakable at phone size; one hand-action, not several; real skin, real setting, natural light — a manicured hand on a seamless background is a stock photo wearing a disguise. And the action must be the story's action: a hand doing something unrelated to the angle is the manual equivalent of a jobless gaze.

Choose the device by the job: a face when the story is about the person and their feeling; hands when the story is about the doing — the mechanism, the ritual, the moment of use. When members ask "do I need a person in the shot?", the answer is usually yes — but a person can be a pair of hands.

Which surface, which face

On the native ad thumbnail, the face is a scroll-stopper and a qualifier: the person should look like the reader (or the reader's situation), and the gaze should serve the visual question the thumbnail opens (see Visual Curiosity & the Concealment Rule). On the advertorial, faces carry the story — the same person or same kind of person continuing the narrative the click started. On the jump page, a face is optional; when used, direct gaze plus a credible, composed expression supports the promise (see Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page). Hand-led, first-person shots work on all three surfaces — they are especially strong on thumbnails for mechanism-led angles, where the doing is the story.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_3_CONTENT = `Visual Curiosity & the Concealment Rule

Curiosity is usually taught as a headline device, but the image itself can open a curiosity gap — and controlled experiments show it works. This doc covers how visual curiosity operates, the one rule that keeps it working (the concealment rule), and the boundary that separates productive curiosity from account-killing bait.

The image can ask a question

A curiosity gap is the pull a person feels between what they can see and what they can't. In imagery, the gap is created by showing enough to establish that something interesting is present, while withholding the part that would resolve it: the object partially out of frame, the reaction shown but not its cause, the hands mid-action on something not fully visible, the moment just before or just after the interesting thing. The reader's mind reaches for the missing piece — and the click is how they reach.

The concealment rule: conceal only what the mind completes positively

The experimental finding that anchors this doc: partially concealing the key object raises engagement and preference ONLY when the viewer's inference about the hidden part is positive. If what's implied reads as appealing — a solution, a satisfying result, something the reader already suspects they'd like — concealment amplifies the pull. If the hidden part reads as confusing, alarming, or like nothing at all, concealment backfires: the reader feels lost, not curious, and scrolls on. Ambiguity is not curiosity. A confusing image is just a confusing image.

Practical test: describe what a cold reader would GUESS is behind the concealment. If the guess is specific and attractive, the concealment is working. If the guess is "I have no idea," start over.

Bounded curiosity: the image writes a check the advertorial must cash

The visual question the thumbnail opens must be a question the advertorial actually answers. This is the boundary between curiosity and bait:

- Bounded curiosity: the image poses exactly the question the funnel resolves. The reader clicks, lands on the advertorial, sees the same subject continued, and gets the answer as the story unfolds. Scent intact; the click converts (see Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page).
- Bait: the image teases something the funnel never delivers — a shocking implied reveal, a subject that has nothing to do with the offer, drama borrowed from nowhere. Bait produces clicks and nothing else. The network's quality systems read the bounce, and the campaign pays for it in throttled delivery and rising costs. Misleading and irrelevant images are also outright banned by every native network (see Image Compliance — The Absolute Bans) — bait is a policy violation before it is a strategy mistake.

Curiosity that qualifies

The best visual curiosity does double duty: it pulls the right reader in and lets the wrong reader scroll past. A curiosity image built from the target reader's situation — their kind of kitchen, their kind of ache, their kind of clutter — reads as "what is this about?" to the person it's for, and as background noise to everyone else. That self-selection is worth more than raw click volume: it fills the funnel with readers the advertorial can actually move.

Craft notes

- Concealment devices that work at feed size: partial framing (object cropped at the edge), occlusion (hands or objects covering the key part), reaction-first (face responding to something off-frame), mid-process (the moment before the result).
- The concealed element should be THE subject, singular. Concealing detail inside a busy image conceals nothing — the reader never noticed the detail (see Thumbnail Composition — One Subject, Instant Legibility).
- The image and headline open ONE question together, not two different ones. An image asking one thing while the headline asks another halves the pull of both.
- Faces are natural curiosity partners: an expressive reaction to something not fully shown is the classic feed-native curiosity image (see Faces & Gaze Direction in Ad Images).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_4_CONTENT = `Color for Ad Images — Evidence vs. Folklore

Color advice in marketing is dominated by folklore — universal hue-emotion charts, "red converts," "blue builds trust." Most of it does not survive contact with the research. This doc separates what actually replicates from what to unlearn, and opens with the one BTS color rule that matters most in native feeds.

The headline rule: no white or light backgrounds

Native feeds are white. The editorial pages your ads sit inside are white or near-white, and the surrounding content mostly sits on white cards. An image with a white or washed-out light background dissolves into the page — it has no edges, no presence, and it vanishes at a glance. This is the single most common color mistake in member creatives, and it's disqualifying: whatever else an image has going for it, a white background erases it in the feed. Choose images whose background carries color, depth, or a real environment. (Clean white product-photography backgrounds are a brand-advertiser convention — exactly the "looks like an ad" signal this system avoids.)

What the evidence actually supports

- Saturation reads as potency. Replicated across many experiments: more saturated color makes the pictured thing feel more effective, more potent, bigger, stronger — and the effect extends to the image's background, not just the product. For most direct-response contexts (energy, results, action), moderate-to-strong saturation helps. The documented boundary: when the offer's appeal is gentleness or calm (sensitive skin, sleep, soothing), high saturation works against the promise — match saturation to the emotional register of the angle.
- Contrast against the feed beats any particular hue. What makes an image pop is not "the right color" — it's difference from the surroundings. In a white-page world, that means rich, warm, saturated imagery with real shadows and depth. Large-scale thumbnail research keeps landing on the same conclusion: salience is relative, not absolute. There is no magic hue; there is standing out from the context.
- One dominant color. Images that read instantly at feed size tend to have a single dominant color note with the subject in contrast against it — not a rainbow of competing zones. This is a legibility principle as much as a color one (see Thumbnail Composition — One Subject, Instant Legibility).
- Color-angle congruence. Color carries learned associations from context, and those associations should agree with the angle: an earthy, natural palette for a natural-remedy angle; clinical cool tones for a precision/science angle; warm domestic tones for a comfort angle. The palette is part of the message — when it contradicts the angle, the image feels subtly wrong even if the reader can't say why.

Folklore to unlearn

- "Red means urgency, blue means trust" — universal hue-emotion mappings fail under testing. The same hue produces different responses in different contexts; associations are learned and situational, not hard-wired. Any chart that assigns fixed meanings to colors is decoration, not evidence.
- "Red converts" / any magic-color claim — what tested wins in those stories is almost always saturation and contrast against the surroundings, not the hue itself. A saturated orange or teal in a white feed does the same work.
- "Colors drive some huge percentage of buying decisions" — a misquoted statistic that traces back to a paper about first visual impressions generally, not a color-to-sales correlation. Retire it.

Craft notes

- Warm, natural, slightly saturated real-world photography is the default that fits both the color evidence and the UGC register (see The UGC-Style Default — Why Authentic Beats Produced). Push saturation in an edit only until it still looks like a photo — an over-cooked HDR look reads as an ad.
- Avoid black-and-white and heavily desaturated looks in thumbnails: they read as "old news photo" and lose the contrast war against colorful editorial content around them.
- Check every candidate image at phone size against a white background. If its edges blur into the page, it fails regardless of its other virtues.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_5_CONTENT = `Thumbnail Composition — One Subject, Instant Legibility

A native ad thumbnail renders small — a few hundred pixels wide on a phone, glanced at for a fraction of a second mid-scroll. Composition for that reality is its own discipline: everything in this doc follows from designing for the glance, not the stare.

One clear focal subject — never a collage

The single most enforced composition rule in the system: a thumbnail has ONE subject. One person, one object, one moment. Multi-panel collages and busy scenes with several competing elements die at feed size, where the eye gets one fixation before the scroll decides. If a reader can't say what the image is OF in half a second on a phone, the image fails.

The side-by-side: possible, but demanding

A side-by-side is not banned — it is a composition that has to earn its keep twice. It is effectively two thumbnails sharing one frame: each half gets half the pixels, and the reader's eye still gets only one first fixation. If you want to test one, hold it to a higher bar:
- Each half needs its own single, instantly legible focal subject — a busy half kills the whole frame.
- The two halves must express ONE idea or one clean contrast, not two separate ideas. A reader should get the point of the pairing in the same half-second glance.
- Give the eye a reading order. A directional cue that leads from one half to the other — a gaze, a lean, implied motion — turns two competing subjects into one guided read (see Faces & Gaze Direction in Ad Images on aimed gaze as an attention-transfer device).
- Verify at phone size, as one unit. If either half muddies at feed scale, drop to a single subject.
One caution beyond composition: a side-by-side that contrasts two states can read as a before/after result, and for certain offers it may face higher compliance restrictions on our traffic source. The closer the contrast gets to a bodily, health, or financial transformation, the more caution it needs (see Image Compliance — The Absolute Bans).

The complexity sweet spot

Research on visual complexity keeps finding an inverted-U: images with too little going on are ignorable, images with too much are aversive, and attention peaks in the middle — a clear subject with enough real-world texture to be interesting. In practice at thumbnail scale, the risk is almost entirely on the too-busy side. A candid photo of one person doing one thing in a real environment sits naturally in the sweet spot: the environment provides texture, the single subject provides focus.

No text in the image. Ever.

BTS creatives never put text in the ad image — no captions, no labels, no arrows-with-words, no pricing. Three independent reasons, each sufficient:
- It breaks the camouflage. Editorial feed photos don't have marketing text on them. Text-on-image is the fastest "this is an ad" signal there is.
- It's illegible and unstable. At feed size text becomes noise, and networks crop images dynamically across placements — whatever text survives shrinking gets amputated by cropping.
- It's a policy exposure. Text overlays draw reviewer scrutiny, and text that makes any claim turns the image into an unreviewed ad copy surface.
The headline is the words; the image is the picture. Each does its own job (the same division of labor as no pricing in images — price talk belongs to pages, never creative).

Picture and headline are one unit

The reader processes the thumbnail image and headline together, as a single object. Replicated findings on picture-word consistency: when the image and the words point at the same idea, the unit is processed fluently and remembered; when they point at different ideas, both weaken. Compose the pair: the image raises the visual side of exactly the question the headline raises verbally (see Visual Curiosity & the Concealment Rule). An image chosen because it "looks good" but carries a different idea than the headline is a mismatch, not a creative choice.

Crop and framing basics

- Crop tight. Fill the frame with the subject — shoulders-up for faces, close enough that the subject is unmistakable at phone size. Dead space is wasted pixels at this scale. No letterboxing, no borders.
- Keep the subject's key detail away from the edges. Networks auto-crop to different aspect ratios per placement; anything critical near an edge will be amputated somewhere. Compose so the subject survives a crop from any side.
- Slightly off-center placement reads naturally and photographically — dead-center compositions read as staged product shots. But off-center never means near-the-edge.
- Legibility check: shrink the candidate image to roughly the size it will render in a feed on a phone and glance at it. If the subject and its emotional read don't land instantly, the composition fails — no amount of full-size beauty rescues it.

Composition serves the register

All of these rules operate inside the UGC-style register: the goal is a photo that looks found, not designed (see The UGC-Style Default — Why Authentic Beats Produced). A perfectly composed, professionally lit single-subject shot can still fail by looking like an ad. Tight, legible, and candid — all three together (see Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page for how composition expectations shift on the advertorial and jump page).

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_6_CONTENT = `The UGC-Style Default — Why Authentic Beats Produced

In the BTS system, UGC-style imagery — candid, phone-camera-real, unpolished — is not one option among several. It is the default doctrine for ad and advertorial imagery. This doc explains why the evidence supports it for our funnels specifically, and how to execute it well.

Why authentic wins in this system

- Editorial-context match. Native ads live inside editorial feeds, surrounded by news photos and lifestyle content shot by photojournalists and ordinary people. A candid image belongs there; a studio-lit product shot is a foreign object. The whole native mechanism is camouflage — the image either maintains it or breaks it.
- Ad-pattern avoidance. Readers have spent years learning what ads look like: perfect lighting, styled models, clean backgrounds, graphic polish. That pattern recognition fires pre-consciously and produces the scroll-past before the reader ever evaluates the content. Unpolished imagery doesn't trip the filter.
- The authenticity evidence. Meta-analytic research finds user-generated-style content generally outperforms firm-produced content on engagement and trust outcomes, and large-scale creative research keeps finding that what wins is imagery perceived as authentically human. Authenticity here is not an aesthetic preference — it is a measured trust signal.
- Our funnels are stories about people, not brands. A BTS advertorial is a first-person discovery narrative. Its imagery must look like it was captured from the life the story describes. Brand advertisers polish because they're building an asset called a brand; we have no brand to build and no reason to pay polish's costs.

What UGC-style means in practice

- Phone-camera feel: natural light, real color, believable grain. Not broken — a blurry, badly exposed mess is just a bad photo — but visibly unstaged.
- Real settings: an actual kitchen with things on the counter, a real car interior, a lived-in living room. Environmental mess in moderation is credibility.
- Real-looking people: ordinary faces, ordinary clothes, natural expressions caught mid-moment (see Faces & Gaze Direction in Ad Images). Nobody model-gorgeous, nobody posing.
- Imperfect composition that still obeys the rules: candid framing, but one clear subject, tight enough to read at feed size (see Thumbnail Composition — One Subject, Instant Legibility). UGC-style is a register, not an excuse for illegibility.
- AI-generated imagery is fine — prompted to this register: candid, documentary, phone-shot, natural light, no studio look. Check outputs for artifacts and anatomy errors before use, and never generate a real person's likeness (see Image Compliance — The Absolute Bans).

The cardinal sin: obvious stock photography

The instantly recognizable stock photo — the beaming model at a too-clean desk, the watermark-adjacent handshake, the perfectly diverse group laughing at salad — is the worst image choice available. It simultaneously breaks camouflage (reads as ad), torches authenticity (reads as fake), and signals low effort (reads as spam). Readers have seen these exact images elsewhere, sometimes literally. If an image could plausibly appear in a bank's brochure, it does not belong in a BTS funnel.

The narrow exception: late-funnel trust elements

On the jump page — after the reader has clicked and read — small trust-supporting elements can be cleaner and more composed: a tidy product-in-context shot, a credible composed portrait. The reader is warmer and the page's job is credibility, so a touch of order serves (see Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page). This is a narrow allowance for composure, not a doorway to studio polish: even jump-page imagery never becomes branded advertising design.

The mental test

Before using any image, ask: "Could this photo plausibly have been taken by the person the story is about?" If yes, it fits the register. If it could only have been produced by a marketing department, it fails — however beautiful it is.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

const DOC_7_CONTENT = `Image Compliance — The Absolute Bans

This is a blunt reference doc: the image content that is banned in this system, period. These are not per-network technicalities to optimize around — every major native network prohibits all of them, and the bans are taught here as universal. One non-compliant image can get an ad rejected, a campaign paused, or an account flagged, and account standing is the scarcest resource a media buyer has.

First, the frame: an image can make a claim by itself

Regulators and networks judge an ad by its NET IMPRESSION — the overall message a reasonable person takes away, from every element together. An image is fully capable of making a claim on its own: a photo implying dramatic weight loss IS a weight-loss claim; a photo implying a disease was cured IS a medical claim. "The text never said it" is no defense — if the image says it, the ad said it. Every ban below follows from that principle plus the networks' written policies.

Where these bans apply hardest: your AD images. The bans below are enforced most aggressively on the ad creative itself — the thumbnail the network reviews and serves. Certain elements may face less scrutiny on your landing pages, but that is a difference in enforcement pressure, not permission: the same net-impression principle applies to the whole funnel, so use caution on your pages too.

The seven absolute bans

1. Before/after transformation images. Transformation photos (weight loss, skin, hair, teeth, finances) that show the change itself are explicitly banned by the networks — including in health and beauty, where members most want them. This includes implied before/after: "transformation" collages and dramatic same-person body contrasts. The ban is about CONTENT, not layout: what triggers it is imagery that presents a bodily or financial result as caused by the product. When in doubt, show ONE state — the desirable end state, or the relatable problem state — and let the headline carry the change over time. (For composition guidance on multi-element layouts generally, see Thumbnail Composition — One Subject, Instant Legibility.)

2. Sexualized imagery and body-part emphasis. No sexualized framing, no zoomed or cropped emphasis on intimate or isolated body parts (midriffs, chests, close-cropped skin), no imagery that highlights physical features in a way designed to make readers self-conscious. Health and fitness angles are the usual trap — a "belly fat" zoom is a ban on two counts (body-part emphasis + implied claim). Instead: whole people, in context, doing things.

3. Celebrities and public figures without documented permission. No celebrities, politicians, doctors, scientists, or any recognizable public figure in ad imagery unless you hold documented permission — which, practically, members never do. Implied endorsement by a recognizable face is one of the fastest routes to account bans. This includes AI-generated likenesses of real people, which are equally banned and increasingly illegal. Instead: unknown faces, licensed models, or AI-generated people who resemble no one.

4. Fake UI elements. No fake play buttons, fake close/X buttons, fake system dialogs, fake notification badges, or any graphic that pretends to be functional. An image must not appear to have functionality it doesn't have. This is treated as deliberate deception by every network. Instead: if motion or interactivity is the appeal, imply it photographically (a paused-moment feel), never graphically.

5. Shock, gore, and disturbing imagery. No blood, wounds, rashes, skin conditions, medical procedures, dead bodies, bodily fluids, disturbing physical conditions, or gross-out content — even when the offer is health-related and "the condition is real." Shock stops the scroll and kills the account. Instead: represent problems through the person's experience (expression, posture, situation), not through graphic depiction.

6. Misleading or irrelevant images. The image must be an accurate representation of what the funnel is about. No borrowed drama, no unrelated eye-candy, no images whose only connection to the offer is that they get clicks, no misleading crops or zooms that make something appear to be what it isn't. Networks enforce this directly, and the funnel enforces it again: wrong-promise clicks don't convert (see Visual Curiosity & the Concealment Rule on the bait boundary).

7. Implied disease and medical claims via imagery. No imagery that implies a product treats, cures, or reverses a disease or medical condition: no syringes-and-cure visuals, no disease-name props, no clinical imagery implying medical intervention, no imagery implying a supplement replaces medication. Symptom-level, experience-level framing is the ceiling — and even that stays inside ban #5's limits on depiction.

How to use this doc

Screen every candidate image against all seven bans BEFORE falling in love with it, and remember net impression: the question is never "does the image technically avoid the banned thing" but "what claim does this image make to a reasonable person at a glance." When an image is arguably near a line, it is over the line — the supply of compliant images is unlimited, and account standing is not. Compliance Review exists to catch what slips through; the goal is that nothing does.

This covers the fundamentals. For strategy specific to your product, your numbers, and where your campaign is right now, the next step is a live group Q&A coaching call or a 1-on-1 private coaching session — bring your campaign and a coach will work through it with you.`;

// Item 8 — full revised text of the live "Creative Strategy" doc (reconciliation
// pass: §4 rewritten to align with the new image-doc set + pointers added;
// everything else preserved with only folklore/brand-flavored lines corrected).
const DOC_8_CONTENT = `Creative Strategy — Ads, Images & Landing Pages That Work Together

Summary
Creative Strategy at Build Test Scale is the angle‑first, funnel‑wide plan for how your ads and landing pages work together to win attention, earn qualified clicks, and move people to the offer page. You don't sell in the ad — you earn the next click. Start from the offer, extract compelling angles, express each angle through headlines and images, keep the ad and landing page tightly congruent, and test systematically. Don't chase a perfect ad; build an engine that repeatedly finds and refines winners.



Deep dive

1) What Creative Strategy is (and what you control)
- Goal: profitably arbitrage attention by delivering qualified, low‑cost clicks to a vendor's sales page that closes the sale.
- Your controllables in affiliate flows: the ad and the landing page (advertorial/bridge). The offer/product page is fixed.
- Roles split:
 - Ad: interruption unit that stops the scroll and sells the click (hook, emotion, curiosity).
 - Keep the curiosity loop open; treat the ad as the start of a story for a specific persona.
 - Avoid going price‑first; it's often effective to omit the product name in the ad to preserve curiosity and let the page do the pre‑sell and qualification.
 - You have only seconds; assume scrollers aren't shopping. Lead with curiosity and problem/benefit framing rather than over‑revealing the product when the offer allows.
 - Landing page (advertorial/bridge): pre‑sells, builds intent, and earns the click to the offer; continues the same story.
 - Offer page/VSL: converts the purchase; you pre‑frame for it.
- Message match (congruence): in early rounds you'll test multiple distinct angles. As winners emerge, maintain that post‑click "scent" from ad → landing page → offer so the click feels like "I found exactly what I expected."
 - When natural, mirror distinctive phrases from your landing page in the ad to strengthen continuity. Build purpose‑fit ad and LP assets that match on idea and visual spirit — they don't have to be identical twins.
 - Maintain two creative sets that do different jobs while staying congruent: ad headlines/images versus LP headlines/hero shots.
- Biggest levers (optimize in this order): Angle (~70% of impact) > Headline (~15%) > Image (~10%) > Supporting copy (~5%). Layout/CTA polish are minor by comparison.
- Pre‑qualification and intent:
 - You can pre‑qualify with specificity (call out exact situations/emotions). This may reduce click volume or raise CPC but often lifts LP CTR and downstream buyer quality.
 - Price/intent reality: lower‑price offers can support more impulse‑style creative; higher‑ticket offers usually need stronger pre‑sell and expectation‑setting on the bridge page before the offer page reveals price/details.

2) Angle‑first: the foundation
- Definition: a distinct, coherent reason‑to‑care that ties image, headline, and copy into one hook (e.g., pain‑relief, "does the work for you," inventor/innovation, guilt‑relief, transformation, budget‑friendly).
- Where angles come from:
 - Work backward from the offer page/VSL: mine for pain, promise, mechanism, proof, objections, origin stories, and quotable lines; extract buyer personas (who buys and why).
 - Persona lenses: the same pain reframed for different situations (e.g., "dog owners away from home" vs "working from home").
 - Research "market‑in" language: read reviews/forums and the advertorial/VSL to mirror how the audience describes their problem.
 - Use AI to deconstruct the offer text and propose options; you cluster by angle and curate, generate broadly (e.g., 8–12 angles), then prune by fit and distinctness.
 - Competitive intel (inspiration, not copy): study styles, angles, and LP structures that appear to work on your traffic source/geo using Anstrex in Tools (/partner-tools). Differentiate from saturated tropes to stand out while staying relevant.
- Buckets before lines: define 2–4 clear angle buckets first, then write multiple headlines per bucket so you test fundamentally different ideas, not wording tweaks.
- Treat angles as testable hypotheses about audience mindset and persuasion path (who you're talking to and how you'll convince them).
- Be skeptical of sensational/conspiracy‑style themes unless the sales mechanism genuinely uses them; ground in believable pains, mechanisms, and proof.
- Ensure coverage across common persuasion modes: mechanism/tech discovery; authority/validation; proof/specificity; transformation/outcome; safety/simplicity/time‑to‑result; contrarian/"obsoletes old"; social proof.
- Optional workflows for angle discovery:
 - ChatGPT or Claude: upload your advertorial/VSL transcript and the vendor sales page to extract buyer insights and generate a Top‑10/Top‑12 angles list; pick ~5 to start testing on the landing page.
 - AffAngleArchitect: https://poe.com/AffAngleArchitect — use it to propose and cluster angles.
 - Affiliate CMO: Portal → Tools (/partner-tools) → Affiliate CMO — use it to generate and cluster angles for testing.
- Map the funnel story: decide how each angle shows up in the ad, is paid off on the landing page, and is handed to the VSL/offer so the narrative flows without friction.

3) Copy Blocks and headline strategy (expressing the angle)
- Copy Blocks framework (foundation): Promise (desired result), Pain (current struggle), Proof (credibility), Curiosity/Mechanism (the "how"), Constraint/Objection ("without X/Y/Z…").
 - Curiosity bridges pain to promise via a specific "how," not random mystery.
 - Constraints preempt skepticism; match proof to audience (authority, research, testimonial, social proof).
- Two headline jobs:
 - Ads: short(er), native/editorial tone, curiosity‑forward to earn the click. Front‑load the hook; the description acts as a sub‑headline. Longer is fine if it sharpens curiosity and clarity; be specific and credible.
 - Keep ad appeals broad enough to avoid prematurely filtering out qualified readers; push specifics on the landing page.
 - Avoid pure, vague curiosity — signal what it addresses and hint at how it works without over‑claiming. In some low‑ticket contexts it's acceptable to suggest a product exists, without going price‑first.
 - Don't bury the lead: platforms truncate — ensure your hook survives the cut‑off and appears in the visible headline on mobile.
 - Landing pages: longer, persuasion‑rich to hook into the story and set expectations for the offer/VSL. If the headline bloats, move overflow (constraints/proof) into a sub‑headline or first paragraph to preserve scannability.
 - Craft LP headlines for an editorial article open; don't reuse ad‑style one‑liners as LP headlines. Title Case helps headlines blend with publisher‑style pages; avoid emojis/symbols.
- Proven elements to weave in: curiosity, pain, promise/solution, specificity, simplicity, credibility, and when appropriate, a believable time‑frame.
- Practical craftsmanship and iteration:
 - Use headline frameworks and power‑word lists from Resource Library — Creative Drive (/resource-library) to strengthen winners once a baseline angle pulls ahead.
 - Title‑case headlines; avoid ALL CAPS. Dynamic geo insertion is optional and should read naturally.
 - When a headline concept clearly wins, create several fresh variants that keep the same underlying angle (bigger swings than tiny micro‑edits) and try to beat it.
 - Quality gate: evaluate each headline on craft and whether it cleanly carries one of your defined angles to a specific audience. AI can draft in volume; your judgment decides what ships.
 - Classification clarity: pain ≠ constraint (e.g., "can't sleep" is pain; "without meds or groggy mornings" is constraint).
 - Velocity matters: compress filler so core blocks land fast and read conversationally. A useful longer‑lead flow is PRO: person → problem → pain → results → offer.
 - Practical Round‑1 spec (drafting): produce 40–60 raw ad headlines, cluster by angle, refine to a diverse top‑10 for testing. Keep each ad headline concise (e.g., ≤90 characters) and share one universal description that supports the hook without completing the story. If your source supports it, consider dynamic macros (e.g., city, state, year/day) that localize/time‑stamp headlines/descriptions; keep tokens consistent across headline and description.

4) Visual strategy (signaling the angle)
The image-selection system now has its own foundation set — the Image Foundations docs. This section is the strategic summary; go deeper per topic: Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page (the anchor); Faces & Gaze Direction in Ad Images; Visual Curiosity & the Concealment Rule; Color for Ad Images — Evidence vs. Folklore; Thumbnail Composition — One Subject, Instant Legibility; The UGC-Style Default — Why Authentic Beats Produced; and Image Compliance — The Absolute Bans.
- Roles (stage-fit):
 - Ad image: wins the glance from the RIGHT reader and instantly cues "that's me/that's my problem." Qualified attention, not maximum clicks.
 - LP hero image: confirms "I'm in the right place for the solution" and advances the message — same subject, tone, and implicit promise as the ad image that earned the click.
- Principles:
 - One clear focal subject; never a collage. Strong contrast and phone‑scale legibility — shrink the image and glance‑test it. UGC‑style, candid, real‑setting imagery is the default register; obvious stock photography is the cardinal sin. Keep models/demographics aligned to the angle.
 - No white or light backgrounds: native feeds are white, and a white‑background image dissolves into the page. Favor saturated, warm, real‑environment imagery — contrast against the feed matters more than any particular hue (universal hue‑emotion charts are folklore).
 - Match the image to the headline's angle so the visual advances the message, not just decorates it — the reader processes image + headline as one unit.
 - You don't always need to show the product; a partial reveal or concealment can open visual curiosity — but only when what's implied reads as positive, and only when the advertorial actually answers the question the image asks. Teasing what the funnel never delivers is bait: it attracts unqualified clicks and triggers network quality penalties.
 - No text in ad images, ever — it breaks the editorial camouflage, dies at feed size under dynamic cropping, and invites policy scrutiny. No pricing in images. Avoid "breaking news" phrasing anywhere in the unit. Label the landing page "Advertorial" for editorial context and compliance.
 - Faces are the strongest attention device — shoulders‑up crops, one face, natural expression matched to the angle's emotion. Direct gaze creates connection; gaze aimed at a subject transfers attention to it; a face doing neither is wasted decoration. Unmistakable hands (holding, reacting) are the runner‑up device.
 - Start with static 16:9 images for ads; explore short motion (GIFs/short clips) only after message match is proven. For LP heroes, clean, photogenic compositions sized consistently (e.g., around 800×500) work well; avoid busy compositions with competing elements.
 - Compliance in ad images is strict: no before/after transformation images (the trigger is content — imagery presenting a bodily or financial result as caused by the product; show ONE state and let the headline carry the change), no sexualized or body‑part‑emphasis imagery, no celebrities or public figures, no fake UI elements (play buttons, close buttons), no shock/gore, no misleading or irrelevant images, no implied disease/medical claims via imagery. Side‑by‑side layouts are a composition challenge rather than a ban — each half needs its own legible focal subject and a directional cue ordering the read — though state‑contrast pairings may face higher compliance restrictions for certain offers (see Thumbnail Composition — One Subject, Instant Legibility). These rules bite hardest on the ad creative; some elements face less scrutiny on landing pages, but the same net‑impression principle applies there too. An image can make a claim by itself — "the text never said it" is no defense. See Image Compliance — The Absolute Bans for the full reference.
 - Compare opposite "states" early: problem vs end‑result — as separate single‑state images, never combined into one before/after frame. Also test single‑state images (e.g., only the "problem").
 - Early exploration: begin with 3–5 diverse concepts (not near‑duplicates). After a winning concept emerges, refine with tight crops, brightness/clarity/color edits.
 - Sourcing and safety: hunt for unique, emotionally resonant visuals; avoid generic/templated stock. If a spy‑tool image inspires you, reverse‑search to source look‑alikes you can recreate. Never use identifiable internet‑sourced faces — you have no rights to them; AI‑generated faces are fine to use (check for artifacts/anatomy errors, and never generate a real person's likeness).
 - Composition tips: tighter crops on faces/hands to heighten intrigue; keep critical detail away from edges (networks auto‑crop per placement); maintain strong contrast.
 - Ad vs LP visuals: don't default to reusing the same image — their jobs differ — but keep the psychological "scent" aligned. After a winning LP headline/hero emerges, consider mirroring the ad image to the LP hero to attempt a CTR bump.


5) Congruence and funnel architecture
- Build backward from the offer and the advertorial or VSL: pull forward promises, proof, and objections so the landing page naturally bridges to the vendor page.
- Immediate congruence: mirror the landing page's core hook/terms/visual spirit in the ads so the post‑click "scent" is unmistakable.
 - Keep ad hooks broad to widen entry; pay off specifics on the page to preserve expectation match.
- Funnel types you'll use:
 - Advertorial funnels (common with e‑comm/Media Mavens offers): the advertorial is the main pre‑sell. Keep body copy fixed on BTS‑provided pages; test the headline and hero image.
 - Bridge‑page funnels (common with ClickBank VSLs): ad → short bridge page (strong headline + image + brief framing paragraph) → VSL. The bridge sets expectations so the VSL can do the heavy selling.
- Link‑placement nuance (LP): for simple, low‑price impulse products, an early/top CTA can work because visitors immediately "get it." For higher‑price/complex offers, delay the first link until after meaningful pre‑selling — lower click volume can still yield better conversion. Always judge by conversion rate, not raw click counts; when in doubt, clone the page, vary only link placement, rotate traffic, and keep the conversion‑rate winner.
- Integrity and qualification: don't invent claims/details not present in the advertorial/VSL; off‑angle clickbait attracts unqualified clicks and depresses LP engagement. Aim for "attention + relevance."
- Judge pairs, not parts: read performance by the ad → LP combination. A decent ad CTR followed by weak LP clicks often signals an ad/LP message or image mismatch.
- First‑glance test: the LP hero + headline should continue the same psychological message set up by the ad — avoid jarring visual or tonal shifts. Do a "journey congruence audit" by laying each ad (image + headline) directly above its paired LP hero + headline and sanity‑check the hand‑off.

6) Testing methodology (angles → headlines → images → formats)
- Default sequence (canon):
 1) Prove the angle via headline tests while holding one strong image constant.
 2) Freeze the winning headline and test distinct image concepts to find the best pairing.
 3) Only after a still‑image + message pair wins, adapt to additional placements/aspect ratios and cautiously test motion.

7) Iteration patterns that compound
- Angle‑led loop: validate an angle via headlines → pair with multiple images/animations → carry that angle to LP headline/hero → iterate both sides.
- Good‑clicker loop: find a low‑CPC image → iterate headlines/supporting copy around it → keep congruence tight → refresh images to fight fatigue.
- Protect and polish a winner:
 - Once performance is proven over time and true CPA, designate a control.
 - Keep the concept constant; make precise visual micro‑edits (crop tighter, brighten, clarify subject) and A/B against the control for incremental gains.
 - When a still wins, you can later convert that still into a short, on‑concept motion variant and test it against the control.
- Stop rules and pivots:
 - After substantial spend without conversions, micro‑tweaks rarely rescue a misaligned angle; widen angle diversity or pivot offers.
 - Don't raise budgets on negative sub‑campaigns; improve creative first.
- Scale only after proof: once a path is profitable in aggregate and stable, expand placements and budgets; plan a steady creative cadence to combat fatigue. Expect some performance drop‑off at scale; refresh proactively.

8) Quick‑start checklist
- Define 2–4 distinct angle buckets from your offer/advertorial.
- Draft 5–10 headlines per angle; shortlist the top 1–2 per bucket. Ensure each ad headline can stand alone; the description only supports it.
- Build 3–5 diverse image concepts with one clear focal subject tied to each angle. Across LP heroes, cover a spread of concepts: hope/transformation, pain/frustration, credibility/authority, curiosity/mechanism, and ease/simplicity.
- Launch a clean test: fixed image with multiple headlines (default). If needed, fixed headline with multiple images.
- Measure CPC, LP Event CTR, and LP Event CPC together; decide keep/kill/iterate by the composite and downstream intent events.
- Carry the winning angle onto your LP headline/hero for tight congruence; keep other LP elements constant while testing. Prefer distinct, purpose‑built ad images vs LP heroes while keeping the same angle and tone.
- Refresh regularly; protect proven controls; expand to new placements/formats only after message + still image work.

9) Practical workflow and BTS toolchain
- Training and resources:
 - The Blitz (/blitz) for step‑by‑step build‑and‑test guidance.
 - 7 Pillars (/core-training/7-pillars) for foundations.
 - Resource Library — Creative Drive (/resource-library) for templates, Copy Blocks, angles/headline guides, power‑word lists, and the P&L Tracker.
- Apps (/apps):
 - Flexy: build/host advertorials and bridge pages (edit desktop and mobile separately; host media; test on a real phone).
 - MetricMover: assemble LP split‑tests (e.g., 5×5 matrices) and output embeddable variants with clear names.
 - DIYtrax: build/run ads, attach LP variants and offer links, rotate traffic, and analyze metrics by ad→LP combo. Central hub for campaign assembly/publishing.
 - PixelPress and Gifster: create banners/CTAs and short hero GIFs.
 - ScrapeBot and CropBot: source and resize images.
- Partner/third‑party tools (optional; see Tools at /partner-tools):
 - Creative/LP research to study angles and styles (inspiration only — don't copy).
 - General AI and editors (e.g., ChatGPT/Claude for angles/headlines; Canva for micro‑edits/motion comps; dedicated image generators) — choose what fits your workflow and budget.
- AI for creative development (angles, headlines, visuals):
 - Upload your advertorial and sales page/VSL transcript and explicitly state your funnel (paid ad → advertorial/bridge → product page).
 - Ask for angle options grouped into buckets using BTS frameworks; then generate headline sets per bucket following Copy Blocks.
 - For visuals, prompt 16:9, photorealistic/candid/documentary style; specify subject, mid‑action, clear expression, setting/time, composition/contrast, and "no text/logos/watermarks." Use negative prompts to exclude unwanted elements. Generate many, shortlist, refine, and check for artifacts/anatomy errors.
- Compliance and support:
 - Compliance Review (/compliance): submit ads and LPs before launch as required; one non‑compliant variant can cause downstream rejections.
 - If you receive rejections you believe are in error, engage the traffic source's support for a re‑review before rewriting compliant lines — don't preemptively overhaul everything.
 - Coaching Calls (/coaching) for live Q&A; Private Coaching (/coaching/book-session) for 1‑on‑1; BTS Concierge (/concierge) for done‑for‑you tasks; 1‑on‑1 VA Calls (/va-calls) for software help; Support (/support) for tickets/live chat.`;

// ── Seed manifest ────────────────────────────────────────────────────────────

export const IMAGE_SEED_DOCS: readonly ImageSeedDoc[] = [
  {
    slug: "image-jobs-by-funnel-stage",
    title:
      "Image Jobs by Funnel Stage — Native Ad Thumbnail, Advertorial, and Jump Page",
    docClassTarget: "overview",
    taxonomyTags: ["creative", "funnel"],
    content: DOC_1_CONTENT,
    adminNotes:
      "Anchor/vocabulary doc for the Image Foundations set (stage-fit framework: qualified attention → scent/congruence → credibility). " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "faces-and-gaze-direction",
    title: "Faces & Gaze Direction in Ad Images",
    docClassTarget: "curated",
    taxonomyTags: ["creative"],
    content: DOC_2_CONTENT,
    adminNotes:
      "Faces capture attention pre-attentively; gaze direction decides the job (direct = connection, aimed = attention transfer, jobless = wasted). " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "visual-curiosity-concealment",
    title: "Visual Curiosity & the Concealment Rule",
    docClassTarget: "curated",
    taxonomyTags: ["creative", "hook"],
    content: DOC_3_CONTENT,
    adminNotes:
      "Image-borne curiosity gap: concealment works only on positive inference; bounded curiosity vs bait boundary. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "color-evidence-vs-folklore",
    title: "Color for Ad Images — Evidence vs. Folklore",
    docClassTarget: "curated",
    taxonomyTags: ["creative"],
    content: DOC_4_CONTENT,
    adminNotes:
      "Headline rule: no white/light backgrounds. Real effects: saturation→potency, contrast-vs-feed, color-angle congruence. Folklore busted: universal hue-emotion maps. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "thumbnail-composition",
    title: "Thumbnail Composition — One Subject, Instant Legibility",
    docClassTarget: "curated",
    taxonomyTags: ["creative", "native-ad"],
    content: DOC_5_CONTENT,
    adminNotes:
      "One focal subject default, complexity sweet spot, flat no-text-in-image rule, picture-word unity, crop/edge-safety basics. Per user ruling: side-by-sides are taught as a demanding-but-allowed composition (per-half legibility, one idea, directional cue ordering the read, phone-size check), with a compliance caution for state-contrast pairings on certain offers — not a ban. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "ugc-style-default",
    title: "The UGC-Style Default — Why Authentic Beats Produced",
    docClassTarget: "curated",
    taxonomyTags: ["creative", "native-ad"],
    content: DOC_6_CONTENT,
    adminNotes:
      "Doctrine doc: UGC-style is the BTS default register (editorial-context match, ad-pattern avoidance, authenticity evidence); narrow late-funnel composure exception; obvious stock = cardinal sin. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "image-compliance-absolute-bans",
    title: "Image Compliance — The Absolute Bans",
    docClassTarget: "curated",
    taxonomyTags: ["compliance", "creative"],
    content: DOC_7_CONTENT,
    adminNotes:
      "The seven cross-network absolute bans (before/after transformation; sexualized/body-part; celebrities; fake UI; shock/gore; misleading/irrelevant; implied disease claims) under FTC net-impression framing, with an explicit ad-image-first enforcement note (landing pages get less scrutiny for some elements, caution still applies). Deliberate deviations from research report §5 per user ruling: side-by-side is a layout, not a ban — removed from this doc entirely; ban #1 is content-triggered (imagery presenting a bodily/financial result as product-caused). Side-by-side composition + compliance caution lives in Thumbnail Composition. The rights caution paragraph was also removed per user ruling. Do not otherwise broaden or narrow the categories. " +
      SOURCE_SET_NOTE,
  },
  {
    slug: "creative-strategy-revision",
    title: IMAGE_LIVE_DOC_TITLE,
    docClassTarget: "curated",
    taxonomyTags: ["creative", "angle", "landing-page"],
    content: DOC_8_CONTENT,
    isRevision: true,
    updateSummary:
      "Light reconciliation with the new Image Foundations doc set — not a rewrite. §4 (Visual strategy) updated: pointers added into the seven new image docs; stage-fit roles sharpened (qualified attention / scent confirmation); no-white-background rule added; 'one color pops' folklore replaced with contrast-vs-feed + color-angle congruence; concealment/bait boundary added; transformation-visual advice aligned with the before/after transformation ban (single-state imagery preferred; side-by-side layouts cautioned, not banned); face guidance expanded with gaze direction (no identifiable internet-sourced faces — rights, not just risk); explicit compliance summary added with ad-image-first enforcement framing. All other sections preserved verbatim except straight-quote normalization.",
    adminNotes:
      "REVISION PROPOSAL for the live doc 'Creative Strategy — Ads, Images & Landing Pages That Work Together' (staged with updateKind='update' + targetLiveDocId; the live row is untouched until approval). See updateSummary for the change scope. " +
      SOURCE_SET_NOTE,
  },
] as const;

// ── Seeder ───────────────────────────────────────────────────────────────────

/**
 * Seeds the 8 Image Foundations drafts into the AI Document Review queue.
 * Insert-only: rows already present for (source, sourceVideoTitle) are skipped
 * entirely so reviewer edits/decisions are never clobbered. Returns a summary
 * for boot logging.
 */
export async function seedImageFoundationsStaging(): Promise<{
  inserted: number;
  skipped: number;
}> {
  // Serialize concurrent boots (same rationale as the headline seed): a
  // transaction-scoped advisory lock on a pinned connection prevents two API
  // processes passing check-then-insert simultaneously and double-seeding.
  const SEED_LOCK_KEY = 0x696d6673; // "imfs"
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    return seedImageFoundationsLocked(tx);
  });
}

type SeedExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedImageFoundationsLocked(tx: SeedExecutor): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;

  // Resolve the item-8 revision target ONCE, by exact live-doc title.
  const [liveTarget] = await tx
    .select({ id: aiLiveDocumentsTable.id })
    .from(aiLiveDocumentsTable)
    .where(eq(aiLiveDocumentsTable.title, IMAGE_LIVE_DOC_TITLE))
    .limit(1);

  for (const doc of IMAGE_SEED_DOCS) {
    const [existing] = await tx
      .select({ id: kbStagingDocsTable.id })
      .from(kbStagingDocsTable)
      .where(
        and(
          eq(kbStagingDocsTable.source, IMAGE_FOUNDATIONS_SEED_SOURCE),
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
        `[seedImageFoundationsStaging] SKIPPING revision draft "${doc.slug}": live doc "${IMAGE_LIVE_DOC_TITLE}" not found in ai_live_documents — cannot resolve targetLiveDocId.`,
      );
      continue;
    }

    await tx.insert(kbStagingDocsTable).values({
      title: scrubAll(doc.title),
      category: "curriculum",
      content: scrubAll(doc.content),
      tags: doc.taxonomyTags.join(", "),
      source: IMAGE_FOUNDATIONS_SEED_SOURCE,
      sourceVideoTitle: doc.slug,
      // status defaults to 'pending_review' — human review gate absolute.
      homeRoot: "concepts",
      node: "creative-strategy",
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
    `[seedImageFoundationsStaging] done: ${inserted} inserted, ${skipped} already present (of ${IMAGE_SEED_DOCS.length}).`,
  );
  return { inserted, skipped };
}
