import { describe, it, expect } from "vitest";
import {
  normalizeExcerpt,
  flagFingerprint,
  partitionFlags,
  partitionHighlights,
} from "../lib/kb-flag-lifecycle.js";
import type { RiskFlag } from "../lib/kb-flags.js";
import type { ReviewHighlight } from "../lib/kb-review-risk.js";

const flag = (over: Partial<RiskFlag> = {}): RiskFlag => ({
  type: "low_confidence",
  severity: "high",
  message: "Only one source backs this claim",
  detail: "Corroboration count: 1",
  ...over,
});

const highlight = (over: Partial<ReviewHighlight> = {}): ReviewHighlight => ({
  kind: "member_specific_number",
  severity: "medium",
  label: "Member-specific number",
  excerpt: "$4,500 per month",
  line: 3,
  lineText: "Aim for $4,500 per month as your target.",
  note: "A member-specific figure stated as a universal target.",
  ...over,
});

describe("normalizeExcerpt", () => {
  it("lowercases, collapses whitespace, trims", () => {
    expect(normalizeExcerpt("  Foo\t BAR\n baz  ")).toBe("foo bar baz");
  });

  it("makes re-synthesized whitespace variants collide", () => {
    expect(normalizeExcerpt("Send  the\nMentee Master Agreement")).toBe(
      normalizeExcerpt("send the mentee master agreement"),
    );
  });
});

describe("flagFingerprint", () => {
  it("is stable for the same trigger", () => {
    expect(flagFingerprint(flag())).toBe(flagFingerprint(flag()));
  });

  it("changes when the message changes", () => {
    expect(flagFingerprint(flag())).not.toBe(flagFingerprint(flag({ message: "Different trigger" })));
  });

  it("changes when the detail changes", () => {
    expect(flagFingerprint(flag())).not.toBe(flagFingerprint(flag({ detail: "Corroboration count: 0" })));
  });

  it("treats missing detail as empty string", () => {
    expect(flagFingerprint(flag({ detail: undefined }))).toBe(flagFingerprint(flag({ detail: "" })));
  });

  it("normalizes whitespace/case so cosmetic recomputation differences do not resurface a resolution", () => {
    expect(flagFingerprint(flag({ message: "Only ONE source  backs this claim" }))).toBe(
      flagFingerprint(flag()),
    );
  });
});

describe("partitionFlags", () => {
  const resolution = (over: Partial<Parameters<typeof partitionFlags>[1][number]> = {}) => ({
    id: 7,
    flagType: "low_confidence",
    fingerprint: flagFingerprint(flag()),
    reason: "Verified against the contract",
    resolvedBy: 42,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  });

  it("marks a flag resolved when type + fingerprint match", () => {
    const { states, active } = partitionFlags([flag()], [resolution()]);
    expect(active).toHaveLength(0);
    expect(states[0].resolved).toBe(true);
    expect(states[0].resolution).toMatchObject({
      id: 7,
      reason: "Verified against the contract",
      resolvedBy: 42,
      resolvedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("keeps a flag ACTIVE when the same type reappears with a NEW trigger", () => {
    const changed = flag({ message: "Zero sources back this claim" });
    const { states, active } = partitionFlags([changed], [resolution()]);
    expect(active).toEqual([changed]);
    expect(states[0].resolved).toBe(false);
    expect(states[0].resolution).toBeNull();
  });

  it("only resolves the matching type; other flags stay active", () => {
    const other = flag({ type: "conflict", message: "Conflicts with a verified doc" });
    const { active } = partitionFlags([flag(), other], [resolution()]);
    expect(active).toEqual([other]);
  });

  it("no resolutions → everything active", () => {
    const { states, active } = partitionFlags([flag()], []);
    expect(active).toHaveLength(1);
    expect(states[0].resolved).toBe(false);
  });
});

describe("partitionHighlights", () => {
  const dismissal = (over: Partial<Parameters<typeof partitionHighlights>[1][number]> = {}) => ({
    id: 11,
    kind: "member_specific_number",
    excerptNorm: normalizeExcerpt("$4,500 per month"),
    ...over,
  });

  it("dismisses on kind + normalized excerpt and carries the dismissalId", () => {
    const { active, dismissed } = partitionHighlights([highlight()], [dismissal()]);
    expect(active).toHaveLength(0);
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].dismissalId).toBe(11);
  });

  it("survives re-synthesis whitespace/case variants of the same passage", () => {
    const variant = highlight({ excerpt: "$4,500  PER  month" });
    const { active, dismissed } = partitionHighlights([variant], [dismissal()]);
    expect(active).toHaveLength(0);
    expect(dismissed).toHaveLength(1);
  });

  it("same excerpt under a DIFFERENT kind stays active", () => {
    const other = highlight({ kind: "time_sensitive" });
    const { active, dismissed } = partitionHighlights([other], [dismissal()]);
    expect(active).toEqual([other]);
    expect(dismissed).toHaveLength(0);
  });

  it("splits mixed lists correctly", () => {
    const kept = highlight({ excerpt: "next Tuesday's webinar", kind: "time_sensitive" });
    const { active, dismissed } = partitionHighlights([highlight(), kept], [dismissal()]);
    expect(active).toEqual([kept]);
    expect(dismissed).toHaveLength(1);
  });
});
