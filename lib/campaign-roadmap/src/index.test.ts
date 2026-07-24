import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_STEP_COUNT,
  CAMPAIGN_PHASE_LABELS,
  CAMPAIGN_SPINE_HEADER,
  MEMBER_MERGED_KEY_GROUPS,
  memberChecklistItems,
  memberStepDescription,
  memberStepKeys,
  memberSubstepAction,
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

describe("AI spine guardrail — member-display copy NEVER affects the spine", () => {
  const spine = renderCampaignSpine();

  it("is byte-for-byte identical to the pre-member-copy-layer baseline", () => {
    // Captured from renderCampaignSpine() BEFORE the member-display copy
    // layer was introduced. If this fails, canonical wording (what the AI
    // sees) changed — member copy must never do that.
    expect(spine.length).toBe(3820);
    expect(createHash("sha256").update(spine, "utf8").digest("hex")).toBe(
      "9bdef1f119c933305e90c8bfd0696f08938e98740a8bb7c1e58031d4d32fb3cc",
    );
  });

  it("contains NO member-display string that differs from canonical wording", () => {
    for (const step of CAMPAIGN_ROADMAP) {
      const memberDescs = [
        step.member?.description,
        ...Object.values(step.member?.descriptionByNetwork ?? {}),
      ].filter((d): d is string => d !== undefined && d !== step.description);
      for (const d of memberDescs) expect(spine).not.toContain(d);

      for (const sub of step.substeps) {
        const memberActions = [
          sub.member?.action,
          ...Object.values(sub.member?.actionByNetwork ?? {}),
        ].filter((a): a is string => a !== undefined && a !== sub.action);
        for (const a of memberActions) expect(spine).not.toContain(a);
      }
    }
  });

  it("keeps full canonical granularity: both DIYTrax sub-lines, the MM advertorial note, and the branch phrasing", () => {
    expect(spine).toContain("Create the campaign in DIYTrax.");
    expect(spine).toContain("Fill in the Basic Info tab (and save).");
    expect(spine).toContain(
      "Landing-page copy comes from the pre-built advertorial (optimized later when you set up your website in Flexy).",
    );
    expect(spine).toContain(
      "Review the presell page for the offer: the advertorial [MM] or the VSL [CB].",
    );
    expect(spine).toContain("5 LP headlines + 5 hero shots (both networks).");
    expect(spine).toContain('Create a blank "MM" page with a custom code box in Flexy.');
  });
});

describe("member-display copy layer helpers", () => {
  const byId = new Map(CAMPAIGN_ROADMAP.map((s) => [s.id, s]));

  it("per-network substep action variants resolve, with canonical fallback", () => {
    const presell = byId.get("select-offer")!.substeps[0];
    expect(memberSubstepAction(presell, "media-mavens")).toBe(
      "Review the advertorial for the offer.",
    );
    expect(memberSubstepAction(presell, "clickbank")).toBe("Review the VSL for the offer.");
    expect(memberSubstepAction(presell, null)).toBe(presell.action);
  });

  it("finalize-angles description says advertorial for MM, VSL for CB", () => {
    const step = byId.get("finalize-angles")!;
    expect(memberStepDescription(step, "media-mavens")).toContain("the advertorial and");
    expect(memberStepDescription(step, "media-mavens")).not.toContain("VSL");
    expect(memberStepDescription(step, "clickbank")).toContain("the VSL and");
    expect(memberStepDescription(step, "clickbank")).not.toContain("advertorial");
    expect(memberStepDescription(step, null)).toBe(step.description);
  });

  it("choose-network confirms the selection after a choice is made", () => {
    const step = byId.get("choose-network")!;
    expect(memberStepDescription(step, null)).toBe(step.description);
    expect(memberStepDescription(step, "media-mavens")).toBe(
      "You've selected Media Mavens — the steps below are tailored to it.",
    );
    expect(memberStepDescription(step, "clickbank")).toBe(
      "You've selected ClickBank — the steps below are tailored to it.",
    );
  });

  it("LP-assets: '(both networks)' dropped; MM sees NO substeps but keeps the hidden key; CB keeps the bridge-copy substep", () => {
    const step = byId.get("create-lp-assets")!;
    expect(memberStepDescription(step, "media-mavens")).toBe("5 LP headlines + 5 hero shots.");
    expect(memberChecklistItems(step, "media-mavens")).toEqual([]);
    expect(memberStepKeys(step, "media-mavens")).toEqual([
      "create-lp-assets-mm-advertorial-copy",
    ]);
    const cbItems = memberChecklistItems(step, "clickbank");
    expect(cbItems.map((i) => i.primaryKey)).toEqual(["create-lp-assets-cb-bridge-copy"]);
  });

  it("DIYTrax create + basic-info merge into ONE member line with both canonical keys", () => {
    const step = byId.get("create-diytrax-campaign")!;
    const items = memberChecklistItems(step, "media-mavens");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      keys: ["create-diytrax-campaign-create", "create-diytrax-campaign-basic-info"],
      primaryKey: "create-diytrax-campaign-create",
      action: "Create the campaign in DIYTrax and fill in the Basic Info tab (and save).",
    });
    expect(items[1].action).toBe(
      "One-time global setup: copy the T2 landing-page URL from the Links & Pixels tab in your DIYTrax campaign and paste it into Flexy Custom Values.",
    );
    expect(MEMBER_MERGED_KEY_GROUPS).toEqual([
      ["create-diytrax-campaign-create", "create-diytrax-campaign-basic-info"],
    ]);
  });

  it('MM-page substep displays "MetricMover" wording (never confused with Media Mavens)', () => {
    const step = byId.get("metricmover-split-test")!;
    const mmPage = step.substeps.find((s) => s.substepId === "metricmover-split-test-mm-page")!;
    expect(memberSubstepAction(mmPage, "clickbank")).toBe(
      "Create a blank MetricMover page with a custom code box in Flexy.",
    );
  });
});
