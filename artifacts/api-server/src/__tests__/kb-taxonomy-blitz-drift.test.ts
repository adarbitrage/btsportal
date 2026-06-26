import { describe, it, expect } from "vitest";
import { BLITZ_SECTION_IDS } from "@workspace/blitz-curriculum";
import {
  BLITZ_SECTION_TO_NODE,
  PROCESS_NODES,
  OPERATIONS_NODES,
  isProcessNode,
  isOperationsNode,
  HOME_ROOT_SLUGS,
  DEFAULT_HOME_ROOT,
  DOC_CLASSES,
  CITABLE_DOC_CLASSES,
  SOURCE_DISPOSITIONS,
  AUTHORITY_ROLES,
  CEILINGS,
  HANDOFF_TARGETS,
  HANDOFF_TARGET_NODES,
  isCeiling,
  isHandoffTarget,
  resolveHandoffNode,
  authorityRoleFromCoachType,
} from "../lib/kb-taxonomy";

describe("Blitz → taxonomy node drift guard", () => {
  const mappedIds = Object.keys(BLITZ_SECTION_TO_NODE).map(Number).sort((a, b) => a - b);
  const canonicalIds = [...BLITZ_SECTION_IDS].sort((a, b) => a - b);

  it("maps EXACTLY the canonical Blitz section id set (no missing, no extra)", () => {
    expect(mappedIds).toEqual(canonicalIds);
  });

  it("maps every section to a real Process node", () => {
    for (const [id, node] of Object.entries(BLITZ_SECTION_TO_NODE)) {
      expect(isProcessNode(node), `section ${id} → unknown/non-process node "${node}"`).toBe(true);
    }
  });

  it("every Process node is reachable from at least one Blitz section (no orphan stage)", () => {
    const used = new Set(Object.values(BLITZ_SECTION_TO_NODE));
    for (const n of PROCESS_NODES) {
      expect(used.has(n.slug), `process node "${n.slug}" has no Blitz section`).toBe(true);
    }
  });
});

describe("taxonomy vocabularies are internally consistent", () => {
  it("DEFAULT_HOME_ROOT is a real home root", () => {
    expect(HOME_ROOT_SLUGS).toContain(DEFAULT_HOME_ROOT);
  });

  it("citable doc classes are a subset of doc classes and exclude transcript", () => {
    for (const c of CITABLE_DOC_CLASSES) {
      expect(DOC_CLASSES).toContain(c);
    }
    expect(CITABLE_DOC_CLASSES).not.toContain("transcript");
  });

  it("source dispositions + authority roles carry conservative defaults", () => {
    expect(SOURCE_DISPOSITIONS).toContain("quarantined");
    expect(AUTHORITY_ROLES).toContain("internal");
  });

  it("every Operations node is rooted in operations and recognized as such", () => {
    expect(OPERATIONS_NODES.length).toBeGreaterThan(0);
    for (const n of OPERATIONS_NODES) {
      expect(n.root).toBe("operations");
      expect(isOperationsNode(n.slug)).toBe(true);
      expect(isProcessNode(n.slug)).toBe(false);
    }
  });

  it("ceiling + handoff validators accept only the controlled vocab", () => {
    for (const c of CEILINGS) expect(isCeiling(c)).toBe(true);
    expect(isCeiling("nonsense")).toBe(false);
    for (const h of HANDOFF_TARGETS) expect(isHandoffTarget(h)).toBe(true);
    expect(isHandoffTarget("nonsense")).toBe(false);
  });

  it("every handoff target resolves to a real Operations node", () => {
    const opSlugs = new Set(OPERATIONS_NODES.map((n) => n.slug));
    for (const target of HANDOFF_TARGETS) {
      const node = HANDOFF_TARGET_NODES[target];
      expect(node, `handoff "${target}" maps to a node`).toBeTruthy();
      expect(opSlugs.has(node), `handoff "${target}" → unknown operations node "${node}"`).toBe(true);
      expect(resolveHandoffNode(target)).toBe(node);
      expect(isOperationsNode(node)).toBe(true);
    }
    expect(resolveHandoffNode("nonsense")).toBeNull();
    expect(resolveHandoffNode(null)).toBeNull();
  });

  it("authorityRoleFromCoachType maps roster types and defaults conservatively", () => {
    expect(authorityRoleFromCoachType("strategic_coach")).toBe("strategic_coach");
    expect(authorityRoleFromCoachType("va")).toBe("va");
    expect(authorityRoleFromCoachType("")).toBe("internal");
    expect(authorityRoleFromCoachType(null)).toBe("internal");
    expect(authorityRoleFromCoachType("something-new")).toBe("internal");
  });
});
