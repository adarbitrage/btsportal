import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { seedConceptsKb, buildConceptsDocs } from "../lib/seed-concepts-kb";
import { seedLiveDocsFromCitableLegacyForTest } from "./kb-live-docs-test-seed";
import { retrieveSurfaceAware } from "../lib/kb-retrieval";
import { CITABLE_KB_CATEGORIES } from "../lib/kb-taxonomy";

// End-to-end retrieval guard for the concepts/strategy synonym layer.
//
// kb-concepts-synonyms.test.ts proves the alias MAP works (casual phrasing →
// canonical lexeme). This test proves the whole chain works against a seeded
// corpus: the concepts docs are seeded exactly as the server does on boot,
// mirrored into ai_live_documents, and then realistic casual member questions
// run through the EXACT shared retrieval path the chat route calls — asserting
// the intended curriculum doc surfaces in the returned context.

const CHAT_CATEGORIES = [...CITABLE_KB_CATEGORIES];

const TITLES = {
  angles: "Angles — Finding What Makes People Buy",
  headlines: "Headlines & Copy — Writing What Gets the Click",
  creative: "Creative Strategy — Ads, Images & Landing Pages That Work Together",
  offer: "Offer Strategy — Picking & Promoting the Right Product",
  testing: "Testing Methodology — How BTS Runs Testing Rounds",
  scaling: "Scaling Strategy — Adding Budget Without Breaking the Campaign",
  metrics: "Metrics & Unit Economics — Reading Your Numbers",
  placements: "Traffic & Placements — Where Your Ads Run",
} as const;

// Casual member phrasing → the concepts doc it must surface.
const POSITIVE_CASES: Array<{ query: string; title: string }> = [
  { query: "my ads aren't getting clicks", title: TITLES.headlines },
  { query: "why isn't my ad getting clicks", title: TITLES.headlines },
  { query: "nobody is clicking on my ad", title: TITLES.headlines },
  { query: "how do I know if my test worked", title: TITLES.testing },
  { query: "what happens in a testing round", title: TITLES.testing },
  { query: "which product should I promote", title: TITLES.offer },
  { query: "what's a good product to promote", title: TITLES.offer },
  { query: "what makes people buy from these ads", title: TITLES.angles },
  { query: "when should I increase my budget", title: TITLES.scaling },
  { query: "am I profitable or losing money on this campaign", title: TITLES.metrics },
  { query: "where do my ads appear", title: TITLES.placements },
  { query: "what image should I use for my ad", title: TITLES.creative },
];

describe("concepts retrieval (seeded corpus, shared surface-aware path)", () => {
  beforeAll(async () => {
    // Seed the concepts truth docs exactly as the server does on boot (they
    // land pre-verified with a fixed authored verification date, so they are
    // immediately citable), then copy the citable set into ai_live_documents
    // as a TEST FIXTURE (the production boot mirror was retired, Task #1826) —
    // retrieval reads ai_live_documents.
    await seedConceptsKb();
    await seedLiveDocsFromCitableLegacyForTest();

    // Sanity: every concepts doc reached the live table, otherwise the
    // per-query assertions below fail confusingly.
    const titles = buildConceptsDocs().map((d) => d.title);
    for (const t of titles) {
      const res = await db.execute(
        sql`SELECT 1 FROM ai_live_documents WHERE title = ${t} AND deleted_at IS NULL LIMIT 1`,
      );
      expect(res.rows.length, `concepts doc "${t}" missing from ai_live_documents`).toBe(1);
    }
  });

  for (const { query, title } of POSITIVE_CASES) {
    it(`surfaces "${title}" for casual phrasing: "${query}"`, async () => {
      const result = await retrieveSurfaceAware(query, {
        surface: "chat",
        categories: CHAT_CATEGORIES,
        limit: 6,
      });
      const titles = result.docs.map((d) => d.title);
      expect(
        titles,
        `expected "${title}" for query "${query}"; got: ${JSON.stringify(titles)}`,
      ).toContain(title);
    });
  }

  it("does not surface concepts docs for a password query (negative guard)", async () => {
    const result = await retrieveSurfaceAware("how do I reset my password", {
      surface: "chat",
      categories: CHAT_CATEGORIES,
      limit: 6,
    });
    const conceptTitles = new Set<string>(Object.values(TITLES));
    for (const d of result.docs) {
      expect(conceptTitles.has(d.title), `concepts doc "${d.title}" leaked`).toBe(false);
    }
  });

  it("commissions-payout query gets NO synonym expansion (negative guard)", async () => {
    // NOTE: the Offer Strategy doc legitimately discusses commission rates, so
    // a lexical match on "commissions" is correct behavior and NOT asserted
    // away here. The guard is that the new synonym layer adds nothing: the
    // expansion must stay empty so retrieval for this landmine query remains
    // purely lexical, exactly as before this layer existed.
    const { buildVoiceSynonymTsquery } = await import("../lib/voice-synonyms");
    expect(buildVoiceSynonymTsquery("how do affiliate commissions get paid")).toBe("");
    expect(buildVoiceSynonymTsquery("when is the next live coaching call")).toBe("");
  });
});
