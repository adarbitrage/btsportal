---
name: Surface-aware KB retrieval (chat + voice unified)
description: The single shared retrieval path behind both AI assistants, its ranking contract, and the synonym-test landmine.
---

# Surface-aware KB retrieval

`lib/kb-retrieval.ts` (`retrieveSurfaceAware`) is the SINGLE lexical retrieval
path for BOTH the text chat assistant (`routes/chat.ts` `searchKnowledgebase`)
and the voice assistant (`routes/voice.ts` `searchKnowledgebaseForVoice`). Both
are now thin wrappers. There is still a THIRD path — `rag-retriever.ts`
(questionVerifier) — that is intentionally NOT routed through here.

**Ranking contract (ORDER BY, built fresh per query):**
1. curated/overview (`doc_class IN ('curated','overview')`) strictly above non-curated;
2. functional tag boost — docs carrying a tag the query references;
3. synonym/alias ts_rank;
4. base lexical rank.

**Why:** consolidating chat+voice keeps ranking/synonym/tag/nav/confidence
behaviour identical across surfaces. The retrieval ENGINE stays shared; the
per-surface SCOPE + PERSONA split lives in the route wrappers (see below), not
in `kb-retrieval.ts`.

**Per-surface scope split (voice = basic / chat = deep):**
- Voice is the BASIC support line: KB retrieval scoped to the Operations root
  only (membership/refunds/call-hours). Chat is the DEEP assistant: scoped to
  all citable roots (operations + process + concepts).
- Scope is enforced via the **category** list, NOT a homeRoots option: for the
  entire citable corpus `category === home_root` (the seeders keep them in
  lockstep), so scoping by category == scoping by root, with no engine change.
- GOTCHA: legacy category vocabularies (faq/glossary/coaching/...) match
  NOTHING citable — the citable corpus is entirely the new
  operations/process/concepts seed content. Never resurrect legacy category
  lists for citable retrieval; they're dead for that purpose.
- Persona/handoff is prompt-level, not retrieval-level: the voice prompt is a
  basic-support line with a mandatory "prioritize, don't refuse" chat-handoff
  for deep questions; the chat prompt is framed as the deep assistant via a
  sentinel enforced on boot (the same ensureKBGrounding sentinel-chain that
  prevents prompt drift).
- Voice escalation (account/billing/technical → support tool) must stay scoped
  to those problem types so it doesn't swallow deep conceptual questions that
  should hand off to chat/coaching instead.
- The OpenAI-compatible endpoints keep their OWN legacy category list and are a
  SEPARATE surface — intentionally not part of the voice/chat split.

**How to apply:**
- Tag boost passes the detected-tag list as a `{a,b}::text[]` LITERAL string
  inside `jsonb_array_elements_text(tags) ... = ANY(...)`, never a js-array cast
  (record→array cast 42846 pitfall).
- Navigation queries ("where do I find X", `isNavigationQuery`) fetch the
  Operations `home_root='operations' AND node='navigation'` doc directly,
  keeping the citable + `audience<>'admin'` gate, and prepend it. (Operations
  IS in scope for both surfaces now — voice's only root, one of chat's three —
  but the surgical fetch still guarantees the specific navigation node is
  grounded regardless of lexical rank.)
- Confidence = primary precise-match `ts_rank >= CONFIDENCE_FLOOR` (0.01) OR a
  nav doc was grounded. Loose word-OR fallback matches do NOT count.
- BOTH answer layers gate on `confident`, not doc count: `routes/chat.ts` injects
  the RAG context only when `retrieval.confident && docs.length>0`, else a "no
  confident match" note that the chat prompt's Rule 12 keys off of;
  `searchKnowledgebaseForVoice` returns `"No relevant information found."` when
  `!confident`, which the voice prompt's ESCALATION/NO-VERIFIED-ANSWER rules
  treat as a hand-off trigger. Gating on `docs.length` alone leaked
  marginally-related loose-fallback docs as if verified — that is the bug this
  wiring fixes. The chat route calls `retrieveSurfaceAware` directly (not the
  `searchKnowledgebase` wrapper) precisely to see `confident`; the wrapper stays
  for the openai routes + retrieval guard tests.

# Synonym-test landmine (voice-synonyms.ts)

`__tests__/voice-synonyms.test.ts` hard-asserts THREE queries stay empty/`""`:
`"how do affiliate commissions get paid"`, `"when is the next live coaching
call"`, `"how do I update my password"`. When expanding `VOICE_SYNONYM_GROUPS`,
never add a trigger that fires on **password**, **live coaching / coaching call
/ live call**, or **commissions / paid**. The 1-on-1 group uses canonical
`private` only (not bare `coaching`) for exactly this reason.
