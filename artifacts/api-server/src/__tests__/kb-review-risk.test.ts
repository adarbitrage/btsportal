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
  SOURCE_CONFLICT_PREFIX,
  BASELINE_CONFLICT_PREFIX,
  COACHING_DRIFT_PREFIX,
  hasBaselineConflictMarker,
  hasCoachingDriftMarker,
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

  it("returns empty for clean timeless content", () => {
    const hs = analyzeDraftForReview(
      "Pick an offer that matches the traffic source. Test creatives in small batches.",
    );
    expect(hs).toHaveLength(0);
  });

  it("carries exact line index and lineText for soften/cut actions", () => {
    const content = "First line.\nSpend $99/day here.\nLast line.";
    const h = analyzeDraftForReview(content).find((x) => x.kind === "situational_number");
    expect(h).toBeDefined();
    expect(h!.line).toBe(1);
    expect(h!.lineText).toBe("Spend $99/day here.");
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
