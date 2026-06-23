---
name: KB content must carry member-facing terminology, not just internal/legal naming
description: Why voice/KB full-text search misses content titled with formal names members never say
---

The voice assistant (and member /kb/search) retrieve via Postgres full-text
(`websearch_to_tsquery` + an OR fallback in `searchKnowledgebaseForVoice`), which
is purely lexical — there is no semantic/synonym layer. So a doc only surfaces
for the exact words it contains.

**Rule:** every KB article must contain the words members actually say, not only
the formal/legal name. The mentorship contract is filed in the KB as "BTS
Agreement" / "BTS Mentorship Program Agreement", but members (and the real
contract) call it the **"Mentee Master Agreement"** / "mentorship agreement".
None of the agreement articles contained those phrases, so voice returned
nothing for natural questions about it.

**Why:** user reported "voice has no knowledge of the mentee master agreement"
even though the agreement content existed and the Retell prompt already triggered
KB search on agreement/refund topics — the gap was retrieval, not the prompt.

**How to apply:** when adding/auditing policy or program KB content, add a
dedicated anchor article whose title + opening contains the common aliases (e.g.
"What is the BTS Mentee Master Agreement?" listing Mentee Master Agreement /
mentorship agreement / BTS Agreement / "the Agreement"). Voice speaks the top
hit's first ~400 chars, so make the anchor a concise summary. Register the new
title in `BTS_AGREEMENT_KB_TITLES` so `ensureBtsAgreementKbContent` force-upserts
it to prod on publish (plain seeder is ON CONFLICT DO NOTHING).

**Quirk:** `websearch_to_tsquery` does NOT treat verbs like "tell"/"give"/"show"
as stopwords, so "tell me about X" becomes `tell & ...` and the primary query
returns 0; the OR fallback (`rows.length < 2`) is what saves these conversational
phrasings — keep it.
