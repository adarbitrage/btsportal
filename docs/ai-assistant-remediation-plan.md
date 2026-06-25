# BTS AI Assistant — Remediation Plan

> Purpose: a concrete, sequenced plan to fix the AI assistant's answer quality,
> based on the root-cause analysis of three observed failures (the DIYTrax
> "setup" answer, the "Robin" name leak, and the rules/retrieval architecture
> review). This is a planning document — no code has been changed.

---

## 1. Diagnosis recap (why this plan is ordered the way it is)

Every observed failure was **correct model behavior on bad inputs**, not the
model misbehaving. That single fact dictates the fix order: the leverage is
upstream (content + retrieval), not in the rules.

Ranked by how broken each layer is:

| Layer | State | Caused which failure |
|-------|-------|----------------------|
| **Content / KB structure** | Most broken (root cause) | DIYTrax (no overview doc) + Robin (raw transcripts cited) |
| **Retrieval** | Moderately broken (amplifier) | DIYTrax (lexical, single-shot, latest-message-only) |
| **Rules / system prompt** | Least broken (mis-scoped) | Robin (Rule 1 "use context" vs Rule 2 "no staff names") |

**Core problematic issue: the training database / content structure**, amplified
by a blunt retrieval design. The rules are essentially sound and should be
touched last and surgically.

The trap to avoid: starting by rewriting rules because they're the easiest to
edit. That polishes the wrong layer and leaves both failure modes intact.

---

## 2. Where each thing lives today (so the plan is grounded)

- **System-prompt rules:** authored in `artifacts/api-server/src/lib/chat-system-prompt.ts`
  (`ANTI_HALLUCINATION_SYSTEM_PROMPT`), served at request time from the
  `chat_system_prompts` DB row (`isActive = true`), seeded by `seed.ts`, and
  self-healed on boot by `bootstrap-critical-prerequisites.ts` via sentinel
  checks. Admin-editable via `admin-chat.ts` (versioned), but boot enforcement
  reverts edits that drop a sentinel.
- **Retrieval:** `artifacts/api-server/src/lib/rag-retriever.ts` (`retrieveFromKB`)
  and `searchKnowledgebase()` in `artifacts/api-server/src/routes/chat.ts`.
  Purely lexical (`websearch_to_tsquery` / `ts_rank`), `limit` 3–6, searches on
  the **latest message only**.
- **Synonym/alias layer:** `artifacts/api-server/src/lib/voice-synonyms.ts`
  (currently one group: refund). OR-folded into the tsquery.
- **Privacy/name filter:** `artifacts/api-server/src/lib/content-privacy-filter.ts`
  (`scrubPrivateContent`), applied at answer-time inside retrieval. Strips
  surnames; lets first names through by design.
- **KB content source:** `artifacts/api-server/src/knowledge-base/*.txt`, seeded
  into the `knowledgebase_docs` table. NOTE: editing the `.txt` files does not
  update already-seeded rows — the DB must be updated too.

---

## 3. The plan, in phases

### Phase 0 — Instrumentation (do first; you can't fix what you can't see)

Goal: make answer quality measurable before and after each change.

1. **Build an eval set.** Collect 30–50 real member questions (mine chat history),
   including the ambiguous ones ("how do I set up X", "who do I talk to", casual
   phrasings). For each, write the *correct* answer + which doc(s) should be
   cited.
2. **Log retrieval results.** For each chat answer, record the query, the doc
   titles/ids retrieved, and their ranks. This is the single most useful
   diagnostic — most "bad answers" are visible as "wrong docs retrieved."
3. **Define pass/fail** per question (right facts, right citation, asks to
   clarify when it should). Re-run after each phase.

Exit criteria: a repeatable scorecard you trust.

---

### Phase 1 — Content / knowledge structure (the root cause; biggest payoff)

Goal: stop citing raw transcripts; give the assistant authoritative, member-worded
docs to ground on.

1. **Reclassify transcripts as training-only, not answer-grade.**
   - Transcripts (`coaching-transcripts.txt`, `video-transcripts.txt`) are full
     of names, side-chatter, and half-thoughts. They should not be the primary
     citable surface. Either:
     - (a) move them to a separate `audience`/`category` that retrieval
       deprioritizes or excludes for member answers, or
     - (b) keep them but rank curated docs strictly above them (see Phase 2).
2. **Create curated "overview / index" docs for every major tool & topic.**
   - e.g. *"DIYTrax Setup Overview"* listing the distinct sub-tasks in member
     language: create a campaign + basic info, add ads in the Traffic Source
     tab, connect ClickBank IPN/postback (ClickBank only), go live.
   - These rank well for broad queries ("how do I set up X") and give the model
     a **menu to offer** instead of one rabbit-hole.
