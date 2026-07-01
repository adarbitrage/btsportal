import { describe, it, expect } from "vitest";
import { mergeNodeLinks, type NodeLink } from "../lib/kb-topic-index";

function link(node: string, relevance: number): NodeLink {
  return { node, homeRoot: "operations", relevance, rationale: null, method: "llm" };
}

describe("mergeNodeLinks", () => {
  it("keeps EVERY covered node — no per-source cap (the full-source read guarantee)", () => {
    // 12 distinct nodes, as if merged from several windows of a long source.
    const links = Array.from({ length: 12 }, (_, i) => link(`node-${i}`, 0.5 + i * 0.01));
    const merged = mergeNodeLinks(links);
    expect(merged).toHaveLength(12);
    expect(new Set(merged.map((l) => l.node)).size).toBe(12);
  });

  it("de-dupes on node, keeping the strongest relevance", () => {
    const merged = mergeNodeLinks([
      link("a", 0.3),
      link("a", 0.9),
      link("b", 0.4),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.node === "a")?.relevance).toBe(0.9);
  });

  it("sorts strongest-first", () => {
    const merged = mergeNodeLinks([link("a", 0.2), link("b", 0.8), link("c", 0.5)]);
    expect(merged.map((l) => l.node)).toEqual(["b", "c", "a"]);
  });

  it("returns an empty set for no links", () => {
    expect(mergeNodeLinks([])).toEqual([]);
  });
});
