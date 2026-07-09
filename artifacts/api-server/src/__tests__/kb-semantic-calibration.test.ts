/**
 * Semantic confidence-floor calibration suite (Task #1803).
 *
 * Two-group empirical check of SEMANTIC_CONFIDENCE_FLOOR against the REAL
 * citable corpus with REAL query embeddings:
 *
 *   IN-SCOPE  — casually phrased member questions the corpus DOES cover.
 *               Each must clear the floor (semantic layer rescues phrasings
 *               the lexical AND-of-terms query misses).
 *   OUT-OF-SCOPE — questions the corpus does NOT cover. Each must stay BELOW
 *               the floor (a semantic-only hit below it must never flip
 *               `confident` — decline-rather-than-guess).
 *
 * Requirements to run meaningfully (otherwise the suite SKIPS LOUDLY):
 *   - OPENAI_API_KEY set (real query embeddings);
 *   - live docs actually embedded (boot backfill has run).
 *
 * Recalibrate (re-run + adjust the floor) whenever EMBEDDING_MODEL changes or
 * the citable corpus shifts materially.
 *
 * Run: npx vitest run src/__tests__/kb-semantic-calibration.test.ts --pool=threads --no-file-parallelism
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isEmbeddingConfigured } from "../lib/kb-embeddings.js";
import { retrieveSurfaceAware, SEMANTIC_CONFIDENCE_FLOOR } from "../lib/kb-retrieval";
import { CITABLE_KB_CATEGORIES } from "../lib/kb-taxonomy";

// Casual phrasings of topics the citable corpus covers (affiliate marketing
// training: Blitz, angles/hooks, tools, testing, campaigns).
const IN_SCOPE_QUERIES = [
  "how do i come up with a good angle for my ads",
  "what should i do after finishing the blitz training",
  "my campaign isn't converting, what do i test first",
  "how do i pick an offer to promote",
  "whats the deal with writing headlines that actually work",
];

// Clearly outside the corpus: the assistant must decline, not guess.
const OUT_OF_SCOPE_QUERIES = [
  "what is the capital of mongolia",
  "how do i bake sourdough bread at home",
  "can you help me fix my car's transmission",
  "what are the rules of cricket",
  "recommend a good science fiction novel",
];

let embeddedDocCount = 0;
let keyConfigured = false;

beforeAll(async () => {
  keyConfigured = isEmbeddingConfigured();
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM ai_live_documents
    WHERE embedding IS NOT NULL AND deleted_at IS NULL`);
  embeddedDocCount = Number((res.rows[0] as { cnt: number }).cnt);

  if (!keyConfigured || embeddedDocCount === 0) {
    // LOUD skip: the calibration contract cannot be verified in this env.
    console.warn(
      `[kb-semantic-calibration] SKIPPING — key configured: ${keyConfigured}, ` +
        `embedded docs: ${embeddedDocCount}. The SEMANTIC_CONFIDENCE_FLOOR ` +
        `(${SEMANTIC_CONFIDENCE_FLOOR}) is NOT being empirically verified. ` +
        `Set OPENAI_API_KEY and run the boot backfill, then re-run this suite.`,
    );
  }
});

describe("semantic confidence floor calibration (two-group)", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)("has embedded docs to calibrate against", () => {
    expect(embeddedDocCount).toBeGreaterThan(0);
  });

  it("in-scope casual phrasings clear the floor", { timeout: 120_000 }, async (ctx) => {
    if (!keyConfigured || embeddedDocCount === 0) return ctx.skip();
    const failures: string[] = [];
    for (const q of IN_SCOPE_QUERIES) {
      const r = await retrieveSurfaceAware(q, {
        surface: "chat",
        categories: [...CITABLE_KB_CATEGORIES],
      });
      if (r.topSemanticScore < SEMANTIC_CONFIDENCE_FLOOR) {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} (< ${SEMANTIC_CONFIDENCE_FLOOR})`);
      }
      console.log(
        `[calibration/in-scope] sem=${r.topSemanticScore.toFixed(4)} lex=${r.topScore.toFixed(4)} confident=${r.confident} :: ${q}`,
      );
    }
    expect(
      failures,
      "In-scope questions BELOW the semantic floor (floor too high, or corpus/embeddings missing):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });

  it("out-of-scope questions stay below the floor (never confident on semantics alone)", { timeout: 120_000 }, async (ctx) => {
    if (!keyConfigured || embeddedDocCount === 0) return ctx.skip();
    const failures: string[] = [];
    for (const q of OUT_OF_SCOPE_QUERIES) {
      const r = await retrieveSurfaceAware(q, {
        surface: "chat",
        categories: [...CITABLE_KB_CATEGORIES],
      });
      if (r.topSemanticScore >= SEMANTIC_CONFIDENCE_FLOOR) {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} (>= ${SEMANTIC_CONFIDENCE_FLOOR})`);
      }
      console.log(
        `[calibration/out-of-scope] sem=${r.topSemanticScore.toFixed(4)} lex=${r.topScore.toFixed(4)} confident=${r.confident} :: ${q}`,
      );
    }
    expect(
      failures,
      "Out-of-scope questions AT/ABOVE the semantic floor (floor too low — assistant could answer confidently on garbage):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });
});
