---
name: Chat bare-affirmation follow-up resolution
description: How "yes" replies to assistant offers are resolved for KB retrieval, and the tsquery AND trap
---

Rule: a contentless confirmation ("yes", "sure, go ahead") must resolve against the ASSISTANT's trailing offer question, not the member's prior question. `buildHistoryAwareQuery` (lib/kb-retrieval.ts) branches on `isBareAffirmation` → `extractAssistantOffer` (last question-terminated sentence, must end the message) → searches the DISTILLED offer alone.

**Why:** "yes" after "Want me to walk you through domain/subdomain setup?" used to search "cloning a template yes" → doc below the 0.5 semantic floor, lexical 0 → Rule 12 refusal despite the doc existing.

**How to apply:**
- Never feed a full conversational sentence into `websearch_to_tsquery` — it ANDs every term, so boilerplate words ("want", "walk", "next") zero out lexical matching. Distill to the topical core first.
- Don't append the affirmation word itself to the query; it carries no content.
- Retrieval traces (`chat_messages.retrieval_trace`) are the diagnostic tool: they record per-doc lexical rank + semantic score + floors for every assistant turn.
