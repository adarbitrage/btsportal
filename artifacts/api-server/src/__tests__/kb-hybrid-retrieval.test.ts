/**
 * Hybrid semantic retrieval regression tests (Task #1803).
 *
 * DB-backed: inserts throwaway ai_live_documents rows with CONTROLLED pgvector
 * embeddings (unit basis vectors) so cosine similarity is exact by
 * construction, and mocks ONLY the query-embedding call (embedQuery) — the
 * semantic SQL path, hybrid merge, and confidence gate all run for real.
 *
 * Contracts locked here:
 *   1. embedQuery → null ⇒ behaviour is identical to pre-hybrid lexical-only
 *      retrieval (topSemanticScore 0, lexical confidence unchanged).
 *   2. A high-similarity semantic match surfaces a doc lexical search misses
 *      and clears the calibrated floor ⇒ confident.
 *   3. A semantic-only match BELOW the floor is NEVER confident
 *      (decline-rather-than-guess preserved).
 *
 * Run: npx vitest run src/__tests__/kb-hybrid-retrieval.test.ts --pool=threads --no-file-parallelism
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

vi.mock("../lib/kb-embeddings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/kb-embeddings.js")>();
  return { ...actual, embedQuery: vi.fn(async () => null) };
});

import { embedQuery, EMBEDDING_MODEL } from "../lib/kb-embeddings.js";
import {
  retrieveSurfaceAware,
  SEMANTIC_CONFIDENCE_FLOOR,
  CONFIDENCE_FLOOR,
} from "../lib/kb-retrieval";

const mockEmbedQuery = vi.mocked(embedQuery);

const DIM = 1536;
/** Unit basis vector along the given axis, as a pgvector literal. */
function basisVector(axis: number): string {
  const v = new Array<number>(DIM).fill(0);
  v[axis] = 1;
  return "[" + v.join(",") + "]";
}
function basisArray(axis: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[axis] = 1;
  return v;
}

// Deliberately gibberish so NO real query ever lexically matches these rows.
const SEM_TITLE = "zzqx hybrid-test semantic-only doc (Task #1803 test fixture)";
const LEX_TITLE = "zzqx hybrid-test lexical doc wumbelfrag (Task #1803 test fixture)";
const CATEGORY = "operations";

let semDocId = 0;
let lexDocId = 0;

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM ai_live_documents WHERE title IN (${SEM_TITLE}, ${LEX_TITLE})`,
  );
  // Semantic-only doc: gibberish text, embedding = e1.
  const sem = await db.execute(sql`
    INSERT INTO ai_live_documents
      (title, category, content, audience, doc_class, home_root, last_verified,
       embedding, embedding_model, embedding_generated_at)
    VALUES
      (${SEM_TITLE}, ${CATEGORY}, 'qqfluxx morblet zanthar content', 'member',
       'curated', ${CATEGORY}, NOW(), ${basisVector(0)}::vector, ${EMBEDDING_MODEL}, NOW())
    RETURNING id`);
  semDocId = Number((sem.rows[0] as { id: number }).id);

  // Lexically matchable doc (unique token "wumbelfrag"), NO embedding.
  const lex = await db.execute(sql`
    INSERT INTO ai_live_documents
      (title, category, content, audience, doc_class, home_root, last_verified)
    VALUES
      (${LEX_TITLE}, ${CATEGORY}, 'wumbelfrag is the unique lexical token here', 'member',
       'curated', ${CATEGORY}, NOW())
    RETURNING id`);
  lexDocId = Number((lex.rows[0] as { id: number }).id);
});

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM ai_live_documents WHERE title IN (${SEM_TITLE}, ${LEX_TITLE})`,
  );
});

describe("hybrid retrieval — lexical-only degradation (embedQuery null)", () => {
  it("behaves exactly like pre-hybrid lexical retrieval when no embedding is available", async () => {
    mockEmbedQuery.mockResolvedValue(null);
    const result = await retrieveSurfaceAware("wumbelfrag", {
      surface: "chat",
      categories: [CATEGORY],
    });
    expect(result.topSemanticScore).toBe(0);
    expect(result.docs.some((d) => d.id === lexDocId)).toBe(true);
    expect(result.topScore).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
    expect(result.confident).toBe(true);
    // The semantic-only doc must NOT appear — its text shares nothing lexically.
    expect(result.docs.some((d) => d.id === semDocId)).toBe(false);
  });

  it("stays not-confident on a total miss when semantic is unavailable", async () => {
    mockEmbedQuery.mockResolvedValue(null);
    const result = await retrieveSurfaceAware("gribblewock snarfle vantibule", {
      surface: "chat",
      categories: [CATEGORY],
    });
    expect(result.confident).toBe(false);
    expect(result.topSemanticScore).toBe(0);
  });
});

