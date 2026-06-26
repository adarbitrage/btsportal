import { describe, it, expect } from "vitest";
import {
  isNode,
  isCeiling,
  isHandoffTarget,
  isTag,
  CONCEPT_NODES,
  normalizeTags,
} from "../lib/kb-taxonomy";
import { buildConceptsDocs } from "../lib/seed-concepts-kb";

describe("Concepts curated docs", () => {
  const docs = buildConceptsDocs();

  it("every doc carries a complete, valid taxonomy and is shaped to be citable", () => {
    expect(docs.length).toBeGreaterThan(0);
    const slugs = docs.map((d) => d.slug);
    expect(new Set(slugs).size, "doc slugs are unique").toBe(slugs.length);
    const titles = docs.map((d) => d.title);
    expect(new Set(titles).size, "doc titles are unique").toBe(titles.length);
    for (const d of docs) {
      expect(d.title.trim().length).toBeGreaterThan(0);
      expect(d.content.trim().length).toBeGreaterThan(0);
      // Every concept doc is homed under a real concepts-root node.
      expect(isNode(d.node), `"${d.title}" → real node`).toBe(true);
      expect(
        CONCEPT_NODES.some((n) => n.slug === d.node),
        `"${d.title}" → concepts-root node`,
      ).toBe(true);
      expect(isCeiling(d.ceiling)).toBe(true);
      expect(isHandoffTarget(d.handoff)).toBe(true);
      // Citable doc classes only (curated / overview) — never transcript.
      expect(["curated", "overview"]).toContain(d.docClass);
      expect(d.sourcePath.startsWith("/")).toBe(true);
    }
  });

  it("every tag is in the registry-controlled vocabulary", () => {
    for (const d of docs) {
      for (const t of d.tags) {
        expect(isTag(t), `"${d.title}" tag "${t}" is a real registry tag`).toBe(true);
      }
      // No silent drops: every tag survives normalization.
      expect(normalizeTags(d.tags).sort()).toEqual([...new Set(d.tags)].sort());
    }
  });

  it("carries the conceptual depth ceiling and hands off to live coaching", () => {
    for (const d of docs) {
      expect(d.ceiling, `"${d.title}" ceiling`).toBe("conceptual");
      expect(d.handoff, `"${d.title}" handoff`).toBe("coaching");
      // The handoff is made explicit in the body so the answer routes deeper
      // strategy to coaching rather than guessing past the corpus.
      expect(d.content.toLowerCase()).toContain("coaching");
    }
  });

  it("covers every Concepts node at least once", () => {
    const covered = new Set(docs.map((d) => d.node));
    for (const n of CONCEPT_NODES) {
      expect(covered.has(n.slug), `Concepts node "${n.slug}" has a verified doc`).toBe(true);
    }
  });

  it("rides tool tags relationally where the concept references a tool", () => {
    const bySlug = new Map(docs.map((d) => [d.slug, d]));
    // Creative strategy references the landing-page builder (DIYtrax).
    expect(bySlug.get("concepts-creative-strategy")!.tags).toContain("diytrax");
    // Offer strategy references the supported affiliate networks.
    expect(bySlug.get("concepts-offer-strategy")!.tags).toEqual(
      expect.arrayContaining(["media-mavens", "clickbank"]),
    );
    // Testing methodology references the Caterpillar workflow.
    expect(bySlug.get("concepts-testing-methodology")!.tags).toContain("caterpillar");
    // Metrics & economics references the metrics calculator (MetricMover).
    expect(bySlug.get("concepts-metrics-and-economics")!.tags).toContain("metricmover");
  });

  it("never leaks legacy brand or day-count Blitz naming", () => {
    for (const d of docs) {
      expect(d.content).not.toMatch(/cherrington|charrington/i);
      expect(d.content).not.toMatch(/\bTCE\b/);
      expect(d.content).not.toMatch(/\b\d+\s*-?\s*day\s+blitz/i);
    }
  });
});
