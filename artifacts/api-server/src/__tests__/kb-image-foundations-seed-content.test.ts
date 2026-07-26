import { describe, it, expect } from "vitest";
import { isNode, isTag, CONCEPT_NODES } from "../lib/kb-taxonomy";
import {
  IMAGE_SEED_DOCS,
  IMAGE_LIVE_DOC_TITLE,
  IMAGE_FOUNDATIONS_SEED_SOURCE,
} from "../lib/seed-image-foundations-staging";

/**
 * Content/taxonomy guard for the Image Foundations staging seed (Task #2010).
 * These docs land as pending_review DRAFTS (human gate absolute), but the
 * manifest itself must be structurally sound before it ever reaches the
 * review queue.
 */
describe("Image Foundations staging seed manifest", () => {
  it("has 8 docs with unique slugs and titles", () => {
    expect(IMAGE_SEED_DOCS.length).toBe(8);
    const slugs = IMAGE_SEED_DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const titles = IMAGE_SEED_DOCS.map((d) => d.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("every doc is filed under the concepts-root creative-strategy node with citable class and 1-3 registry tags", () => {
    expect(isNode("creative-strategy")).toBe(true);
    expect(CONCEPT_NODES.some((n) => n.slug === "creative-strategy")).toBe(true);
    for (const d of IMAGE_SEED_DOCS) {
      expect(["curated", "overview"]).toContain(d.docClassTarget);
      expect(d.taxonomyTags.length).toBeGreaterThanOrEqual(1);
      expect(d.taxonomyTags.length).toBeLessThanOrEqual(3);
      for (const t of d.taxonomyTags) {
        expect(isTag(t), `"${d.title}" tag "${t}" is a real registry tag`).toBe(
          true,
        );
      }
      expect(d.content.trim().length).toBeGreaterThan(500);
      // Content begins with the doc's own title line (house convention).
      expect(d.content.startsWith(d.title)).toBe(true);
      // Admin provenance note always present (attribution lives there ONLY).
      expect(d.adminNotes.length).toBeGreaterThan(50);
    }
  });

  it("the seven NEW docs carry the explicit coaching handoff close; only the revision targets the live doc", () => {
    const revisions = IMAGE_SEED_DOCS.filter((d) => d.isRevision);
    expect(revisions.length).toBe(1);
    expect(revisions[0].title).toBe(IMAGE_LIVE_DOC_TITLE);
    expect(revisions[0].updateSummary?.length ?? 0).toBeGreaterThan(50);
    for (const d of IMAGE_SEED_DOCS) {
      if (d.isRevision) continue;
      expect(
        d.content.includes("coaching"),
        `"${d.title}" has the coaching handoff line`,
      ).toBe(true);
    }
  });

  it("respects the standing scope rulings in body copy", () => {
    const all = IMAGE_SEED_DOCS.map((d) => d.content).join("\n");
    // No text/pricing in images taught as absolute; white backgrounds banned.
    expect(all).toMatch(/No text in the image/i);
    expect(all).toMatch(/no white or light backgrounds/i);
    // The compliance doc teaches exactly seven bans as universal.
    const compliance = IMAGE_SEED_DOCS.find(
      (d) => d.slug === "image-compliance-absolute-bans",
    );
    expect(compliance).toBeDefined();
    expect(compliance!.content).toContain("The seven absolute bans");
    for (const ban of [
      "Before/after transformation images",
      "Sexualized imagery",
      "Celebrities and public figures",
      "Fake UI elements",
      "Shock, gore",
      "Misleading or irrelevant images",
      "Implied disease and medical claims",
    ]) {
      expect(compliance!.content).toContain(ban);
    }
  });

  it("content is already clean: privacy/brand/confidential scrubbers are no-ops on it", async () => {
    expect(IMAGE_FOUNDATIONS_SEED_SOURCE).toBe("image_foundations_seed");
    const { scrubPrivateContent, rebrandOldBrandContent } = await import(
      "../lib/content-privacy-filter"
    );
    const { scrubConfidentialTerm } = await import(
      "../lib/confidential-term-repair"
    );
    for (const d of IMAGE_SEED_DOCS) {
      const all = d.title + "\n" + d.content;
      expect(
        scrubPrivateContent(rebrandOldBrandContent(scrubConfidentialTerm(all))),
        `"${d.title}" needs no scrubbing`,
      ).toBe(all);
    }
  });
});
