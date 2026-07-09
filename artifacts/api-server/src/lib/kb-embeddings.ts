/**
 * KB embedding seam (Task #1803) — the ONLY writer of
 * ai_live_documents.embedding, and the query-embedding helper for hybrid
 * retrieval (lib/kb-retrieval.ts).
 *
 * Provider: the OpenAI embeddings API called DIRECTLY with OPENAI_API_KEY.
 * The Replit AI-integrations proxy (AI_INTEGRATIONS_OPENAI_BASE_URL) does NOT
 * support the /embeddings endpoint (verified empirically — it returns
 * INVALID_ENDPOINT), so a real OpenAI key is required for the semantic layer.
 *
 * Graceful degradation is a hard requirement: when the key is absent or a call
 * fails, everything here logs LOUDLY and returns null/skips — documents simply
 * keep a NULL embedding and retrieval stays lexical-only. No write path or
 * member turn may ever fail because of an embedding problem.
 *
 * Values are stored/read as pgvector text literals ("[0.1,0.2,...]") with an
 * explicit ::vector cast in raw SQL — never through drizzle value mapping
 * (see the drizzle ANY(array) record-cast pitfall).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Bump together: model + dimension + the boot backfill's staleness check. */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

/** Keep well inside the model's 8191-token input cap (~4 chars/token). */
const MAX_EMBED_CHARS = 24_000;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Drizzle `.set()` fragment that clears the embedding fields. Every write path
 * that mutates a live doc's title or content MUST spread this into the SAME
 * update (atomic with the content change), then fire the background re-embed.
 * If the re-embed fails, the doc has NO embedding (lexical-only) rather than a
 * STALE one — stale vectors must never influence ranking/confidence. The boot
 * backfill retries anything left cleared.
 */
export const CLEARED_EMBEDDING_FIELDS = {
  embedding: null,
  embeddingModel: null,
  embeddingGeneratedAt: null,
} as const;

/** Render a pgvector text literal. Callers embed it as `${literal}::vector`. */
export function toVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}

/**
 * Embed a single text. Returns null (never throws) when the key is missing or
 * the API call fails — callers treat null as "no semantic signal".
 */
export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn(
      "[kb-embeddings] OPENAI_API_KEY not set — semantic layer disabled, staying lexical-only",
    );
    return null;
  }

  const input = text.slice(0, MAX_EMBED_CHARS);
  if (!input.trim()) return null;

  try {
    const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        `[kb-embeddings] embeddings API returned ${resp.status}: ${body.slice(0, 300)}`,
      );
      return null;
    }
    const json = (await resp.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = json.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
      console.error(
        `[kb-embeddings] unexpected embeddings response shape (dim=${embedding?.length ?? "none"})`,
      );
      return null;
    }
    return embedding;
  } catch (err) {
    console.error("[kb-embeddings] embeddings API call failed:", err);
    return null;
  }
}

/** Embed a member query for hybrid retrieval. Null = lexical-only this turn. */
export async function embedQuery(query: string): Promise<number[] | null> {
  if (!isEmbeddingConfigured()) return null; // quiet per-turn; boot already warned
  return embedText(query);
}

/**
 * (Re)generate and store the embedding for one live document. Reads the row's
 * CURRENT title+content so it is safe to fire after any write. Never throws.
 */
export async function embedLiveDocument(docId: number): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT title, content, updated_at FROM ai_live_documents
      WHERE id = ${docId} AND deleted_at IS NULL`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((result as any).rows ?? result) as Array<{
      title: string;
      content: string;
      updated_at: Date | string;
    }>;
    const row = rows[0];
    if (!row) return false;

    const embedding = await embedText(row.title + "\n\n" + row.content);
    if (!embedding) return false;

    // Guarded write: only store the vector if the row was NOT edited while we
    // were embedding (updated_at unchanged). A concurrent edit clears the
    // embedding fields and fires its own re-embed; storing ours would attach a
    // stale vector to the new content.
    await db.execute(sql`
      UPDATE ai_live_documents
      SET embedding = ${toVectorLiteral(embedding)}::vector,
          embedding_model = ${EMBEDDING_MODEL},
          embedding_generated_at = NOW()
      WHERE id = ${docId} AND updated_at = ${row.updated_at}`);
    return true;
  } catch (err) {
    console.error(`[kb-embeddings] failed to embed live doc ${docId}:`, err);
    return false;
  }
}

/** Fire-and-forget wrapper for write paths: never blocks, never throws. */
export function embedLiveDocumentInBackground(docId: number): void {
  void embedLiveDocument(docId).then((ok) => {
    if (!ok && isEmbeddingConfigured()) {
      console.error(
        `[kb-embeddings] background embed for doc ${docId} did not complete — doc stays lexical-only until backfill`,
      );
    }
  });
}

/**
 * Idempotent backfill: embed every non-deleted live doc whose embedding is
 * missing OR was generated by a different model. Called at boot (after the
 * legacy→live sync seeds new rows) and safe to re-run any time. Sequential on
 * purpose — the corpus is small and this must never rate-limit-storm.
 */
export async function backfillMissingLiveDocEmbeddings(): Promise<{
  embedded: number;
  failed: number;
  skipped: boolean;
}> {
  if (!isEmbeddingConfigured()) {
    console.warn(
      "[kb-embeddings] backfill skipped: OPENAI_API_KEY not set — retrieval is LEXICAL-ONLY until the key is configured",
    );
    return { embedded: 0, failed: 0, skipped: true };
  }

  // Staleness criteria: missing, model mismatch, or generated BEFORE the row's
  // last content update (catches any mutation path that failed to clear the
  // embedding fields — belt-and-suspenders with CLEARED_EMBEDDING_FIELDS).
  const result = await db.execute(sql`
    SELECT id FROM ai_live_documents
    WHERE deleted_at IS NULL
      AND (embedding IS NULL
        OR embedding_model IS DISTINCT FROM ${EMBEDDING_MODEL}
        OR embedding_generated_at IS NULL
        OR embedding_generated_at < updated_at)
    ORDER BY id`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((result as any).rows ?? result) as Array<{ id: number }>;

  let embedded = 0;
  let failed = 0;
  for (const { id } of rows) {
    const ok = await embedLiveDocument(id);
    if (ok) embedded += 1;
    else failed += 1;
  }
  if (rows.length > 0) {
    console.log(
      `[kb-embeddings] backfill complete: ${embedded} embedded, ${failed} failed (of ${rows.length} missing)`,
    );
  }
  if (failed > 0) {
    console.error(
      `[kb-embeddings] backfill left ${failed} doc(s) without embeddings — they remain lexical-only`,
    );
  }
  return { embedded, failed, skipped: false };
}
