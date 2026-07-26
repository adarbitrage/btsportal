/**
 * Near-miss band unit guards (Task #2001) — no DB, no embeddings.
 *
 * Locks in:
 *   1. The three-state outcome resolver: band boundaries [0.40, 0.50), chat
 *      opt-in gating (non-opted callers can NEVER see "near_miss"), and the
 *      semantic-layer-down degradation (score 0 → band never fires; NO
 *      lexical near-miss rescue exists).
 *   2. The chat route's note wiring: a DISTINCT "close match" note (never the
 *      "no confident match" note) with the hedge/no-ladder/consumed-step and
 *      pointer-tier instructions; the no-match note byte-identical to the
 *      pre-band wording.
 *   3. Voice stays binary end-to-end: the voice route never opts into the
 *      band (source-level guard, same convention as content-gap-capture's
 *      inertness guard).
 *   4. The campaign spine preamble carries the checklist ≠ Blitz-section
 *      namespace guardrail while still permitting step content/order talk.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  resolveRetrievalOutcome,
  SEMANTIC_NEAR_MISS_FLOOR,
  SEMANTIC_CONFIDENCE_FLOOR,
  NEAR_MISS_EXCLUDED_HOME_ROOT,
} from "../lib/kb-retrieval";
import {
  renderCampaignSpine,
  CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL,
} from "@workspace/campaign-roadmap";

describe("band constants", () => {
  it("pins the calibrated band: [0.40, 0.50) below the semantic confidence floor", () => {
    expect(SEMANTIC_NEAR_MISS_FLOOR).toBe(0.4);
    expect(SEMANTIC_CONFIDENCE_FLOOR).toBe(0.5);
    expect(SEMANTIC_NEAR_MISS_FLOOR).toBeLessThan(SEMANTIC_CONFIDENCE_FLOOR);
  });

  it("excludes the operations home root (policy/refunds/billing/pricing)", () => {
    expect(NEAR_MISS_EXCLUDED_HOME_ROOT).toBe("operations");
  });
});

describe("resolveRetrievalOutcome (three-state resolver)", () => {
  it("confident always wins regardless of band opt-in", () => {
    expect(
      resolveRetrievalOutcome({ confident: true, nearMissBand: true, bandEligibleTopSemanticScore: 0.45 }),
    ).toBe("confident");
    expect(
      resolveRetrievalOutcome({ confident: true, nearMissBand: false, bandEligibleTopSemanticScore: 0 }),
    ).toBe("confident");
  });

  it("opted-in caller (chat) gets near_miss inside the band, inclusive lower / exclusive upper", () => {
    for (const s of [0.4, 0.438, 0.4547, 0.469, 0.499]) {
      expect(
        resolveRetrievalOutcome({ confident: false, nearMissBand: true, bandEligibleTopSemanticScore: s }),
        `score ${s}`,
      ).toBe("near_miss");
    }
    // Below the band: hard no-match (e.g. the 0.384 amazon-refund ceiling).
    for (const s of [0, 0.328, 0.384, 0.399]) {
      expect(
        resolveRetrievalOutcome({ confident: false, nearMissBand: true, bandEligibleTopSemanticScore: s }),
        `score ${s}`,
      ).toBe("no_match");
    }
    // At/above the floor without `confident` set: not near_miss (confident is
    // computed upstream from the FULL score; the band is strictly below it).
    expect(
      resolveRetrievalOutcome({ confident: false, nearMissBand: true, bandEligibleTopSemanticScore: 0.5 }),
    ).toBe("no_match");
  });

  it("non-opted-in callers (voice + everyone else) NEVER see near_miss — today's binary preserved", () => {
    for (const s of [0.4, 0.45, 0.499]) {
      expect(
        resolveRetrievalOutcome({ confident: false, nearMissBand: false, bandEligibleTopSemanticScore: s }),
        `score ${s}`,
      ).toBe("no_match");
    }
  });

  it("semantic-layer-down (score 0) degrades to binary — no lexical near-miss rescue", () => {
    expect(
      resolveRetrievalOutcome({ confident: false, nearMissBand: true, bandEligibleTopSemanticScore: 0 }),
    ).toBe("no_match");
  });
});

describe("chat route note wiring (three-state prompt notes)", () => {
  // Import lazily via source read: importing routes/chat.ts drags in the full
  // app dependency graph. The exported note constants are simple template
  // literals — assert on the source of truth directly.
  const chatSource = readFileSync(
    path.join(__dirname, "..", "routes", "chat.ts"),
    "utf8",
  );

  it("keeps the no-match note byte-identical to the pre-band wording", () => {
    expect(chatSource).toContain(
      "No confident match — the knowledge base has no verified answer for this query.",
    );
    expect(chatSource).toContain("Follow Rule 8's Blitz-first ladder");
  });

  it("emits a DISTINCT close-match note for near-miss: usable docs, hedge, no ladder, consumed step", () => {
    expect(chatSource).toContain("Close match — the knowledge base articles above are a close");
    expect(chatSource).toContain("Rule 8's close-match state");
    expect(chatSource).toContain("two-part hedge");
    expect(chatSource).toContain("Do NOT apply Rule 8's escalation ladder");
    expect(chatSource).toContain("counts as a consumed ladder step");
    // Near-miss branch keys off the third state, never off `confident`.
    expect(chatSource).toContain('retrieval.outcome === "near_miss"');
  });

  it("chat is the surface that opts into the band", () => {
    expect(chatSource).toContain("nearMissBand: true");
  });

  it("keeps content-gap capture firing on near-miss, tagged via the separate rescued flag", () => {
    expect(chatSource).toContain("nearMissRescued: true");
  });

  it("near-miss pointer tiers: verified anchors first, hedged fuzzy fallback (no block → no pointer)", () => {
    // The near-miss branch prefers Layer-1 anchored blocks and only falls back
    // to the fuzzy Layer-2 block when no verified anchor exists.
    const nearMissBranch = chatSource.slice(
      chatSource.indexOf('retrieval.outcome === "near_miss"'),
      chatSource.indexOf("NEAR_MISS_NOTE;"),
    );
    expect(nearMissBranch).toContain("buildAnchoredBlitzBlock");
    expect(nearMissBranch).toContain("buildFuzzyBlitzBlock");
  });
});

describe("voice surface stays binary (byte-identical behavior)", () => {
  it("the voice route never opts into the near-miss band", () => {
    const voiceSource = readFileSync(
      path.join(__dirname, "..", "routes", "voice.ts"),
      "utf8",
    );
    expect(voiceSource).not.toContain("nearMissBand");
    expect(voiceSource).not.toContain("near_miss");
  });

  it("no non-chat caller of retrieveSurfaceAware opts into the band", () => {
    const libDir = path.join(__dirname, "..", "lib");
    for (const f of ["kb-retrieval-selftest.ts", "kb-corpus-sweep.ts"]) {
      const src = readFileSync(path.join(libDir, f), "utf8");
      expect(src, f).not.toContain("nearMissBand");
    }
  });
});

describe("campaign spine namespace guardrail (checklist ≠ Blitz sections)", () => {
  it("the rendered spine carries the guardrail preamble line", () => {
    expect(renderCampaignSpine()).toContain(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL);
  });

  it("the guardrail forbids presenting step titles as sections/pages/locations", () => {
    expect(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL).toContain("chronology markers ONLY");
    expect(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL).toContain("not Blitz guide sections");
    expect(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL).toContain("not navigable locations");
    expect(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL).toContain("Blitz Guide Locations blocks");
  });

  it("still permits discussing step content and ordering (checklist questions keep working)", () => {
    expect(CAMPAIGN_SPINE_NAMESPACE_GUARDRAIL).toContain(
      "Discussing what a step involves and where it falls in the order is always fine",
    );
    // The spine still renders the step titles themselves for content questions.
    const spine = renderCampaignSpine();
    expect(spine).toContain("Finalize your angles");
  });
});
