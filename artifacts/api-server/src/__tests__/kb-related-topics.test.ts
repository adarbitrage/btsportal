/**
 * "Related topics" hygiene (Task #1801).
 *
 * Two ends of the fix, both covered here:
 *  - Analysis-time: computeRelatedTopicsFlag flags Related-topics lists that
 *    don't match the doc's taxonomy placement (off-shelf entries, boilerplate
 *    every-sibling dumps), and stays silent on genuinely adjacent lists.
 *  - Synthesis-time: relatedTopicsMarkdown builds the section from the curated
 *    NODE_NEIGHBORS adjacency — real sibling/neighbor topics, never a generic
 *    default — and its output is always clean under the analysis flag.
 * Plus a drift guard on the NODE_NEIGHBORS registry itself.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_NODES,
  NODE_NEIGHBORS,
  relatedNodesFor,
  getNodeBySlug,
} from "../lib/kb-taxonomy.js";
import { relatedTopicsMarkdown } from "../lib/kb-synthesis.js";
import {
  parseRelatedTopicEntries,
  computeRelatedTopicsFlag,
  computeRiskFlags,
  blocksBulkConfirm,
  autoFixRelatedTopics,
} from "../lib/kb-flags.js";

const NODE_SLUGS = new Set(ALL_NODES.map((n) => n.slug));
const labelOf = (slug: string) => ALL_NODES.find((n) => n.slug === slug)!.label;

describe("NODE_NEIGHBORS drift guard", () => {
  it("covers every taxonomy node with at least one neighbor", () => {
    for (const node of ALL_NODES) {
      const neighbors = NODE_NEIGHBORS[node.slug];
      expect(neighbors, `node ${node.slug} missing from NODE_NEIGHBORS`).toBeDefined();
      expect(neighbors!.length).toBeGreaterThan(0);
    }
  });

  it("every key and target is a real node; no self-links; no dupes", () => {
    for (const [slug, neighbors] of Object.entries(NODE_NEIGHBORS)) {
      expect(NODE_SLUGS.has(slug), `unknown key ${slug}`).toBe(true);
      const seen = new Set<string>();
      for (const n of neighbors) {
        expect(NODE_SLUGS.has(n), `unknown neighbor ${n} on ${slug}`).toBe(true);
        expect(n).not.toBe(slug);
        expect(seen.has(n), `duplicate neighbor ${n} on ${slug}`).toBe(false);
        seen.add(n);
      }
    }
  });

  it("operations nodes only neighbor operations nodes (no cross-shelf leakage)", () => {
    for (const node of ALL_NODES.filter((n) => n.root === "operations")) {
      for (const n of NODE_NEIGHBORS[node.slug] ?? []) {
        expect(getNodeBySlug(n)!.root).toBe("operations");
      }
    }
  });
});

describe("relatedTopicsMarkdown (synthesis-time fix)", () => {
  it("lists exactly the curated neighbors' real labels for every node", () => {
    for (const node of ALL_NODES) {
      const md = relatedTopicsMarkdown(node);
      const entries = parseRelatedTopicEntries(md);
      const expected = relatedNodesFor(node.slug).map((n) => n.label);
      expect(new Set(entries)).toEqual(new Set(expected));
      expect(entries.length).toBeGreaterThan(0);
      // Never the full-root dump.
      const rootSiblingCount = ALL_NODES.filter(
        (n) => n.root === node.root && n.slug !== node.slug,
      ).length;
      const sameRootEntries = entries.filter(
        (e) => ALL_NODES.find((n) => n.label === e)?.root === node.root,
      );
      expect(sameRootEntries.length).toBeLessThan(rootSiblingCount);
    }
  });

  it("keeps operations topics off process/concepts docs (the reported bug)", () => {
    const testing = ALL_NODES.find((n) => n.slug === "testing")!;
    const md = relatedTopicsMarkdown(testing);
    expect(md).not.toContain("Billing & Refunds");
    expect(md).not.toContain("Membership & Account");
  });

  it("its output is always clean under the analysis flag (both ends agree)", () => {
    for (const node of ALL_NODES) {
      const content = `# ${node.label} doc\n\nBody.\n${relatedTopicsMarkdown(node)}`;
      const flag = computeRelatedTopicsFlag({ content, homeRoot: node.root, node: node.slug });
      expect(flag, `synthesis output for ${node.slug} should not self-flag`).toBeNull();
    }
  });
});

describe("parseRelatedTopicEntries", () => {
  it("extracts bullets from the section and stops at the next heading", () => {
    const content = [
      "# Title",
      "Body.",
      "## Related topics",
      "**Related topics:**",
      "- Billing & Refunds",
      "* Coaching Access & Schedule",
      "## Another section",
      "- Not an entry",
    ].join("\n");
    expect(parseRelatedTopicEntries(content)).toEqual([
      "Billing & Refunds",
      "Coaching Access & Schedule",
    ]);
  });

  it("returns [] when there is no Related topics section", () => {
    expect(parseRelatedTopicEntries("# Doc\n\n- Billing & Refunds")).toEqual([]);
  });
});

describe("computeRelatedTopicsFlag (analysis-time flag)", () => {
  const section = (entries: string[]) =>
    `# Doc\n\nBody.\n\n## Related topics\n${entries.map((e) => `- ${e}`).join("\n")}`;

  it("flags off-shelf entries and names them (Billing & Refunds on a testing doc)", () => {
    const flag = computeRelatedTopicsFlag({
      content: section(["Billing & Refunds", "Testing Methodology"]),
      homeRoot: "process",
      node: "testing",
    });
    expect(flag).not.toBeNull();
    expect(flag!.type).toBe("related_topics_mismatch");
    expect(flag!.detail).toContain('"Billing & Refunds"');
    expect(flag!.detail).not.toContain('"Testing Methodology"');
  });

  it("flags the boilerplate every-sibling dump", () => {
    const allOpsSiblings = ALL_NODES.filter(
      (n) => n.root === "operations" && n.slug !== "membership",
    ).map((n) => n.label);
    const flag = computeRelatedTopicsFlag({
      content: section(allOpsSiblings),
      homeRoot: "operations",
      node: "membership",
    });
    expect(flag).not.toBeNull();
    expect(flag!.detail).toContain("generic default list");
  });

  it("does not flag genuinely adjacent lists", () => {
    const flag = computeRelatedTopicsFlag({
      content: section([labelOf("launch"), labelOf("scaling"), labelOf("testing-methodology")]),
      homeRoot: "process",
      node: "testing",
    });
    expect(flag).toBeNull();
  });

  it("allows the process↔concepts depth-ladder pairing", () => {
    const flag = computeRelatedTopicsFlag({
      content: section([labelOf("angles"), labelOf("creative-assets")]),
      homeRoot: "concepts",
      node: "headlines-and-copy",
    });
    expect(flag).toBeNull();
  });

  it("ignores free-prose entries that are not taxonomy labels", () => {
    const flag = computeRelatedTopicsFlag({
      content: section(["How to pick a great offer", "Ad fatigue basics"]),
      homeRoot: "process",
      node: "testing",
    });
    expect(flag).toBeNull();
  });

  it("stays silent when the doc has no placement or no section", () => {
    expect(
      computeRelatedTopicsFlag({ content: section(["Billing & Refunds"]), homeRoot: null, node: null }),
    ).toBeNull();
    expect(
      computeRelatedTopicsFlag({ content: "# Doc\n\nBody only.", homeRoot: "process", node: "testing" }),
    ).toBeNull();
  });

  it("judges by homeRoot alone when the node is unknown", () => {
    const flag = computeRelatedTopicsFlag({
      content: section(["Billing & Refunds"]),
      homeRoot: "process",
      node: null,
    });
    expect(flag).not.toBeNull();
  });
});

describe("autoFixRelatedTopics (analysis-time auto-fix, Task #1839)", () => {
  const section = (entries: string[]) =>
    `# Doc\n\nBody.\n\n## Related topics\n${entries.map((e) => `- ${e}`).join("\n")}`;

  it("removes off-subject taxonomy entries, keeps adjacent ones", () => {
    const fix = autoFixRelatedTopics({
      content: section(["Billing & Refunds", labelOf("launch"), labelOf("testing-methodology")]),
      homeRoot: "process",
      node: "testing",
    });
    expect(fix.changed).toBe(true);
    const entries = parseRelatedTopicEntries(fix.content);
    expect(entries).not.toContain("Billing & Refunds");
    expect(entries).toContain(labelOf("launch"));
    expect(entries).toContain(labelOf("testing-methodology"));
  });

  it("preserves free-prose entries the reviewer may have written", () => {
    const fix = autoFixRelatedTopics({
      content: section(["Billing & Refunds", "How to pick a great offer", labelOf("launch")]),
      homeRoot: "process",
      node: "testing",
    });
    expect(fix.changed).toBe(true);
    const entries = parseRelatedTopicEntries(fix.content);
    expect(entries).toContain("How to pick a great offer");
    expect(entries).not.toContain("Billing & Refunds");
  });

  it("removes the boilerplate full-root dump and refills from NODE_NEIGHBORS", () => {
    const allOpsSiblings = ALL_NODES.filter(
      (n) => n.root === "operations" && n.slug !== "membership",
    ).map((n) => n.label);
    const fix = autoFixRelatedTopics({
      content: section(allOpsSiblings),
      homeRoot: "operations",
      node: "membership",
    });
    expect(fix.changed).toBe(true);
    const entries = parseRelatedTopicEntries(fix.content);
    const expected = relatedNodesFor("membership").map((n) => n.label);
    expect(new Set(entries)).toEqual(new Set(expected));
  });

  it("refilled output is clean under the analysis flag and idempotent", () => {
    const allOpsSiblings = ALL_NODES.filter(
      (n) => n.root === "operations" && n.slug !== "membership",
    ).map((n) => n.label);
    const first = autoFixRelatedTopics({
      content: section(allOpsSiblings),
      homeRoot: "operations",
      node: "membership",
    });
    expect(
      computeRelatedTopicsFlag({ content: first.content, homeRoot: "operations", node: "membership" }),
    ).toBeNull();
    const second = autoFixRelatedTopics({
      content: first.content,
      homeRoot: "operations",
      node: "membership",
    });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("removal-only output is also flag-clean and idempotent", () => {
    const first = autoFixRelatedTopics({
      content: section(["Billing & Refunds", labelOf("launch")]),
      homeRoot: "process",
      node: "testing",
    });
    expect(
      computeRelatedTopicsFlag({ content: first.content, homeRoot: "process", node: "testing" }),
    ).toBeNull();
    const second = autoFixRelatedTopics({ content: first.content, homeRoot: "process", node: "testing" });
    expect(second.changed).toBe(false);
  });

  it("never touches a doc with no placement or no Related-topics section", () => {
    const noPlacement = autoFixRelatedTopics({
      content: section(["Billing & Refunds"]),
      homeRoot: null,
      node: null,
    });
    expect(noPlacement.changed).toBe(false);
    const noSection = autoFixRelatedTopics({
      content: "# Doc\n\nBody only.",
      homeRoot: "process",
      node: "testing",
    });
    expect(noSection.changed).toBe(false);
  });

  it("does not rewrite content outside the Related topics section", () => {
    const content = `# Title\n\nIntro - Billing & Refunds mentioned in prose.\n\n## Related topics\n- Billing & Refunds\n- ${labelOf("launch")}\n\n## Next steps\n- Billing & Refunds`;
    const fix = autoFixRelatedTopics({ content, homeRoot: "process", node: "testing" });
    expect(fix.changed).toBe(true);
    expect(fix.content).toContain("Intro - Billing & Refunds mentioned in prose.");
    expect(fix.content).toContain("## Next steps\n- Billing & Refunds");
  });

  it("leaves synthesis output untouched for every node (never self-fixes)", () => {
    for (const node of ALL_NODES) {
      const content = `# ${node.label} doc\n\nBody.\n${relatedTopicsMarkdown(node)}`;
      const fix = autoFixRelatedTopics({ content, homeRoot: node.root, node: node.slug });
      expect(fix.changed, `synthesis output for ${node.slug} should not be auto-fixed`).toBe(false);
    }
  });
});

describe("computeRiskFlags integration", () => {
  const baseInput = {
    title: "Testing rounds doc",
    content:
      "# Doc\n\nBody.\n\n## Related topics\n- Billing & Refunds\n- Getting Help",
    homeRoot: "process",
    node: "testing",
    corroborationCount: 2,
  };

  it("surfaces the flag alongside existing flags, non-blocking", () => {
    const flags = computeRiskFlags(baseInput);
    const f = flags.find((x) => x.type === "related_topics_mismatch");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(blocksBulkConfirm([f!])).toBe(false);
  });

  it("does not fire on a doc with adjacent related topics", () => {
    const flags = computeRiskFlags({
      ...baseInput,
      content: `# Doc\n\nBody.\n\n## Related topics\n- ${labelOf("launch")}\n- ${labelOf("testing-methodology")}`,
    });
    expect(flags.find((x) => x.type === "related_topics_mismatch")).toBeUndefined();
  });
});
