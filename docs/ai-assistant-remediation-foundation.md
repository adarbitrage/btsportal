# BTS AI Assistant Remediation — Foundation & Architecture

> **Status:** Canonical design reference for the BTS Portal AI Chat + AI Voice assistant remediation.
> This document is the single source of truth for the *reasoning* behind the work. Individual
> tasks implement slices of it and link back here. Task 1 commits this document into the repo
> (`docs/`) so the reasoning becomes permanent in `main`.
>
> **Preservation note:** This file captures decisions WITH their rationale and rejected
> alternatives on purpose — not as a summary. Do not condense it into an overview; the nuance
> is the point.

---

## 1. The problem

**Symptom:** The AI assistants (chat + voice) cite raw call transcripts as authoritative,
member-facing truth. Concrete failure: the "Robin" leak — coach surnames / PII and
off-hand call remarks surfaced to members as if they were official answers.

**Root cause hierarchy (most → least fundamental):**
1. **Content / KB structure** — transcripts are ~98% of the corpus and were seeded directly
   into the live KB as *citable member documents*. The corpus itself is the problem.
2. **Retrieval** — ranks/returns those transcript docs as answers.
3. **Rules / prompts** — try (and fail) to paper over the above.

Fixing retrieval or rules without fixing the content structure is treating symptoms. The
remediation is **content-structure first**.

---

## 2. The core reframe

- **Transcripts = a training / mining SOURCE, not citable truth.** They are kept (never
  discarded — they hold real knowledge) but are non-citable.
- **Truth = human-verified, curated documents.**
- **The KB is reorganized around a durable DOMAIN taxonomy**, not around the transcript dump
  or the current flat category list.

---

## 3. The foundation (decisions + rationale + rejected alternatives)

### 3.1 Homes — mutually-exclusive roots
Every doc has exactly one **home root**:
- **Process** (the member lifecycle / campaign build)
- **Concepts & Skills** (marketing concepts: angles, headlines, creative strategy)
- **Operations** (membership, refunds, call hours, support, "how to get help")

**Litmus test used throughout:** *roots are mutually-exclusive homes (a doc lives in exactly
one); facets are cross-cutting tags (a doc can wear many).*

**Rejected:** *Blitz-as-spine.* Making the Blitz curriculum the organizing tree couples the
KB to a packaging artifact that will change. Chose a domain/lifecycle spine for
future-proofing; the Blitz becomes a mapping overlay (see 3.7).

### 3.2 Facets — cross-cutting tags (functional in retrieval, not decorative)
- **Concept tags**
- **Tool / software tags**
- **Troubleshooting tag**

These are **functional retrieval levers**: when a member says "Flexy," retrieval must boost
docs carrying that entity tag — not merely hope the word appears in the body.

**Concepts = root AND tag.** Earns a root because there is a large body of *concept-primary*
content (coaching strategy) that needs a home of its own; also rides as a tag on
process/tool docs.

**Tool = tag ONLY (no root).** Rationale from the Flexy example: software content is
*relational* — "Flexy is a webpage builder → builds the middle of your funnel → where your
angle/headline do their work." That content's value IS its connective tissue to process and
concepts. A root is a silo; siloing relational content destroys the value. So tool is an
entity tag that rides on docs homed in Process/Concepts.
- The three tool *intents* and where they land:
  1. **Configure it** → Process (a setup step), tagged `tool:x`.
  2. **It's broken** → Troubleshooting tag → support handoff.
  3. **Understand what it is / what a setting does** (neutral reference) → homes under the
     relevant setup step or the funnel-context concept doc, tagged `tool:x`.
- **Reversibility (why tag-only is the safe default):** if neutral tool-reference content
  later piles up, promoting "tool" to *also* a root is a cheap content migration (add a root,
  re-home the reference docs) — no schema change, because the tag already exists. The
  dangerous direction is the opposite (root-now, un-silo-later).

**Troubleshooting = tag ONLY.** A troubleshooting doc is always troubleshooting *of
something* (a tool, a step, a concept); a single Troubleshooting home would strip that
context. It carries a **ceiling with handoff to support**.

