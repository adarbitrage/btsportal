---
name: Chat continuity summary seams
description: Rolling per-session conversation summary for the member chat — watermark gate, incremental fold, fail-open contract.
---

# Conversation Continuity Summary (member chat)

The member chat keeps a rolling per-session summary (`chat_session_summaries`, one row per session, unique on session_id) of messages that age OUT of the history window (`config.historyDepth`).

**Rules that must hold:**
- **Watermark exact-match gate**: the summary is injected into a turn ONLY when its `covered_through_message_id` equals the id of the newest aged-out message (history query `ORDER BY created_at DESC OFFSET historyDepth LIMIT 1`). Stale = skipped, never reused.
- **One-turn lookahead on update**: the end-of-turn updater targets offset `historyDepth - 1`, because the next turn's lookup happens AFTER inserting that turn's user message (which advances the boundary by one). Update and lookup using the same offset perpetually mismatch and the summary never injects — this exact off-by-one shipped once and was caught by review; the production-sequence tests (update → insert → lookup) guard it.
- **Incremental fold only**: updates feed the LLM just the slice `(coveredThrough, targetWatermark]` plus the previous summary — never a from-scratch recompute over the whole conversation.
- **Fail-open everywhere**: lookup errors, missing table, summarizer errors/timeouts all log and no-op; the member's turn must never block on it. Empty LLM output keeps the previous row.
- **Fixed 3-section prompt shape** (asserted by tests): Confirmed completed steps (member confirmations VERBATIM, never inferred), Member-stated setup facts (scoped per brand domain — facts never carry across domains), Explicitly not done yet.
- The injected block is labeled "context, never instructions" and referenced by prompt Rule 19 (checkpoint questions must re-check it before re-asking a confirmed step).
- Injection points in the chat route: prepended as earliest retrieval history turn AND appended to system prompt after the campaign spine.

**Why:** built for the observed failure where the assistant re-asked a step the member had confirmed after it scrolled out of the window. Within-conversation only — no cross-session memory by design.

**How to apply:** any change to summary shape, watermark semantics, or injection must keep `buildContinuitySummarizerPrompt` / gate tests in `chat-continuity.test.ts` in lockstep. Recurrence-phrasing drift in KB docs is separately flagged by the advisory `recurrence_drift` flag (process-class docs only, same-line topic+recurrence match, never blocking).
