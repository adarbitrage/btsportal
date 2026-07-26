/**
 * Near-miss band calibration suite (Task #2001).
 *
 * Pins the [SEMANTIC_NEAR_MISS_FLOOR, SEMANTIC_CONFIDENCE_FLOOR) chat band
 * against the REAL citable corpus with REAL query embeddings, using labeled
 * query classes from the 47-query calibration sweep that set the 0.40 bound:
 *
 *   IN-SCOPE VAGUE  — conceptual questions the corpus covers but that fail
 *                     the binary 0.50 floor (0.438–0.469 at calibration).
 *                     Each must land IN or ABOVE the band (rescued or
 *                     confident — corpus growth pushing one above the floor
 *                     is fine; falling BELOW the band is a regression).
 *   OUT-OF-SCOPE    — questions the assistant must decline. Each must stay
 *                     BELOW the band (< 0.40), including the near-band
 *                     ceiling case "how do i get a refund from amazon"
 *                     (0.384 at calibration).
 *   EXCLUDED CLASS  — operations-root (refunds/billing/policy) questions can
 *                     NEVER produce a near_miss outcome even when an
 *                     operations doc scores inside the band.
 *
 * Skips LOUDLY without OPENAI_API_KEY or embedded docs (same contract as
 * kb-semantic-calibration.test.ts). Recalibrate whenever EMBEDDING_MODEL
 * changes or the corpus shifts materially — this suite exists so drift
 * breaks tests instead of member experience.
 *
 * Run: npx vitest run src/__tests__/kb-near-miss-calibration.test.ts --pool=threads --no-file-parallelism
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isEmbeddingConfigured } from "../lib/kb-embeddings.js";
import {
  retrieveSurfaceAware,
  SEMANTIC_NEAR_MISS_FLOOR,
  SEMANTIC_CONFIDENCE_FLOOR,
} from "../lib/kb-retrieval";
import { CITABLE_KB_CATEGORIES } from "../lib/kb-taxonomy";

// In-scope vague conceptual phrasings that motivated the band (calibration:
// 0.438–0.469, all with correct top docs). Must be near_miss or confident.
const IN_SCOPE_VAGUE_QUERIES = [
  // The motivating query (0.4547 at calibration).
  "i dont understand angles",
  "i dont get what an angle is supposed to be",
  "confused about headlines",
];

// Out-of-scope — must stay BELOW the band and hard-decline (no_match).
// First entry is the calibrated near-band ceiling (0.384): the negative test
// that near-band out-of-scope stays out.
const OUT_OF_SCOPE_QUERIES = [
  "how do i get a refund from amazon",
  "what is the capital of mongolia",
  "how do i train my dog to sit",
  "best pizza recipe for a home oven",
];

// Policy/refund/pricing questions: whatever the score, the outcome may be
// confident or no_match — NEVER near_miss (operations exclusion).
const EXCLUDED_CLASS_QUERIES = [
  "can i get a refund",
  "how does billing work",
  "how much does the program cost",
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
    console.warn(
      `[kb-near-miss-calibration] SKIPPING — key configured: ${keyConfigured}, ` +
        `embedded docs: ${embeddedDocCount}. The near-miss band ` +
        `[${SEMANTIC_NEAR_MISS_FLOOR}, ${SEMANTIC_CONFIDENCE_FLOOR}) is NOT being ` +
        `empirically verified. Set OPENAI_API_KEY and run the boot backfill.`,
    );
  }
});

function ready(ctx: { skip: () => void }): boolean {
  if (!keyConfigured || embeddedDocCount === 0) {
    ctx.skip();
    return false;
  }
  return true;
}

async function chatRetrieve(q: string) {
  return retrieveSurfaceAware(q, {
    surface: "chat",
    categories: [...CITABLE_KB_CATEGORIES],
    nearMissBand: true,
  });
}

describe("near-miss band calibration (labeled classes)", () => {
  it("in-scope vague queries land in or above the band (rescued or confident)", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of IN_SCOPE_VAGUE_QUERIES) {
      const r = await chatRetrieve(q);
      const ok = r.outcome === "near_miss" || r.outcome === "confident";
      if (!ok) {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome}`);
      }
      console.log(
        `[near-miss/in-scope] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} :: ${q}`,
      );
    }
    expect(
      failures,
      "In-scope vague queries fell BELOW the band (band too high, or corpus/embedding drift):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });

  it("out-of-scope queries (incl. the 0.38 near-band ceiling) stay below the band and hard-decline", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of OUT_OF_SCOPE_QUERIES) {
      const r = await chatRetrieve(q);
      if (r.outcome !== "no_match") {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome}`);
      }
      console.log(
        `[near-miss/out-of-scope] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} :: ${q}`,
      );
    }
    expect(
      failures,
      "Out-of-scope queries entered the band or above (band too low — hedged answers on garbage):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });

  it("excluded doc class (operations root) never produces a near_miss outcome", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of EXCLUDED_CLASS_QUERIES) {
      const r = await chatRetrieve(q);
      if (r.outcome === "near_miss") {
        // A near-miss is only legitimate here if it was carried by a
        // NON-operations doc. Reject any near_miss whose docs are all ops.
        const nonOps = r.docs.some((d) => d.homeRoot !== "operations");
        if (!nonOps) {
          failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=near_miss (ops-only docs)`);
        }
      }
      console.log(
        `[near-miss/excluded] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} :: ${q}`,
      );
    }
    expect(
      failures,
      "Operations-root docs produced a hedged near-miss (high-stakes exclusion broken):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });
});