describe("hybrid retrieval — semantic layer active", () => {
  it("surfaces a lexically-invisible doc via a high-similarity embedding and is confident", async () => {
    // Query embedding identical to the doc embedding → cosine similarity 1.0.
    mockEmbedQuery.mockResolvedValue(basisArray(0));
    const result = await retrieveSurfaceAware("gribblewock snarfle vantibule", {
      surface: "chat",
      categories: [CATEGORY],
    });
    expect(result.topSemanticScore).toBeGreaterThan(0.99);
    expect(result.topSemanticScore).toBeGreaterThanOrEqual(SEMANTIC_CONFIDENCE_FLOOR);
    expect(result.confident).toBe(true);
    const semDoc = result.docs.find((d) => d.id === semDocId);
    expect(semDoc).toBeDefined();
    expect(semDoc!.semanticScore).toBeGreaterThan(0.99);
  });

  it("NEVER reports confident when the only semantic signal is below the floor", async () => {
    // Query embedding orthogonal to the doc embedding → cosine similarity 0.
    mockEmbedQuery.mockResolvedValue(basisArray(1));
    const result = await retrieveSurfaceAware("gribblewock snarfle vantibule", {
      surface: "chat",
      categories: [CATEGORY],
    });
    expect(result.topSemanticScore).toBeLessThan(SEMANTIC_CONFIDENCE_FLOOR);
    expect(result.confident).toBe(false);
  });

  it("ignores a STALE embedding after an edit + failed re-embed (degrades to lexical-only)", async () => {
    // Simulate: doc content edited (updated_at bumped) but the background
    // re-embed FAILED, leaving the old vector attached with an older
    // embedding_generated_at. The freshness guard must exclude it entirely.
    await db.execute(sql`
      UPDATE ai_live_documents
      SET content = 'qqfluxx morblet zanthar content EDITED',
          updated_at = NOW(),
          embedding_generated_at = NOW() - INTERVAL '1 hour'
      WHERE id = ${semDocId}`);
    try {
      mockEmbedQuery.mockResolvedValue(basisArray(0)); // would be sim ≈ 1.0 if not guarded
      const result = await retrieveSurfaceAware("gribblewock snarfle vantibule", {
        surface: "chat",
        categories: [CATEGORY],
      });
      expect(result.topSemanticScore).toBe(0);
      expect(result.confident).toBe(false);
      expect(result.docs.some((d) => d.id === semDocId)).toBe(false);
    } finally {
      await db.execute(sql`
        UPDATE ai_live_documents
        SET content = 'qqfluxx morblet zanthar content',
            embedding_generated_at = NOW()
        WHERE id = ${semDocId}`);
    }
  });

  it("treats an atomically-cleared embedding as lexical-only (edit path contract)", async () => {
    // Simulate the CLEARED_EMBEDDING_FIELDS write that every content mutation
    // performs: vector nulled in the same update as the edit.
    await db.execute(sql`
      UPDATE ai_live_documents
      SET embedding = NULL, embedding_model = NULL, embedding_generated_at = NULL
      WHERE id = ${semDocId}`);
    try {
      mockEmbedQuery.mockResolvedValue(basisArray(0));
      const result = await retrieveSurfaceAware("gribblewock snarfle vantibule", {
        surface: "chat",
        categories: [CATEGORY],
      });
      expect(result.topSemanticScore).toBe(0);
      expect(result.confident).toBe(false);
    } finally {
      await db.execute(sql`
        UPDATE ai_live_documents
        SET embedding = ${basisVector(0)}::vector,
            embedding_model = ${EMBEDDING_MODEL},
            embedding_generated_at = NOW()
        WHERE id = ${semDocId}`);
    }
  });

  it("keeps lexical confidence and merges semantic candidates into the doc list", async () => {
    mockEmbedQuery.mockResolvedValue(basisArray(0));
    const result = await retrieveSurfaceAware("wumbelfrag", {
      surface: "chat",
      categories: [CATEGORY],
    });
    // Lexical hit intact…
    expect(result.docs.some((d) => d.id === lexDocId)).toBe(true);
    expect(result.confident).toBe(true);
    // …and the semantic candidate joined the pool.
    expect(result.docs.some((d) => d.id === semDocId)).toBe(true);
  });
});