### 3.3 doc_class
- **curated** — human-verified truth, citable.
- **overview** — human-verified summary/orientation, citable.
- **transcript** — training/mining source only; **non-citable**, **excluded** from retrieval
  (see 3.8 decision).

### 3.4 Identity
- **Stable slug = identity; title = display only.**
- **Why:** titles are member-facing and *will* be edited for clarity/retrieval. Identity must
  be stable for upsert-without-duplicating, provenance links, and re-homing when the Blitz
  remaps.

### 3.5 Provenance
- **Many-to-many join table** linking each truth doc to its source transcript chunks.
- **Conflicts** ("which calls disagree about this?") are **AI-flagged, human-adjudicated**:
  - AI (drafting) notices source chunks disagree and surfaces the conflict on the draft, with
    both sources attached.
  - Human (review) picks the canonical answer and writes the truth; **losing sources are kept
    and linked as superseded / context — never deleted.**
- The join table is what *enables* "show me every source behind this claim, including the
  ones that disagree." Adjudication happens in the human review step.

### 3.6 Handoff / ceiling — one general mechanism, multiple targets
- Concept question exceeds grounded depth → **hand off to live coaching.**
- Troubleshooting exceeds what the KB can resolve → **escalate to support.**
- Both route through the **Operations** root (which holds the coaching schedule + support
  path). Operations is the handoff hub.

### 3.7 Blitz curriculum = mapping overlay (not the spine)
- Source of truth: `@workspace/blitz-curriculum` (23 sections / 4 phases:
  intro / build / test / scale; courseId `blitz-hub-step-v2-N`).
- It is a **mapping overlay onto Process** (~80% hugs the lifecycle; deviate only where the
  packaging ≠ the underlying truth).
- Guarded by a **data-level drift check** so the mapping can't silently rot.

### 3.8 No tier gating in the chatbot
- Access is **binary** — a member either has the chatbot or doesn't; there is **no
  basic/full gating inside it**. (Confirmed multiple times by the user.)
- The existing `chat:basic` / `chat:full` category restrictions in retrieval are
  **vestigial-to-verify** — do not design around them; confirm they aren't silently hiding
  categories.

### 3.9 Migration discipline
- **Additive / nullable columns + a default home** for un-migrated docs.
- Retrieval must **never break mid-transition.**
- Schema is **taxonomy-agnostic**: nodes and tags are *data* (a registry), not enum columns,
  so the taxonomy can evolve without migrations.

### 3.10 Surface differentiation (voice vs. chat)
**Goal:** voice = "basic support" (membership, refunds, call hours); chat = "deep answers"
(software, strategy, the Blitz).

**Difficulty: low/medium** — the seams already exist:
- **Two independent, editable system prompts** today: voice =
  `buildVoiceSystemPrompt()` (in `retell-agent-setup.ts`); chat =
  DB-managed `ANTI_HALLUCINATION_SYSTEM_PROMPT` (`chat-system-prompt.ts`,
  `chat_system_prompts` table).
- **Two retrieval entry points that already scope by category:** voice =
  `searchKnowledgebaseForVoice` (`routes/voice.ts`, `POST /voice/kb-search`) currently passes
  ALL 11 categories; chat = `searchKnowledgebase(query, categories)` (`routes/chat.ts`,
  `POST /chat`). They are separate functions but share `buildVoiceSynonymTsquery` and both
  filter `audience <> 'admin'`.

**Design:** per-surface **scope** (which roots/tags each surface retrieves from) + per-surface
**persona prompt**. Voice → **Operations**; chat → **Process + Concepts + tool tags**.
- **Prioritize, don't hard-wall:** if a member asks voice a deep question, voice gives a short
  answer or **hands off to the chatbot** ("the chat assistant can walk you through it").
- **Matches the medium:** voice is good at short factual Q&A and bad at long multi-step
  walkthroughs (no screen, no retention); chat is good at long structured answers. The scope
  plays to each surface's strengths.
