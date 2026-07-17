import { describe, it, expect, vi } from "vitest";

// The manifest builder is pure over (curriculum HTML, transcript titles) —
// mock the LLM seam's module graph so no live DB/LLM config is required.
vi.mock("../lib/kb-synthesis", () => ({
  callLLMWithRetry: vi.fn(),
}));

import {
  BLITZ_SECTION_BY_ID,
  BLITZ_SECTION_IDS,
} from "@workspace/blitz-curriculum";
import { BLITZ_SECTION_TO_NODE } from "../lib/kb-taxonomy";
import { buildBlitzDocManifest, SECTION_SPLITS } from "../lib/blitz-section-docgen";
import {
  extractBlitzSections,
  type TranscriptSourceInput,
} from "../lib/blitz-section-extract";

/**
 * Drift guard for the section-anchored reference-doc manifest: if the Blitz
 * curriculum HTML, the section titles, the taxonomy node map, or the split
 * pins drift, this fails loudly BEFORE a generation run does.
 *
 * The synthetic transcript corpus is built from the manifest's own contract:
 * split sections get exactly one transcript per pinned video title (the
 * builder hard-fails on missing/duplicate/unclaimed pins), and every other
 * section gets one generic transcript. Titles use the canonical
 * "Lesson N · <section title> · <video title>" convention.
 */
function buildSyntheticTranscripts(): TranscriptSourceInput[] {
  const out: TranscriptSourceInput[] = [];
  let id = 1;
  for (const sectionId of BLITZ_SECTION_IDS) {
    const section = BLITZ_SECTION_BY_ID[sectionId];
    const splits = SECTION_SPLITS[sectionId];
    const videoTitles = splits
      ? splits.flatMap((s) => s.videoTitles)
      : [`Section ${sectionId} Walkthrough`];
    for (const vt of videoTitles) {
      out.push({
        id: id++,
        title: `Lesson ${sectionId} · ${section.title} · ${vt}`,
        content: "transcript body",
      });
    }
  }
  return out;
}

const EXPECTED_TITLES = [
  "What Is Affiliate Arbitrage?",
  "Understand the System — The Three Phases, Your Budget, and the Phase Gates",
  "How Phase 1 Works — Campaign Architecture and Your Path",
  "Choose Your Affiliate Network",
  "Select Your Offer and Get Your Affiliate Link",
  "Understanding Creative Assets — The Foundation of Your Campaign",
  "Create Your Native Ad Assets — Headlines and Descriptions",
  "Create Your Native Ad Assets — Ad Images",
  "Create Your Native Ad Assets — Preparing for Compliance",
  "Create Your Landing Page Assets — Media Mavens — Generating Angles",
  "Create Your Landing Page Assets — Media Mavens — Headlines, Copy Blocks and Hero Shots",
  "Create Your Landing Page Assets — ClickBank — Capturing the VSL and Transcript",
  "Create Your Landing Page Assets — ClickBank — Bridge Page Bot Copy",
  "Create Your Landing Page Assets — ClickBank — Choosing Page Bases",
  "Submit Your Assets for Compliance Review",
  "Setting Up Your Website in Flexy™",
  "Set Up DIYTrax",
  "Using MetricMover™",
  "Configure Caterpillar and Go Live",
  "Find Your Winners Through Data",
  "Find Your Top Performing Headline",
  "Prepare Additional Static Images While Round 1 Runs",
  "Find Your Top Performing Visual Creative",
  "Prepare Your Round 3 Placement Format Assets — Creating and Cropping Videos",
  "Prepare Your Round 3 Placement Format Assets — Converting Videos to GIFs",
  "Find Your Top Performing Placement Format",
  "Increase Budget on Your Top Performing Placement",
  "Test New Placements and Publishers",
  "Master Publisher",
];

describe("Blitz section-doc manifest — drift guard", () => {
  const synthetic = buildSyntheticTranscripts();
  const manifest = buildBlitzDocManifest(extractBlitzSections(), synthetic);

  it("produces exactly the expected 29 doc titles, in section order", () => {
    expect(manifest.map((e) => e.title)).toEqual(EXPECTED_TITLES);
  });

  it("covers every curriculum section 1..23 at least once", () => {
    const covered = new Set(manifest.map((e) => e.section.id));
    expect([...covered].sort((a, b) => a - b)).toEqual([...BLITZ_SECTION_IDS]);
  });

  it("claims every transcript exactly once across the manifest", () => {
    const claimed = manifest.flatMap((e) => e.transcripts.map((t) => t.sourceId));
    expect(claimed.length).toBe(new Set(claimed).size);
    expect(claimed.length).toBe(synthetic.length);
  });

  it("maps every doc to a taxonomy node with consistent part indexing", () => {
    for (const e of manifest) {
      expect(e.processNode, `"${e.title}" node`).toBe(BLITZ_SECTION_TO_NODE[e.section.id]);
      expect(e.processNode).toBeTruthy();
      expect(e.partIndex).toBeGreaterThanOrEqual(1);
      expect(e.partIndex).toBeLessThanOrEqual(e.partCount);
    }
  });

  it("gives split parts a focus and whole-section docs none", () => {
    for (const e of manifest) {
      if (e.partCount > 1) expect(e.focus, e.title).toBeTruthy();
      else expect(e.focus).toBeNull();
    }
  });

  it("splits exist only for the pinned sections 7, 8, 9 and 19", () => {
    expect(Object.keys(SECTION_SPLITS).map(Number).sort((a, b) => a - b)).toEqual([7, 8, 9, 19]);
  });
});
