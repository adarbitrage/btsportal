import { describe, it, expect } from "vitest";
import { buildReviewerSop } from "../lib/kb-sop.js";
import {
  HOME_ROOTS,
  ALL_NODES,
  DOC_CLASSES,
  CITABLE_DOC_CLASSES,
  CEILINGS,
  HANDOFF_TARGETS,
  HANDOFF_TARGET_NODES,
} from "../lib/kb-taxonomy.js";
import { RISK_FLAG_TYPES } from "../lib/kb-flags.js";

describe("reviewer SOP drift guard", () => {
  const sop = buildReviewerSop();

  it("covers exactly the taxonomy home roots, in registry order", () => {
    expect(sop.homeRoots.map((r) => r.slug)).toEqual(HOME_ROOTS.map((r) => r.slug));
    for (const root of sop.homeRoots) {
      expect(root.label).toBeTruthy();
      expect(root.description).toBeTruthy();
    }
  });

  it("lists exactly the nodes of each root", () => {
    for (const root of sop.homeRoots) {
      const expected = ALL_NODES.filter((n) => n.root === root.slug).map((n) => n.slug);
      expect(root.nodes.map((n) => n.slug)).toEqual(expected);
    }
    // Every registry node appears exactly once across the SOP.
    const sopNodeSlugs = sop.homeRoots.flatMap((r) => r.nodes.map((n) => n.slug)).sort();
    expect(sopNodeSlugs).toEqual(ALL_NODES.map((n) => n.slug).slice().sort());
  });

  it("covers exactly the doc classes and marks citability from the registry", () => {
    expect(sop.docClasses.map((c) => c.slug)).toEqual([...DOC_CLASSES]);
    const citable = new Set<string>(CITABLE_DOC_CLASSES);
    for (const c of sop.docClasses) {
      expect(c.citable).toBe(citable.has(c.slug));
      expect(c.charter).toBeTruthy();
      expect(c.label).toBeTruthy();
    }
  });

  it("covers exactly the ceilings", () => {
    expect(sop.ceilings.map((c) => c.slug)).toEqual([...CEILINGS]);
    for (const c of sop.ceilings) expect(c.description).toBeTruthy();
  });

  it("covers exactly the handoff targets and their nodes", () => {
    expect(sop.handoffs.map((h) => h.target)).toEqual([...HANDOFF_TARGETS]);
    for (const h of sop.handoffs) {
      expect(h.node).toBe(HANDOFF_TARGET_NODES[h.target as keyof typeof HANDOFF_TARGET_NODES]);
      expect(h.nodeLabel).toBeTruthy();
      expect(h.description).toBeTruthy();
    }
  });

  it("covers exactly the risk-flag catalog", () => {
    expect(sop.flags.map((f) => f.type)).toEqual([...RISK_FLAG_TYPES]);
    for (const f of sop.flags) expect(f.meaning).toBeTruthy();
  });

  it("carries authored prose sections with bodies", () => {
    expect(sop.sections.length).toBeGreaterThan(0);
    expect(sop.intro).toBeTruthy();
    for (const s of sop.sections) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(0);
    }
  });
});
