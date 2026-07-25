/**
 * Recurrence-drift advisory flag (Task #1989): a process doc whose prose
 * frames a ONE-TIME campaign-roadmap step (subdomain / site clone / Flexy
 * custom values) as per-campaign work contradicts the spine's lifecycle tags.
 * Advisory only — must never block publishing.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeDraftForReview,
  hasRecurrenceDrift,
  HIGHLIGHT_META,
} from "../lib/kb-review-risk";
import { computeRiskFlags } from "../lib/kb-flags";

describe("recurrence-drift detector (kb-review-risk)", () => {
  it("flags a one-time step framed as per-campaign work", () => {
    const samples = [
      "You'll need to clone the site again for each new campaign.",
      "Create a subdomain for every campaign you launch.",
      "Set up your custom values per campaign before writing emails.",
      "Every time you launch a new campaign, connect a fresh subdomain.",
    ];
    for (const s of samples) {
      expect(hasRecurrenceDrift(s), s).toBe(true);
      const hits = analyzeDraftForReview(s).filter((h) => h.kind === "recurrence_drift");
      expect(hits.length, s).toBe(1);
      expect(hits[0].severity).toBe("medium");
    }
  });

  it("does NOT flag correct one-time phrasing about the same topics", () => {
    const samples = [
      "Cloning the site is a one-time setup per brand domain.",
      "You only create the subdomain once — reuse it for later campaigns.",
      "The Flexy custom values are a one-time global setup.",
    ];
    for (const s of samples) {
      expect(hasRecurrenceDrift(s), s).toBe(false);
    }
  });

  it("does NOT flag per-campaign language about genuinely per-campaign steps", () => {
    const samples = [
      "Choose a fresh offer for each new campaign.",
      "You will pick an affiliate network per campaign.",
      "Write new emails every time you launch a campaign.",
    ];
    for (const s of samples) {
      expect(hasRecurrenceDrift(s), s).toBe(false);
    }
  });

  it("requires topic + recurrence on the SAME line (no cross-line pairing)", () => {
    const doc = "Clone the site using the Flexy template.\nRepeat your offer research for each new campaign.";
    expect(hasRecurrenceDrift(doc)).toBe(false);
  });

  it("has advisory (medium) highlight metadata", () => {
    expect(HIGHLIGHT_META.recurrence_drift.severity).toBe("medium");
    expect(HIGHLIGHT_META.recurrence_drift.note).toContain("Advisory only");
  });
});

describe("recurrence_drift risk flag (kb-flags)", () => {
  const driftContent = "Step guide.\nCreate a subdomain for every new campaign.";

  it("fires for process-class docs, advisory severity", () => {
    const flags = computeRiskFlags({
      title: "Subdomain setup",
      content: driftContent,
      docClassTarget: "process",
    });
    const flag = flags.find((f) => f.type === "recurrence_drift");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("medium");
  });

  it("does not fire for non-process doc classes", () => {
    const flags = computeRiskFlags({
      title: "Subdomain overview",
      content: driftContent,
      docClassTarget: "overview",
    });
    expect(flags.some((f) => f.type === "recurrence_drift")).toBe(false);
  });

  it("does not fire for clean process docs", () => {
    const flags = computeRiskFlags({
      title: "Subdomain setup",
      content: "Cloning the site is a one-time setup per brand domain.",
      docClassTarget: "process",
    });
    expect(flags.some((f) => f.type === "recurrence_drift")).toBe(false);
  });
});
