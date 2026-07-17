/**
 * Task #1752 — review-gate risk analysis (kb-review-risk) + the review-gate
 * flags added to computeRiskFlags. Pure — no DB.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeDraftForReview,
  hasSourceConflictMarker,
  hasSynthesisRiskTags,
  hasTimeSensitivePhrasing,
  hasPrivacyResidue,
  isPrivacyProtectedPair,
  SEED_TERMINOLOGY_PHRASES,
  SOURCE_CONFLICT_PREFIX,
  BASELINE_CONFLICT_PREFIX,
  COACHING_DRIFT_PREFIX,
  hasBaselineConflictMarker,
  hasCoachingDriftMarker,
  type NameFlagVocab,
} from "../lib/kb-review-risk";
import {
  SOURCE_CONFLICT_MARKER,
  BASELINE_CONFLICT_MARKER,
  COACHING_DRIFT_MARKER,
} from "../lib/kb-synthesis";
import { computeRiskFlags, blocksBulkConfirm } from "../lib/kb-flags";

describe("SOURCE_CONFLICT_PREFIX drift guard", () => {
  it("the real synthesis marker contains the local prefix mirror", () => {
    expect(SOURCE_CONFLICT_MARKER).toContain(SOURCE_CONFLICT_PREFIX);
  });
});

describe("baseline marker drift guards", () => {
  it("the real synthesis markers contain the local prefix mirrors", () => {
    expect(BASELINE_CONFLICT_MARKER).toContain(BASELINE_CONFLICT_PREFIX);
    expect(COACHING_DRIFT_MARKER).toContain(COACHING_DRIFT_PREFIX);
  });

  it("analyzeDraftForReview flags baseline conflicts as critical and coaching drift as medium", () => {
    const content = [
      "Intro",
      `${BASELINE_CONFLICT_MARKER} curriculum now says X, published doc says Y`,
      `${COACHING_DRIFT_MARKER} several recent calls teach Z instead`,
    ].join("\n");
    const hs = analyzeDraftForReview(content);
    const bc = hs.find((h) => h.kind === "baseline_conflict");
    const cd = hs.find((h) => h.kind === "coaching_drift");
    expect(bc?.severity).toBe("critical");
    expect(cd?.severity).toBe("medium");
  });

  it("summary detectors match, and baseline_conflict blocks bulk-confirm while coaching_drift does not", () => {
    const bcContent = `${BASELINE_CONFLICT_MARKER} disagreement`;
    const cdContent = `${COACHING_DRIFT_MARKER} drift`;
    expect(hasBaselineConflictMarker(bcContent)).toBe(true);
    expect(hasCoachingDriftMarker(cdContent)).toBe(true);

    const base = { title: "T", authorityRole: "curriculum", sourceType: null, corroborationCount: 3 };
    const bcFlags = computeRiskFlags({ ...base, content: bcContent });
    expect(bcFlags.some((f) => f.type === "baseline_conflict" && f.severity === "critical")).toBe(true);
    expect(blocksBulkConfirm(bcFlags)).toBe(true);

    const cdFlags = computeRiskFlags({ ...base, content: cdContent });
    expect(cdFlags.some((f) => f.type === "coaching_drift" && f.severity === "medium")).toBe(true);
    expect(blocksBulkConfirm(cdFlags)).toBe(false);
  });
});

describe("analyzeDraftForReview", () => {
  it("flags SOURCE CONFLICT blockquotes as critical", () => {
    const hs = analyzeDraftForReview(
      `Intro line\n> ⚠️ SOURCE CONFLICT (for reviewer): coach A says X, coach B says Y\nOutro`,
    );
    const conflict = hs.filter((h) => h.kind === "source_conflict");
    expect(conflict).toHaveLength(1);
    expect(conflict[0].severity).toBe("critical");
    expect(conflict[0].line).toBe(1);
  });

  it("flags synthesis bullet tags with the right kinds", () => {
    const content = [
      "- [SITUATIONAL] in one member's case, spending $40/day worked",
      "- [CONTEXT-BOUND] the coach clicked through the dashboard",
      "- [ANOMALY] this segment may be incomplete",
    ].join("\n");
    const hs = analyzeDraftForReview(content);
    expect(hs.some((h) => h.kind === "synthesis_situational" && h.severity === "high")).toBe(true);
    expect(hs.some((h) => h.kind === "synthesis_context_bound")).toBe(true);
    expect(hs.some((h) => h.kind === "synthesis_anomaly")).toBe(true);
    // The tagged line's $40/day is NOT double-flagged as situational_number.
    expect(hs.some((h) => h.kind === "situational_number")).toBe(false);
  });

  it("partial-form tags produce an excerpt that exactly matches the line text", () => {
    const line = "- [SITUATIONAL NUMBER: $40/day] worked for one member";
    const hs = analyzeDraftForReview(line);
    const h = hs.find((x) => x.kind === "synthesis_situational");
    expect(h).toBeDefined();
    expect(line.includes(h!.excerpt)).toBe(true);
    expect(h!.excerpt).toBe("[SITUATIONAL NUMBER: $40/day]");
  });

  it("flags untagged dollar figures, rates and percents", () => {
    const hs = analyzeDraftForReview("Aim to spend $50/day and expect a 3% conversion rate.");
    const kinds = hs.filter((h) => h.kind === "situational_number").map((h) => h.excerpt);
    expect(kinds.some((e) => e.includes("$50"))).toBe(true);
    expect(kinds.some((e) => e.includes("3%") || e.includes("3 %"))).toBe(true);
  });

  it("flags time-sensitive phrasing including month-year dates", () => {
    const hs = analyzeDraftForReview(
      "Right now the platform requires manual approval. As of January 2025 this changed.",
    );
    const ts = hs.filter((h) => h.kind === "time_sensitive");
    expect(ts.length).toBeGreaterThanOrEqual(2);
    expect(ts.some((h) => /January 2025/.test(h.excerpt))).toBe(true);
  });

  it("flags residual private content (coach full name, email, phone)", () => {
    const hs = analyzeDraftForReview(
      "Ask Bruce Clark or email coach@example.com or call 555-123-4567.",
    );
    const priv = hs.filter((h) => h.kind === "privacy_residue");
    expect(priv.some((h) => h.excerpt.includes("Bruce Clark") || h.excerpt.includes("Clark"))).toBe(true);
    expect(priv.some((h) => h.excerpt.includes("coach@example.com"))).toBe(true);
    expect(priv.some((h) => /555/.test(h.excerpt))).toBe(true);
  });

  it("advisory member-name heuristic fires on unknown First Last, not stopword pairs", () => {
    const hs = analyzeDraftForReview(
      "One member, Marcus Delgado, scaled fast. Use Google Ads and Landing Pages wisely.",
    );
    const names = hs.filter((h) => h.kind === "possible_member_name");
    expect(names.some((h) => h.excerpt === "Marcus Delgado")).toBe(true);
    expect(names.some((h) => h.excerpt.includes("Google"))).toBe(false);
    expect(names.some((h) => h.excerpt.includes("Landing"))).toBe(false);
  });

  it("does not flag portal nav labels or UI vocabulary as member names", () => {
    const hs = analyzeDraftForReview(
      [
        "Go to Live Coaching to see the schedule.",
        "Your Coaching Access level controls what you see.",
        "Check Getting Help if you are stuck.",
        "Open the Voice Assistant from Tools & Apps.",
      ].join("\n"),
    );
    expect(hs.filter((h) => h.kind === "possible_member_name")).toHaveLength(0);
  });

  it("still flags a real First Last name amid nav vocabulary", () => {
    const hs = analyzeDraftForReview(
      "Marcus Delgado asked about Live Coaching and Getting Help.",
    );
    const names = hs.filter((h) => h.kind === "possible_member_name");
    expect(names.map((h) => h.excerpt)).toEqual(["Marcus Delgado"]);
  });

  it("does not flag gerund-first pairs as member names", () => {
    const hs = analyzeDraftForReview("Start Scaling Winners once tracking is stable.");
    expect(hs.some((h) => h.kind === "possible_member_name")).toBe(false);
  });

  it("still flags names with -ing surnames (King, Sterling)", () => {
    const hs = analyzeDraftForReview("Marcus King and Ava Sterling both scaled fast.");
    const names = hs.filter((h) => h.kind === "possible_member_name").map((h) => h.excerpt);
    expect(names).toContain("Marcus King");
    expect(names).toContain("Ava Sterling");
  });

  it("does not flag audited terminology pairs as member names", () => {
    const hs = analyzeDraftForReview(
      [
        "Review your Unit Economics before scaling.",
        "Upload to Creative Drive and reuse your Copy Blocks.",
        "Set the Custom Values in your Cloned Flexy site.",
        "Refine your Creative Strategy after Site Setup.",
        "Backyard Discovery and Consumer Watchdog are ad-copy fragments.",
      ].join("\n"),
    );
    expect(hs.filter((h) => h.kind === "possible_member_name")).toHaveLength(0);
  });

  it("still flags a real name amid terminology vocabulary", () => {
    const hs = analyzeDraftForReview(
      "Marcus Delgado reviewed his Unit Economics and Creative Strategy.",
    );
    const names = hs.filter((h) => h.kind === "possible_member_name").map((h) => h.excerpt);
    expect(names).toEqual(["Marcus Delgado"]);
  });

  it("skips headings for the member-name heuristic", () => {
    const hs = analyzeDraftForReview("# Marcus Delgado Story\nBody text.");
    expect(hs.some((h) => h.kind === "possible_member_name")).toBe(false);
  });

  it("returns empty for clean timeless content", () => {
    const hs = analyzeDraftForReview(
      "Pick an offer that matches the traffic source. Test creatives in small batches.",
    );
    expect(hs).toHaveLength(0);
  });

  // ── Derived name-flag vocabulary (Task #1815) ─────────────────────────────
  describe("derived NameFlagVocab parameter", () => {
    const vocab = (phrases: string[] = [], words: string[] = []): NameFlagVocab => ({
      phrases: new Set([...SEED_TERMINOLOGY_PHRASES, ...phrases.map((p) => p.toLowerCase())]),
      words: new Set(words.map((w) => w.toLowerCase())),
    });

    it("suppresses a derived exact pair (e.g. corpus-frequent or dismissed)", () => {
      const text = "the Torval Nexis tool helps before scaling.";
      expect(
        analyzeDraftForReview(text).some((h) => h.kind === "possible_member_name"),
      ).toBe(true);
      expect(
        analyzeDraftForReview(text, vocab(["Torval Nexis"])).some(
          (h) => h.kind === "possible_member_name",
        ),
      ).toBe(false);
    });

    it("suppresses pairs containing an authoritative word (house term / tool tag)", () => {
      const text = "Open your Flexy Builder to edit the page.";
      expect(
        analyzeDraftForReview(text, vocab([], ["Flexy"])).some(
          (h) => h.kind === "possible_member_name",
        ),
      ).toBe(false);
    });

    it("still flags real names (King, Sterling) with a rich vocabulary present", () => {
      const hs = analyzeDraftForReview(
        "Marcus King and Ava Sterling reviewed their Pixel Boost setup.",
        vocab(["Pixel Boost"], ["Flexy", "Gifster"]),
      );
      const names = hs.filter((h) => h.kind === "possible_member_name").map((h) => h.excerpt);
      expect(names).toContain("Marcus King");
      expect(names).toContain("Ava Sterling");
    });

    it("NEVER suppresses a privacy-protected pair, even if dismissed/derived", () => {
      // "Bruce Clark" matches the coach privacy rules — a (bad) vocab entry or
      // reviewer dismissal must not silence it; it still surfaces as
      // privacy_residue via the deterministic pass.
      const hs = analyzeDraftForReview(
        "Ask Bruce Clark about scaling.",
        vocab(["Bruce Clark"], ["Bruce", "Clark"]),
      );
      expect(hs.some((h) => h.kind === "privacy_residue")).toBe(true);
    });

    it("documents the corpus-frequency edge: a non-privacy pair in the vocab is suppressed", () => {
      // If a real member name somehow appeared in >= threshold docs it would be
      // suppressed here — accepted because the publish-time privacy scrub is
      // the hard net; this heuristic is advisory only.
      const hs = analyzeDraftForReview("Jane Marple posted results.", vocab(["Jane Marple"]));
      expect(hs.some((h) => h.kind === "possible_member_name")).toBe(false);
    });
  });

  it("carries exact line index and lineText for soften/cut actions", () => {
    const content = "First line.\nSpend $99/day here.\nLast line.";
    const h = analyzeDraftForReview(content).find((x) => x.kind === "situational_number");
    expect(h).toBeDefined();
    expect(h!.line).toBe(1);
    expect(h!.lineText).toBe("Spend $99/day here.");
  });
});

describe("isPrivacyProtectedPair", () => {
  it("matches coach/staff privacy-rule surnames and founder", () => {
    expect(isPrivacyProtectedPair("Bruce Clark")).toBe(true);
    expect(isPrivacyProtectedPair("Marcus Delgado")).toBe(false);
    expect(isPrivacyProtectedPair("Pixel Boost")).toBe(false);
  });
});

describe("summary detectors", () => {
  it("detect each signal", () => {
    expect(hasSourceConflictMarker("x\n> ⚠️ SOURCE CONFLICT (for reviewer): y")).toBe(true);
    expect(hasSourceConflictMarker("plain")).toBe(false);
    expect(hasSynthesisRiskTags("- [SITUATIONAL] x")).toBe(true);
    expect(hasSynthesisRiskTags("plain")).toBe(false);
    expect(hasTimeSensitivePhrasing("currently broken")).toBe(true);
    expect(hasTimeSensitivePhrasing("always true")).toBe(false);
    expect(hasPrivacyResidue("email me at a@b.com")).toBe(true);
    expect(hasPrivacyResidue("nothing private")).toBe(false);
  });
});

describe("computeRiskFlags review-gate flags", () => {
  const base = {
    title: "T",
    authorityRole: "strategic_coach",
    corroborationCount: 2,
  };

  it("adds source_conflict (critical, blocks bulk confirm)", () => {
    const flags = computeRiskFlags({
      ...base,
      content: "> ⚠️ SOURCE CONFLICT (for reviewer): disagreement",
    });
    const f = flags.find((x) => x.type === "source_conflict");
    expect(f?.severity).toBe("critical");
    expect(blocksBulkConfirm(flags)).toBe(true);
  });

  it("adds situational_content / time_sensitive / privacy_residue", () => {
    const flags = computeRiskFlags({
      ...base,
      content:
        "- [SITUATIONAL] one member spent $40/day\nRight now this works.\nContact Bruce Clark.",
    });
    expect(flags.some((x) => x.type === "situational_content" && x.severity === "high")).toBe(true);
    expect(flags.some((x) => x.type === "time_sensitive")).toBe(true);
    expect(flags.some((x) => x.type === "privacy_residue" && x.severity === "high")).toBe(true);
  });

  it("adds none of the review-gate flags for clean content", () => {
    const flags = computeRiskFlags({ ...base, content: "Pick offers that convert." });
    for (const t of ["source_conflict", "situational_content", "time_sensitive", "privacy_residue"]) {
      expect(flags.some((x) => x.type === t)).toBe(false);
    }
  });
});
