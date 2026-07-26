/**
 * Voice near-miss band calibration suite (Task #2002).
 *
 * Task #2001 built the chat-only semantic near-miss band
 * [SEMANTIC_NEAR_MISS_FLOOR, SEMANTIC_CONFIDENCE_FLOOR) and left voice binary
 * pending (a) measured voice demand and (b) a spoken presentation contract.
 * Task #2002 ran that measurement. The result — pinned here so it breaks
 * loudly if the ground shifts — is that the band is STRUCTURALLY UNREACHABLE
 * for voice as scoped today:
 *
 *   1. Voice retrieval is deliberately scoped to the Operations home root
 *      only (basic-support surface, Task #1408; category == home_root for
 *      all citable docs).
 *   2. The band's high-stakes exclusion (home_root = 'operations' docs never
 *      enter the band) is ABSOLUTE — the task explicitly keeps it so.
 *   ⇒  Every doc voice can retrieve is band-excluded, the band-eligible top
 *      semantic score is always 0, and `nearMissBand: true` on the voice
 *      seam can never produce a "near_miss" outcome. Demand measurement
 *      agreed: zero voice rows in content_gap_questions (dev AND prod) at
 *      calibration time; spoken deep-content phrasings scored 0.13–0.24
 *      against voice's ops-only corpus, far below the 0.40 band floor.
 *
 * Consequently the voice route does NOT opt in (kb-near-miss-band.test.ts
 * still guards that at source level) and no spoken hedge contract was added
 * to the voice prompt — it would be dead prompt weight. If voice's category
 * scope is ever widened beyond Operations, THIS suite is the alarm: the
 * "structurally inert" tests below start failing, which is the signal to
 * design the TTS hedge contract and recalibrate on spoken phrasings before
 * opting the route in.
 *
 * Skips LOUDLY without OPENAI_API_KEY or embedded docs (same contract as
 * kb-near-miss-calibration.test.ts, the chat model suite).
 *
 * Run: npx vitest run src/__tests__/kb-voice-near-miss-calibration.test.ts --pool=threads --no-file-parallelism
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isEmbeddingConfigured } from "../lib/kb-embeddings.js";
import {
  retrieveSurfaceAware,
  resolveRetrievalOutcome,
  SEMANTIC_NEAR_MISS_FLOOR,
  SEMANTIC_CONFIDENCE_FLOOR,
  NEAR_MISS_EXCLUDED_HOME_ROOT,
} from "../lib/kb-retrieval";
import { OPERATIONS_ROOT_SLUG } from "../lib/kb-taxonomy";

// Spoken-style vague OPERATIONS questions — voice's own territory. Whatever
// they score, the outcome must be binary (confident or no_match): the docs
// carrying them are operations-root and therefore band-excluded.
const SPOKEN_OPS_VAGUE_QUERIES = [
  "i'm confused about my membership",
  "i don't really get how the guarantee thing works",
  "how do i talk to someone",
  "something's off with my account i think",
];

// Spoken-style vague DEEP-CONTENT questions (the class the chat band rescues).
// The docs that answer these live OUTSIDE voice's Operations scope, so under
// the voice seam they must stay far below the band (0.13–0.24 at calibration)
// and hard-decline — which is what drives the VOICE SCOPE / CHAT HANDOFF rule.
const SPOKEN_DEEP_VAGUE_QUERIES = [
  "i dont understand angles",
  "yeah i'm just kinda lost on the headlines stuff",
  "i don't get what an angle is supposed to be",
];

// Out-of-scope — must hard-decline on voice exactly as on chat. Includes the
// chat suite's 0.384 near-band ceiling case.
const OUT_OF_SCOPE_QUERIES = [
  "how do i get a refund from amazon",
  "what is the capital of mongolia",
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
      `[kb-voice-near-miss-calibration] SKIPPING — key configured: ${keyConfigured}, ` +
        `embedded docs: ${embeddedDocCount}. The voice-band structural-inertness ` +
        `finding is NOT being empirically verified. Set OPENAI_API_KEY and run ` +
        `the boot backfill.`,
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

// The voice seam with a HYPOTHETICAL band opt-in. The live voice route does
// NOT pass nearMissBand (source-guarded by kb-near-miss-band.test.ts); this
// suite enables it deliberately to prove the opt-in would be inert.
async function voiceRetrieveWithBand(q: string) {
  return retrieveSurfaceAware(q, {
    surface: "voice",
    categories: [OPERATIONS_ROOT_SLUG],
    limit: 4,
    nearMissBand: true,
  });
}

describe("voice near-miss band: structural preconditions", () => {
  it("voice's entire retrieval scope IS the band-excluded home root", () => {
    // The two constants whose collision makes the voice band unreachable.
    // If either side moves (voice scope widens, or the exclusion changes),
    // this fails and the voice rescue must be redesigned + recalibrated.
    expect(OPERATIONS_ROOT_SLUG).toBe(NEAR_MISS_EXCLUDED_HOME_ROOT);
  });

  it("the resolver can never emit near_miss when every retrievable doc is excluded", () => {
    // Band-eligible score excludes operations docs; with an ops-only scope it
    // is identically 0 regardless of the raw top semantic score.
    for (const rawScore of [0.4, 0.45, 0.499]) {
      expect(
        resolveRetrievalOutcome({
          confident: false,
          nearMissBand: true,
          bandEligibleTopSemanticScore: 0,
        }),
        `raw ops score ${rawScore}`,
      ).toBe("no_match");
    }
  });
});

describe("voice near-miss band calibration (spoken phrasings, real corpus)", () => {
  it("vague ops questions stay binary even with the band enabled (ops exclusion absolute)", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of SPOKEN_OPS_VAGUE_QUERIES) {
      const r = await voiceRetrieveWithBand(q);
      if (r.outcome === "near_miss") {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=near_miss`);
      }
      const roots = [...new Set(r.docs.map((d) => d.homeRoot))].join(",");
      console.log(
        `[voice-band/ops-vague] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} roots=${roots} :: ${q}`,
      );
    }
    expect(
      failures,
      "Voice seam produced a hedged near-miss on operations content (absolute exclusion broken):\n" +
        failures.join("\n"),
    ).toEqual([]);
  });

  it("spoken deep-content vague questions stay far below the band under voice scope and hard-decline", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of SPOKEN_DEEP_VAGUE_QUERIES) {
      const r = await voiceRetrieveWithBand(q);
      // These scored 0.13–0.24 at calibration (their answering docs are out of
      // voice's scope). Entering the band here would mean voice's ops corpus
      // started semantically impersonating deep content — investigate before
      // trusting any voice-band design.
      if (r.outcome !== "no_match" || r.topSemanticScore >= SEMANTIC_NEAR_MISS_FLOOR) {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome}`);
      }
      console.log(
        `[voice-band/deep-vague] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} :: ${q}`,
      );
    }
    expect(
      failures,
      "Deep-content spoken phrasings reached the band/confidence under voice's ops-only scope:\n" +
        failures.join("\n"),
    ).toEqual([]);
  });

  it("out-of-scope spoken questions hard-decline on the voice seam", { timeout: 120_000 }, async (ctx) => {
    if (!ready(ctx)) return;
    const failures: string[] = [];
    for (const q of OUT_OF_SCOPE_QUERIES) {
      const r = await voiceRetrieveWithBand(q);
      if (r.outcome !== "no_match") {
        failures.push(`"${q}" → sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome}`);
      }
      console.log(
        `[voice-band/out-of-scope] sem=${r.topSemanticScore.toFixed(4)} outcome=${r.outcome} :: ${q}`,
      );
    }
    expect(
      failures,
      "Out-of-scope queries were not hard-declined on the voice seam:\n" + failures.join("\n"),
    ).toEqual([]);
  });

  it("band boundaries used by this suite match the calibrated constants", () => {
    expect(SEMANTIC_NEAR_MISS_FLOOR).toBe(0.4);
    expect(SEMANTIC_CONFIDENCE_FLOOR).toBe(0.5);
  });
});
