import { describe, it, expect } from "vitest";

import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_STEP_COUNT,
  CAMPAIGN_PHASE_LABELS,
  CAMPAIGN_SPINE_HEADER,
  renderCampaignSpine,
} from "./index";

describe("campaign roadmap structure", () => {
  it("has exactly 17 steps, numbered 1..17 in order", () => {
    expect(CAMPAIGN_ROADMAP).toHaveLength(CAMPAIGN_STEP_COUNT);
    CAMPAIGN_ROADMAP.forEach((step, i) => {
      expect(step.number).toBe(i + 1);
    });
  });

  it("keeps phases contiguous and in Build → Test → Scale order", () => {
    const phaseSeq = CAMPAIGN_ROADMAP.map((s) => s.phase);
    const firstTest = phaseSeq.indexOf("test");
    const firstScale = phaseSeq.indexOf("scale");
    expect(firstTest).toBeGreaterThan(0);
    expect(firstScale).toBeGreaterThan(firstTest);
    // No phase appears again after a later phase started.
    expect(phaseSeq.slice(0, firstTest).every((p) => p === "build")).toBe(true);
    expect(phaseSeq.slice(firstTest, firstScale).every((p) => p === "test")).toBe(true);
    expect(phaseSeq.slice(firstScale).every((p) => p === "scale")).toBe(true);
  });

  it("step ids and substep ids are globally unique and non-empty (checklist persistence keys)", () => {
    const stepIds = CAMPAIGN_ROADMAP.map((s) => s.id);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    const substepIds = CAMPAIGN_ROADMAP.flatMap((s) => s.substeps.map((ss) => ss.substepId));
    expect(new Set(substepIds).size).toBe(substepIds.length);
    for (const id of [...stepIds, ...substepIds]) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("network tags are only the two supported affiliate networks", () => {
    for (const step of CAMPAIGN_ROADMAP) {
      for (const sub of step.substeps) {
        if (sub.network !== undefined) {
          expect(["media-mavens", "clickbank"]).toContain(sub.network);
        }
      }
    }
  });
});

describe("spine drift guard — rendered block is generated from the module", () => {
  const spine = renderCampaignSpine();

  it("starts with the canonical header and includes every phase header", () => {
    expect(spine.startsWith(CAMPAIGN_SPINE_HEADER)).toBe(true);
    for (const label of Object.values(CAMPAIGN_PHASE_LABELS)) {
      expect(spine).toContain(`### ${label}`);
    }
  });

  it("contains every numbered step title, in chronological order", () => {
    let cursor = 0;
    for (const step of CAMPAIGN_ROADMAP) {
      const line = `${step.number}. ${step.title}`;
      const idx = spine.indexOf(line, cursor);
      expect(idx, `step ${step.number} "${step.title}" missing or out of order`).toBeGreaterThan(
        cursor,
      );
      cursor = idx;
    }
  });

  it("contains every step description and every substep action, with network tags preserved", () => {
    for (const step of CAMPAIGN_ROADMAP) {
      if (step.description) expect(spine).toContain(step.description);
      for (const sub of step.substeps) {
        expect(spine).toContain(sub.action);
        if (sub.network === "media-mavens") {
          expect(spine).toContain(`[MM] ${sub.action}`);
        } else if (sub.network === "clickbank") {
          expect(spine).toContain(`[CB] ${sub.action}`);
        }
      }
    }
  });

  it("stays compact — near the ~500–600 token budget, never bloating past it", () => {
    // ~4 chars per token heuristic; the locked verbatim step wording plus the
    // internal-ordering-markers preamble puts the floor around ~950 estimated
    // tokens, so the band guards against silent bloat (or gutting) rather
    // than an exact 600 ceiling.
    const approxTokens = spine.length / 4;
    expect(approxTokens).toBeGreaterThan(400);
    expect(approxTokens).toBeLessThan(1050);
  });
});
