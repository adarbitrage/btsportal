---
name: Voice KB synonym/alias layer
description: How natural member phrasings map to canonical KB terms in voice search, and why integration testing it is flaky.
---

# Voice KB synonym/alias layer

`searchKnowledgebaseForVoice` (artifacts/api-server/src/routes/voice.ts) is purely
lexical. A code-based alias layer (lib/voice-synonyms.ts, `VOICE_SYNONYM_GROUPS`)
maps member phrasings ("money back guarantee", "do I get my money back") onto
canonical content lexemes (e.g. `refund`) and OR-folds them into BOTH the primary
tsquery (`websearch_to_tsquery || to_tsquery(synonyms)`) and the OR fallback. Empty
match => query left untouched. Matching is accent-insensitive + punctuation-tolerant.

**Why in-code (not a PG synonym dictionary):** a CREATE TEXT SEARCH DICTIONARY
synonym template needs a `.syn` file in the server's `tsearch_data` dir — not
possible on managed Postgres. In-code is versioned + unit-testable + no runtime DB dep.

**Testing pitfall (why no DB integration test):** ts_rank is heavily TITLE-weighted
and NOT length-normalized by default, so a short seeded "marker" doc — even with the
canonical word repeated 40x in its body — still ranks BELOW the real refund articles
(which carry "refund" in their A-weighted titles) and falls out of the LIMIT 4. A
marker-based integration test is therefore flaky against the shared dev DB (which the
app boot-seeds with the real KB). Lock the behavior with a UNIT test on the synonym
mapping instead (voice-synonyms.test.ts). globalSetup only syncs schema; it does NOT
seed KB.

## Concepts/strategy layer (July 2026)
CONCEPT_SYNONYM_GROUPS in lib/voice-synonyms.ts maps casual phrasings ("aren't getting clicks", "which product should I promote") to concepts-corpus lexemes (angle/headline/creative/offer/testing/scaling/metrics/cpa/placement); spread into VOICE_SYNONYM_GROUPS so the shared chat+voice path expands them. Landmine set (password / live coaching / commissions) must stay unexpanded — a static forbidden-word trigger guard lives in kb-concepts-synonyms.test.ts. Note: the Offer Strategy doc lexically matches "commissions" legitimately; negative guards for that query must assert empty EXPANSION, not absent doc. Chat injects FULL doc content via exported buildRagContext (routes/chat.ts); voice's 400-char trim is deliberate and guarded in kb-full-content-injection.test.ts.
