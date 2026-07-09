---
name: KB hybrid semantic retrieval
description: Semantic embedding layer over lexical KB retrieval — key seams, dormant mode, calibration contract
---

- Replit AI proxy (AI_INTEGRATIONS_OPENAI_*) does NOT support /embeddings — verified empirically. Semantic search needs a real `OPENAI_API_KEY`; without it the whole layer degrades gracefully to exact legacy lexical behavior (LEXICAL-ONLY boot log line).
- **Why:** proxy only passes chat/transcription endpoints; embeddings 404/reject. Don't retry via proxy.
- **How to apply:** any new embedding-dependent feature must use the direct key seam in `kb-embeddings.ts` and be null-embedding safe.
- Confidence rule: confident = lexical>=floor OR nav doc OR semantic>=SEMANTIC_CONFIDENCE_FLOOR (placeholder 0.5 until calibrated with real embeddings via kb-semantic-calibration.test.ts — suite skips LOUDLY without key/embedded docs).
- Every content mutation must clear embedding fields ATOMICALLY in the same update (spread `CLEARED_EMBEDDING_FIELDS` from kb-embeddings) then fire the background re-embed — a failed re-embed must leave NO embedding, never a stale one. Three defense layers: atomic clear, retrieval freshness guard (`embedding_generated_at >= updated_at`), boot backfill staleness check (`generated_at < updated_at` or model mismatch).
- pgvector: 0110 migration creates the extension; fresh-DB reset in migration-drift test must CREATE EXTENSION vector or drift baseline breaks.
