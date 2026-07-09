import { describe, it, expect } from "vitest";
import {
  mergeNodeLinks,
  parseClassifyResponse,
  detectExactDuplicates,
  type NodeLink,
} from "../lib/kb-topic-index";
import { ALL_NODES } from "../lib/kb-taxonomy";

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

// Task #1794: the reasoning-token starvation mode (200 OK, empty content,
// finish_reason=length) must be a FAILURE, never a silent "no nodes fit".
describe("parseClassifyResponse", () => {
  const realNode = ALL_NODES[0].slug;

  it("throws on empty content (token starvation) and reports finish_reason", () => {
    expect(() =>
      parseClassifyResponse({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    ).toThrow(/finish_reason=length/);
  });

  it("throws on missing choices entirely", () => {
    expect(() => parseClassifyResponse({})).toThrow(/empty completion/);
  });

  it("throws on unparseable JSON (truncated output)", () => {
    expect(() =>
      parseClassifyResponse({
        choices: [{ finish_reason: "length", message: { content: '{"nodes":[{"node":"foo"' } }],
      }),
    ).toThrow(/unparseable/);
  });

  it('treats a clean {"nodes":[]} as a deliberate no-topic verdict (returns [])', () => {
    expect(
      parseClassifyResponse({ choices: [{ finish_reason: "stop", message: { content: '{"nodes":[]}' } }] }),
    ).toEqual([]);
  });

  it("parses valid node links, clamps relevance, drops unknown slugs", () => {
    const content = JSON.stringify({
      nodes: [
        { node: realNode, relevance: 1.7, rationale: "central" },
        { node: "not-a-real-node", relevance: 0.9 },
      ],
    });
    const links = parseClassifyResponse({ choices: [{ finish_reason: "stop", message: { content } }] });
    expect(links).toHaveLength(1);
    expect(links[0].node).toBe(realNode);
    expect(links[0].relevance).toBe(1);
    expect(links[0].method).toBe("llm");
  });

  it("caps a single window at 4 links", () => {
    const content = JSON.stringify({
      nodes: ALL_NODES.slice(0, 6).map((n, i) => ({ node: n.slug, relevance: 0.9 - i * 0.1 })),
    });
    const links = parseClassifyResponse({ choices: [{ finish_reason: "stop", message: { content } }] });
    expect(links).toHaveLength(4);
  });
});

describe("detectExactDuplicates", () => {
  it("groups byte-identical documents and ignores unique ones", () => {
    const groups = detectExactDuplicates([
      { id: 3, title: "B copy", content: "same text" },
      { id: 1, title: "A", content: "unique text" },
      { id: 2, title: "B", content: "same text" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual([2, 3]);
  });

  it("returns [] when there are no duplicates", () => {
    expect(
      detectExactDuplicates([
        { id: 1, title: "A", content: "x" },
        { id: 2, title: "B", content: "y" },
      ]),
    ).toEqual([]);
  });
});
