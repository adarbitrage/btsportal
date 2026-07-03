import { describe, it, expect } from "vitest";
import {
  normalizeBtsHouseTerms,
  loadBtsHouseTerms,
  buildBtsHouseTermGuidance,
  BTS_TERM_ALIASES,
} from "../lib/transcript-cleaner";

describe("loadBtsHouseTerms (closed BTS-owned set from the glossary)", () => {
  it("derives the proprietary tool set from the glossary notes", () => {
    const terms = loadBtsHouseTerms().map((t) => t.toLowerCase());
    for (const expected of [
      "diytrax",
      "metricmover",
      "flexy",
      "pixelpress",
      "noescape",
      "cropbot",
      "scrapebot",
      "gifster",
      "mediamavens",
    ]) {
      expect(terms).toContain(expected);
    }
  });

  it("does NOT include member/traffic terms (only house-owned ones)", () => {
    const terms = loadBtsHouseTerms().map((t) => t.toLowerCase());
    // Caterpillar is a third-party traffic source, not a BTS house term.
    expect(terms).not.toContain("caterpillar");
    expect(terms).not.toContain("taboola");
  });
});

describe("normalizeBtsHouseTerms — alias map (deterministic, self-healing)", () => {
  it("corrects the observed Flexy misspellings", () => {
    expect(normalizeBtsHouseTerms("We built it in Flexi today.")).toBe(
      "We built it in Flexy today.",
    );
    expect(normalizeBtsHouseTerms("Open Flexie and Flexxy.")).toBe("Open Flexy and Flexy.");
  });

  it("corrects Catapiller -> Caterpillar (a known traffic source)", () => {
    expect(normalizeBtsHouseTerms("I ran Catapiller traffic.")).toBe("I ran Caterpillar traffic.");
  });

  it("is case-insensitive on alias keys but writes the canonical casing", () => {
    expect(normalizeBtsHouseTerms("flexi FLEXI FlExI")).toBe("Flexy Flexy Flexy");
  });

  it("corrects spaced/garbled camelCase tool forms", () => {
    expect(normalizeBtsHouseTerms("Use DIY trax with Metric Mover.")).toBe(
      "Use DIYTrax with MetricMover.",
    );
    expect(normalizeBtsHouseTerms("Media Mavens has new offers.")).toBe(
      "MediaMavens has new offers.",
    );
  });

  it("only matches whole words — never inside a larger word", () => {
    // "flexi" lives inside "reflexive"; the alias must NOT fire.
    expect(normalizeBtsHouseTerms("a reflexive response")).toBe("a reflexive response");
  });
});

describe("normalizeBtsHouseTerms — near-miss single tokens (closed set only)", () => {
  it("corrects a novel same-length substitution variant", () => {
    expect(normalizeBtsHouseTerms("Check DIYTrex stats.")).toBe("Check DIYTrax stats.");
  });

  it("corrects a one-char indel on a long coined term", () => {
    expect(normalizeBtsHouseTerms("Open PixelPres now.")).toBe("Open PixelPress now.");
  });

  it("normalises the CASE of an exact house-term match", () => {
    expect(normalizeBtsHouseTerms("we used cropbot and scrapebot")).toBe(
      "we used CropBot and ScrapeBot",
    );
  });
});

describe("normalizeBtsHouseTerms — guards against clobbering member/ordinary words", () => {
  it("leaves a member's own niche brand untouched", () => {
    expect(normalizeBtsHouseTerms("My offer is Barkchester.")).toBe("My offer is Barkchester.");
  });

  it("never turns a shorter ordinary word into a house term (no pure-deletion match)", () => {
    // "flex" is one deletion from "Flexy" but must NOT be coerced.
    expect(normalizeBtsHouseTerms("I need to flex my budget.")).toBe("I need to flex my budget.");
  });

  it("does not fire on the ordinary phrase 'no escape' (excluded from aliases)", () => {
    expect(normalizeBtsHouseTerms("There was no escape from the funnel.")).toBe(
      "There was no escape from the funnel.",
    );
  });

  it("leaves an unrelated word that shares no first letter / distance", () => {
    expect(normalizeBtsHouseTerms("The gangster ran ads.")).toBe("The gangster ran ads.");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = normalizeBtsHouseTerms("Flexi + DIY trax + Catapiller");
    expect(normalizeBtsHouseTerms(once)).toBe(once);
    expect(once).toBe("Flexy + DIYTrax + Caterpillar");
  });

  it("returns empty/blank input unchanged", () => {
    expect(normalizeBtsHouseTerms("")).toBe("");
  });
});

describe("BTS house-term guidance + alias map integrity", () => {
  it("guidance lists the house terms and the seed correction examples", () => {
    const guidance = buildBtsHouseTermGuidance();
    expect(guidance).toMatch(/Flexy/);
    expect(guidance).toMatch(/DIYTrax/);
    expect(guidance).toMatch(/Flexi/);
    expect(guidance).toMatch(/Catapiller/);
  });

  it("seeds the required observed misspellings", () => {
    expect(BTS_TERM_ALIASES["flexi"]).toBe("Flexy");
    expect(BTS_TERM_ALIASES["flexie"]).toBe("Flexy");
    expect(BTS_TERM_ALIASES["flexxy"]).toBe("Flexy");
    expect(BTS_TERM_ALIASES["catapiller"]).toBe("Caterpillar");
  });
});