- **Dependency:** depends on the **Operations** root being populated — so this is a
  late-sequence step. It also elevates Operations to a first-class, well-populated root (it
  becomes the voice assistant's primary corpus).
- **Enforcement:** both entry points must route through shared, surface-aware retrieval that
  honors `doc_class` + taxonomy; otherwise the scope won't apply to voice.

---

## 4. Resolved open decisions

- **Exclude transcripts immediately** (not deprioritize). No active members → no coverage-dip
  cost; cleaner code; and it produces an **honest coverage signal** (gaps are visible instead
  of being masked by a transcript that happens to rank). Removes the per-node "flip exclusion"
  step — adding a truth doc is the whole job.
- **No upfront Phase-0 eval gate.** The coaching transcripts ARE the record of real member
  questions, so the top questions surface naturally during node-by-node mining. Coverage is
  signalled structurally (taxonomy completeness) + by demand (transcript mining). Keep only
  cheap retrieval logging as a build-time debugging aid; fold a **question-validation pass in
  near the end** as an acceptance check, not a prerequisite.
- **No tier gating** (see 3.8).

---

## 5. Section 6 buckets (human editing vs. AI-derivable)

- **Bucket A — AI-derivable drafts:** AI mines the labeled transcript corpus to draft truth
  docs per taxonomy node.
- **Bucket B — AI-assisted:** drafts refined with AI help, still gated by human review.
- **Bucket C — human-only truth (irreducible):** the real 1-on-1 coach roster (from
  `session_pack_coaches`), support routing, call hours, refunds, "how to get help"; the
  taxonomy design itself; and conflict adjudication. **Human review gate is non-negotiable for
  anything member-facing** (no auto-push, overriding the legacy ≥0.85-confidence auto-push).

---

## 6. Order of operations (the sequence)

> Front steps are detailed and built first. Later steps are captured now (for preservation)
> and refined as their predecessors complete; dependencies prevent them running early.

0. **(Dropped as a gate)** — lightweight retrieval logging only, if near-free; question
   validation folded into the end as an acceptance check.

1. **Foundation: taxonomy design + schema + transcript exclusion + retrieval honors
   doc_class.** Design the node tree (Process stages, Concepts & Skills nodes, tag
   vocabularies) and build the additive/nullable schema (doc_class, slug, home root+node,
   tags, provenance join table, Blitz→node mapping, ceiling/handoff, last-verified, default
   home). Flip existing transcript rows to `transcript`/excluded; fix the seed path; make both
   chat + voice retrieval honor `doc_class`. **Also commits this foundation doc AND a
   plain-language team overview (`docs/ai-assistant-team-overview.md`) into the repo.**
   *(Critical path. The hinge. This is the user's #1 priority — it stops
   transcripts-as-truth immediately.)*

2. **Authoring + review pipeline (Bucket A→B).** Reuse the existing staging/triage/review
   infra; organize drafting per node; enforce the human gate (no auto-push for member-facing);
   wire provenance capture + conflict flagging + last-verified. *(Depends on 1.)*

3. **Human-only truth + Operations content-map (Bucket C).** Author the irreducible facts
   (roster, support routing, call hours, refunds) and walk the portal nav to define the
   Operations nodes. *(Can parallel 2.)*

4. **Truth-doc content campaign, node-by-node.** For each node: AI draft → human verify →
   publish curated/citable. Start with highest-demand gaps (e.g. DIYTrax overview, the
   help/roster doc that fixes Robin). *(Depends on 2; the bulk of the work.)*

5. **Retrieval refinements (Phase 2).** Rank curated above anything else; history-aware
   retrieval (fixes one-word follow-ups); expand synonyms; make concept/tool tags functional
   levers. *(Depends on 4 — needs curated docs to exist.)*

6. **Rules / prompt surgery (Phase 3).** Names-only-from-structured-docs; clarify-first; the
   depth-ceiling handoffs (concept→coaching, troubleshooting→support), wired through
   sentinel/boot enforcement so they can't drift. *(Depends on 5.)*

7. **Surface differentiation (voice = support, chat = deep).** Scope each surface to its
   roots, adjust the two prompts, wire the voice→chat handoff. *(Depends on 3 — needs
   Operations populated.)*

**Critical path:** 1 → 2 → 4 → 5 → 6. **Parallel-friendly:** 3 alongside 2. **Hinge:** Step 1.
Re-run the validation pass after 4, 5, and 6.

---

## 7. Current-system reference (verified)

- **Schemas:** `lib/db/src/schema/knowledgebase-docs.ts` (title UNIQUE, category, content,
  audience member/admin, FTS GIN index, sourcePath/sourceLabel),
  `lib/db/src/schema/kb-staging.ts` (kb_staging_docs + kb_triage_audit_log — existing
  Bucket A→B draft→review→push machinery; privacy scrub on push; legacy ≥0.85 auto-push must
  be overridden by the human gate).
- **Chat retrieval:** `artifacts/api-server/src/routes/chat.ts` — `searchKnowledgebase(query,
  categories)` (~L121), `POST /chat` (~L207).
- **Voice retrieval:** `artifacts/api-server/src/routes/voice.ts` —
  `searchKnowledgebaseForVoice` (~L58), `POST /voice/kb-search` (~L471); `ALL_KB_CATEGORIES`
  (11) ~L31.
- **Shared synonym layer:** `artifacts/api-server/src/lib/voice-synonyms` (used by both).
- **Prompts:** voice = `artifacts/api-server/src/lib/retell-agent-setup.ts`
  (`buildVoiceSystemPrompt`, ~L80, hardcoded); chat =
  `artifacts/api-server/src/lib/chat-system-prompt.ts` (`ANTI_HALLUCINATION_SYSTEM_PROMPT`,
  DB `chat_system_prompts`).
- **RAG:** `artifacts/api-server/src/lib/rag-retriever.ts`.
- **Blitz curriculum:** `lib/blitz-curriculum/src/index.ts`.
- **Source transcripts:** `video-transcripts.txt` (~1:1 with Blitz lessons; clean),
  `coaching-transcripts.txt` (200k+ lines; cross-cutting; PRIMARY source for
  conceptual/strategic topics + troubleshooting).
- **Remediation plan:** `attached_assets/Pasted-BTS-AI-Assistant-Remediation-Plan-*.txt`
  (Section 6 is the focus).

---

## 8. Continued-planning addendum — decisions made in co-design (preserve verbatim)

> These decisions were made *after* the initial draft above, during live co-design with the
> user. They refine — never contradict — sections 1–7. Captured WITH rationale per the
> preservation note.

### 8.1 Old-portal navigation & terminology translation
**Context:** the transcript corpus was recorded on the PREVIOUS portal/brand (e.g.
Cherrington/TCE, "21-day blitz"). The new BTS portal has different navigation paths and naming.
So mined content carries stale brand names, stale terminology, and — most importantly — **stale
navigation** ("find X under [old path]").

**The rule everything hangs on:** *how you navigate the portal to FIND an app has changed; how
you use an app once inside it (DIYtrax, Flexy) has NOT.* In-app navigation is unchanged;
in-portal navigation is changed.

**Decisions:**
- **Current portal navigation map** = human-verified Operations truth (Task #3): where
  everything lives now. Single source of truth for "where do I find X."
- **Legacy → current crosswalk** (Task #3): known renames/relocations — terminology ("21-day
  blitz" → "the Blitz"), brand (Cherrington/TCE → BTS), locations ("quickstart guide"/"core
  training" → where that content lives now).
- **Authoring translates, doesn't parrot (Task #2):** when mining, the AI rewrites stale
  nav/terms/brand to current BTS using the map + crosswalk + its own knowledge of the current
  portal; in-app nav preserved. A new **Stale/legacy reference** risk flag fires whenever it
  translates or can't confidently map — shown old-vs-new for human confirmation.
- **Answer-time safety (Task #6):** extends the existing, already-proven "always 'The Blitz'"
  prompt rule (present today in both chat + voice prompts) to navigation — the assistant gives
  navigation ONLY from the verified Operations map, never from transcript memory, and restates
  legacy terms in current language.
- **Retrieval (Task #5):** "where do I find X" questions retrieve the current Operations map so
  answers reflect the current portal, never a stale transcript path.

**Already-existing pieces (verified):** brand-NAME scrubbing already exists (privacy filter +
triage brand rules screen Cherrington/Charrington); terminology translation already has a proven
pattern (the Blitz-naming rule in both prompts). **Navigation translation is the genuinely new
capability.**

### 8.2 Cutover strategy — transcripts OFF immediately + graceful fallback + front-load
**Decision:** turn transcripts off the moment Task #1 ships (no phased per-node exclusion, no
"unverified disclaimer" interim).
**Rationale (user):** the portal isn't live yet and has no members, so there's no real coverage
cost; this buys unhurried time for human review, and the graceful fallback is a good behavior to
have permanently anyway.
**Rejected:** phased per-node exclusion (gentler but more complex, and unnecessary pre-launch);
keep-answering-with-disclaimer (re-opens the leak risk we're killing).
**Consequence handled:** the day-one knowledge drop (≈600 messy → ≈117 clean docs) is absorbed
by (a) the graceful no-answer fallback (8.3) and (b) front-loading the highest-traffic topics in
the content campaigns (Tasks #4a/#4b).

### 8.3 Graceful "no verified answer yet" + handoff (load-bearing)
When no curated/overview doc clears the bar, the assistant gives a clean "I don't have a verified
answer yet → here's how to get help" response and routes to coaching/support — it never guesses
to fill the gap. Retrieval exposes a "no confident match" signal (Task #5); the prompts wire it
to the fallback (Task #6). This is the safety net under the immediate cutover.

### 8.4 Demand-side radar (Task #8 — new)
Log the questions the assistants couldn't confidently answer, so authoring follows real demand
and we can tell when coverage is "good enough."
- **Scope now:** backend capture + a **lightweight admin list**.
- **Later:** a richer triage workflow (assign / dismiss / link-to-draft).
- Logged text runs through the existing privacy scrub. Depends on the no-answer signal (Tasks
  #5/#6).

### 8.5 Maintenance & freshness (foundation now, automation later)
- **Mining is ongoing, not one-time:** once live, new coaching calls happen weekly and should be
  scanned for new truth / changes in how we operate.
- **Built now:** the authoring pipeline (Task #2) is **re-runnable** on newly-added transcripts
  (reuses the exact same pipeline), and it **surfaces aging last-verified docs** for re-check.
- **Deferred:** the *scheduled* weekly "scan new calls → queue drafts" automation is a future
  plan, best built once the portal is live and calls actually flow.

### 8.6 People, roles, and deferred tightenings
- **Reviewers:** for now, **any admin** can author/approve. The *High-stakes* flag still
  highlights money/refund/policy claims for extra scrutiny. **Deferred:** restricting review to
  named reviewers and requiring **expert sign-off** on high-stakes docs.
- **Conflict escape hatch (built now):** a reviewer who genuinely can't adjudicate a conflict can
  mark a draft **"needs expert input"** instead of being forced to guess.
- **Voice navigation UX (deferred):** speaking "where do I find X" aloud with no screen needs its
  own design. Interim: voice hands deep navigation to chat or reads the click-path from the
  Operations map. The richer spoken-navigation experience is a later plan.
- **Quality scorecard / golden questions (deferred):** build after the retrained v1 exists, when
  we can curate a real golden-question set; coordinate with the existing QA tasks. Run it as an
  acceptance check after the content, retrieval, and rules phases — matching the
  "validation pass folded in near the end" decision in §4.

### 8.7 Risk flags replace the AI confidence score (review pipeline)
The legacy AI self-graded confidence score is **removed from the reviewer's view** (an
uncalibrated self-grade invites rubber-stamping), and auto-approve AND auto-reject are disabled
for member-facing docs. In its place the AI surfaces **checkable risk flags**: *Conflict*,
*Single-source* vs. *Corroborated-by-N* (a count, not a score), *High-stakes* (money/policy),
*Possible-duplicate*, *Weak-source*, and *Stale/legacy-reference*. Flags sort the queue and
signal *how hard to look* — never *whether* to look (every AI-authored truth doc is read by a
human). The fast/bulk-confirm path is restricted to the light existing-doc filing track and is
blocked by an unresolved *Conflict* or *High-stakes* flag.

### 8.8 Updated sequence
The order of operations in §6 gains **Step 8 — Content-Gap Radar** (demand-side logging +
lightweight admin view), depending on Steps 5 and 6 (it logs at the no-confident-match /
no-answer point). The radar then continuously informs Step 4's authoring priorities.

### 8.9 Disposition of the existing review-screen controls
Mapping the legacy admin KB controls to the new model so none are left orphaned:
- **Run Pipeline** (transcript mining) — *kept, central.* It is the authoring engine (Task #2);
  becomes taxonomy-aware and re-runnable.
- **Run AI Triage** — *kept but de-fanged.* No more member-facing auto-approve/auto-reject; it
  computes risk flags + a title/taxonomy suggestion for a human to confirm.
- **AI Triage Settings (0.85 auto-approve / 0.20 auto-reject thresholds)** — *removed.* This is
  where the "arbitrary 80%/20%" lived; with no confidence buckets and no auto-action, the panel
  goes away. (Consistent with §8.7.)
- **Maintenance SOP** (static PDF) — *replaced.* The current PDF documents the old pipeline →
  triage → confidence-push flow; it is rewritten to match the new review flow, with the full
  weekly SOP finalized in the deferred maintenance-automation phase (§8.5). Hidden rather than
  left linking a misleading doc if the rewrite lags.

### 8.10 Clean-slate reset (surgical, pre-launch) + re-verify curated content
**Decision (user-confirmed):** a **surgical** reset, executed as an **empty-and-rebuild** because
we're pre-launch with no members using the chatbot.
- **Live-doc census (today, 602 total in `knowledgebase_docs` = the admin "Live Documents" view):**
  transcript-derived = coaching 295 + curriculum 190 = **485** (the strip/exclude pile, and the
  leak source); human-curated = **117** (glossary 51, FAQ 29, Blitz guide 23, tools 5, resource 3,
  strategy 2, SOP 3 [2 admin-only], platform guide 1 — the re-verify pile). The old **review
  queue** (`kb_staging_docs`) separately holds **310** drafts (306 pending + 4 pushed) — the
  abandoned attempt, cleared/archived.
- **Keep, untouched:** every source file on disk — raw transcripts (coaching/video `.txt` + the
  179 per-coach 1:1 `.docx` files under `src/data/coaching-transcripts/`) and trainings (the mining
  input) AND the human-curated files (`qa-articles.txt` ≈38 Q&A, `glossary.txt`,
  `training-documents.txt` ≈22). Nothing is deleted.
- **Empty the citable answer set:** the assistant answers only from **human-verified** docs.
  Transcript docs are excluded by class; the curated docs are held as re-verification drafts (not
  auto-trusted). This sidesteps the live-KB "keep vs strip" problem — the live table has no
  provenance tag to separate hand-curated from auto-pushed transcript docs, so we rebuild instead
  of sorting.
- **Re-verify the curated docs:** even hand-written content has stale references (found: old
  booking links `…/bookings/tce-launchpad-call`, old-portal URLs `experience.BTSmedia.com`, "core
  training" naming). So the ~117 curated live docs (≈51 glossary terms, 29 FAQs, the 23-part Blitz
  guide, plus tool/resource/strategy/SOP entries) run through the same review pass (Task #2) —
  clean ones fast via guided/rapid mode, stale ones flagged + edited — before they're citable.
  Light, bounded lift.
- **Why this is safe:** no members are using the chatbot yet, so an empty interim has no cost; the
  graceful no-answer fallback (§8.3) covers it; front-loading high-traffic topics (§8.2) shrinks
  the window.

**Pipeline "done" tracking is queue-scoped, not durable.** Today the pipeline infers "already
mined" from drafts still sitting in the review queue. Clearing the queue erases that memory and a
re-run reprocesses everything. The re-runnable-pipeline work (§8.5 / Task #2) must give
"already-mined" a durable record so future weekly mining skips processed calls.

### 8.11 Internal / non-member recordings must be quarantined (not just un-cited)
**Problem found:** the batch transcript uploads swept in **internal meetings that were never
member-facing** — e.g. *Weekly Coaches Check-In*, *E-Comm Weekly Check-In*, *Mark Blyn's Personal
Meeting Room*, *Adam Field Meeting Information*, *Dara Dameron Meeting Information*, *John Freese /
Mark Blyn* (1:1), *Zoom Meeting*, *Untitled document*. These can contain strategy/staffing/private
content that must never reach a member — **not even as mining material.**

**Decision:** a transcript source gets a **disposition** — `training` (mineable) vs
**`quarantined`** (excluded from citation AND from mining). Quarantine is stronger than the
`transcript` doc_class (which only blocks citation while still allowing mining). The pipeline
**must skip quarantined sources** when drafting.

**Detection:** name-based, with a **known-internal seed list** from the corpus scan, plus pattern
matching (coaches/weekly check-in, personal meeting room, team/staff/internal sync, untitled, zoom
meeting, founder/staff names). **Conservative default:** anything not confidently identifiable as
member-facing training (e.g. *Untitled document*, *Zoom Meeting*) is quarantined until a human
clears it. Admins can quarantine/restore any source by hand.

**Scan census (coaching corpus, 52 sources):** clear internal = the check-ins (Coaches ×3,
E-Comm ×3), Mark Blyn's Personal Meeting Room, John Freese / Mark Blyn, Adam Field Meeting
Information, Zoom Meeting, Untitled document ×2. Ambiguous (need human call; default quarantine) =
TCE Support Coaching Weekly ×4, TCE Concierge Coaching Weekly, Dara Dameron Meeting Information ×2.
Legit member training = the named member 1:1 calls + the LIVE/Live Coaching Call series. The
**video corpus (97 titles) scanned clean** — all numbered curriculum / Blitz / Concierge training.
**Also noted:** legit member 1:1 transcripts carry PII (names/emails, even in titles) — covered by
the answer-time privacy scrub, not the quarantine path.

**Raw-source inventory (three pools — screening must cover all of them):** (1)
`video-transcripts.txt` = **97** training videos (scanned clean); (2) `coaching-transcripts.txt` =
**52** concatenated recordings (group LIVE Coaching Calls + some named 1:1s + the internal meetings
above); (3) `src/data/coaching-transcripts/<coach>/*.docx` = **179** individual 1:1 member calls
(John 103, Neil 76). Total coaching recordings = **231** across two pools; the 97 videos are NOT
coaching. The 1:1 pool adds one internal suspect — **John Dela Cruz's Zoom Meeting** — to the
quarantine seed list; the rest are member calls. **Detection precision:** match "check-in" /
"check in" as whole phrases, not the substring "check" — legit titles like "Campaign Setup
Checking" / "Double Checking My Learning" must NOT auto-quarantine; human-restore is the safety
valve. **Cross-pool overlap:** the .txt and .docx coaching pools reference the same members (e.g.
Jack Gambardella, Rich Penner, Ruby Ramos), so the miner must **dedupe across pools**, not just
within the review queue (ties to the §8.10 durable-dedup note).

### 8.12 Source authority — VAs are not weighted like strategy coaches
**Distinction (user-confirmed):** the per-coach 1:1 `.docx` pools are **VA** calls (John, Neil,
Mikha), not strategy-coach calls. VAs are qualified to give **software help, tool guidance, and
basic campaign-setup** information — but their **strategic / higher-level suggestions must NOT be
auto-treated as truth**, and must not be weighted the same as a strategy coach (Sasha, Bruce,
Michael, Todd, who run the LIVE Coaching Calls).

**Mechanism:** every source carries an **authority role** that mirrors the live `coaches.type`
vocabulary — `strategic_coach` / `va`, plus `curriculum`(official) / `internal`(quarantined) —
stored on the source registry (§8.11 / Task #1). Role is inferred from source identity by joining
the source's coach/VA name to the `coaches` roster (name → `type`), not a hard-coded list, so it
stays correct if the roster changes. (Confirmed in the DB: `strategic_coach` = Bruce, Michael,
Sasha, Todd; `va` = John, Neil, Mikha — Neil also does `one_on_one_va` calls. All of
`data/coaching-transcripts/John|Neil` = `va`; numbered training videos = `curriculum`.) Mined
drafts inherit their source's role.

**Enforcement (authoring-time, where it matters most):** the review pipeline raises a *VA-sourced
strategy claim* risk flag when a VA-derived draft asserts something strategic/higher-level beyond
software/setup scope. The reviewer then either scopes it to software/setup, requires corroboration
from a strategy-coach / curriculum / expert source before publishing as truth, or rejects it. VA
content stays fully authoritative for software/tool/setup answers. (Because every citable doc is
human-verified, this is primarily an authoring guardrail; a later retrieval refinement could also
prefer higher-authority sources for explicitly strategic questions, but that is not required here.)