3. **Split big transcripts/docs into task-scoped articles with member-vocabulary
   titles.**
   - e.g. *"DIYTrax — Create a Campaign & Basic Info"*, *"DIYTrax — Add Ads in
     the Traffic Source Tab"*, *"DIYTrax — ClickBank IPN / Postback (ClickBank
     only)"*.
   - Titles are folded into the searchable text and weigh on ranking — naming by
     sub-task + casual verb is one of the cheapest retrieval fixes.
4. **Add a canonical "How to get help" doc.**
   - Who actually staffs 1-on-1s, what the Concierge page is for, Discord
     ownership, support email. This gives the model the *correct* structured
     answer so it stops improvising from transcript chatter (the Robin failure).
5. **Fix the edit path.** Remember: updating `.txt` does not update seeded DB
   rows. Establish a clear "edit content → update DB row → restart for cache"
   procedure (or an admin UI — see the related project task on a KB content SOP).

Exit criteria: every Phase-0 ambiguous question has a curated doc that *should*
answer it; transcripts no longer outrank curated docs.

---

### Phase 2 — Retrieval (the amplifier)

Goal: make selection less blunt so good content actually surfaces.

1. **Prefer authoritative docs over transcripts.** Tier the corpus so curated
   articles rank above transcripts (boost by category, or two-pass: curated
   first, transcripts only as fallback). Directly prevents transcript-name leaks.
2. **Make retrieval history-aware.** Today the search uses the latest message
   only, so one-word follow-ups ("clickbank") search on a fragment. Fold the
   recent turn(s) into the search query so clarify→answer flows work.
3. **Expand the synonym/alias layer** (`voice-synonyms.ts`) beyond `refund` for
   recurring member→doc vocabulary gaps. Note: synonyms raise recall but do NOT
   resolve ambiguity ("setup" means many things) — pair with Phase 1 overview
   docs.
4. **(Larger, later) Semantic / vector retrieval.** Only after content is clean.
   Lexical-only is a hard ceiling; embeddings remove it but are a bigger project.
   Don't start here.

Exit criteria: eval scorecard shows the right docs retrieved for the ambiguous
set; follow-ups land.

---

### Phase 3 — Rules / prompt (surgical, last)

Goal: close the two real gaps without rewriting the (sound) rule set.

1. **Add a "names only from structured docs" rule.** e.g. *"Never attribute a
   role, contact, or booking path to a person unless a curated (non-transcript)
   doc states it. Names appearing only in call dialogue are not recommendations."*
   Closes the Rule 1 vs Rule 2 tension that produced Robin.
2. **Strengthen the clarify-first behavior.** The current "follow-up when
   appropriate" is too soft and fires after retrieval. Add: *"When a request is
   broad or maps to several distinct procedures (e.g. 'setup', 'tracking',
   'ads'), list the specific options and ask which they mean before diving into
   one."* Works best once Phase 1 overview docs give it the menu.
3. **Wire any new rule through the sentinel/boot-enforcement mechanism** so it
   can't silently drift out of the active DB prompt.
4. **(Optional, bigger) Agentic retrieval.** Let the model issue its own search
   *after* clarifying, within one turn. Most robust clarify→answer flow, but the
   largest change to the chat route — only if Phases 1–2 don't get you there.

Exit criteria: Robin-class attribution no longer occurs; ambiguous questions get
a scoping question instead of a confident wrong answer.

---

## 4. Sequencing summary

```
Phase 0  Instrumentation / eval set        ← enables measurement
Phase 1  Content restructure               ← root cause, biggest payoff, low risk
Phase 2  Retrieval (tiering, history, synonyms) ← amplifier
Phase 3  Rule patches (names, clarify)     ← surgical, last
(Later)  Semantic search / agentic retrieval ← ceiling removal, biggest change
```

Do not invert this. ~80% of the observed problem is Phases 0–1.

## 5. What "fixed" looks like

- "How do I set up DIYTrax" → an overview answer that offers the sub-tasks and
  asks which one, citing curated docs (not the ClickBank-only transcript).
- "Who do I book a 1-on-1 with" → the correct staffed coaches from the canonical
  help doc, never a name scraped from call chatter.
- Follow-up replies ("clickbank") → retrieve correctly using conversation context.
- Eval scorecard materially up vs. the Phase-0 baseline.

## 6. Risks / watch-items

- **Don't delete transcript knowledge** — it's valuable training material;
  reclassify, don't discard.
- **Content edits must reach the DB**, not just the `.txt` files (and restart for
  the system-prompt/content cache).
- **Boot enforcement will revert prompt edits** that drop a sentinel — route new
  rules through that mechanism.
- **Measure before/after each phase** — without Phase 0 you're guessing.
