import { describe, it, expect } from "vitest";
import {
  isOperationsNode,
  isCeiling,
  isHandoffTarget,
} from "../lib/kb-taxonomy";
import {
  LEGACY_CROSSWALK,
  crosswalkByKind,
  uncertainCrosswalkEntries,
} from "../lib/kb-legacy-crosswalk";
import {
  PORTAL_NAVIGATION_MAP,
  flattenNavigationMap,
} from "../lib/kb-portal-navigation-map";
import { buildOperationsDocs } from "../lib/seed-operations-kb";
import { COACHING_ROSTER } from "../lib/coaching-roster";

describe("legacy → current crosswalk", () => {
  it("every entry has legacy aliases, a current target, and a kind", () => {
    expect(LEGACY_CROSSWALK.length).toBeGreaterThan(0);
    for (const e of LEGACY_CROSSWALK) {
      expect(e.legacy.length, `entry "${e.current}" has legacy aliases`).toBeGreaterThan(0);
      for (const a of e.legacy) expect(a.trim().length).toBeGreaterThan(0);
      expect(e.current.trim().length).toBeGreaterThan(0);
      expect(["term", "brand", "location"]).toContain(e.kind);
      expect(["confirmed", "uncertain"]).toContain(e.confidence);
    }
  });

  it("uncertain entries are surfaced for human confirmation", () => {
    const uncertain = uncertainCrosswalkEntries();
    for (const e of uncertain) expect(e.confidence).toBe("uncertain");
    expect(crosswalkByKind("brand").every((e) => e.kind === "brand")).toBe(true);
  });

  it("never maps anything back to a retired brand or a day-count Blitz", () => {
    for (const e of LEGACY_CROSSWALK) {
      expect(e.current).not.toMatch(/cherrington/i);
      expect(e.current).not.toMatch(/\b\d+\s*-?\s*day\s+blitz/i);
    }
  });
});

describe("portal navigation map", () => {
  it("every nav item has a label, an absolute path, and a description", () => {
    const items = flattenNavigationMap();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.path.startsWith("/"), `"${item.label}" path is absolute`).toBe(true);
      expect(item.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("paths are unique across the whole map", () => {
    const paths = flattenNavigationMap().map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("includes the key live destinations members ask for", () => {
    const paths = new Set(flattenNavigationMap().map((i) => i.path));
    for (const p of ["/blitz", "/apps", "/coaching", "/support", "/resource-library", "/account"]) {
      expect(paths.has(p), `nav map is missing ${p}`).toBe(true);
    }
    expect(PORTAL_NAVIGATION_MAP.some((s) => s.section === "Coaching")).toBe(true);
  });
});

describe("Operations curated docs", () => {
  const docs = buildOperationsDocs();

  it("every doc carries a complete, valid taxonomy and is shaped to be citable", () => {
    expect(docs.length).toBeGreaterThan(0);
    const slugs = docs.map((d) => d.slug);
    expect(new Set(slugs).size, "doc slugs are unique").toBe(slugs.length);
    for (const d of docs) {
      expect(d.title.trim().length).toBeGreaterThan(0);
      expect(d.content.trim().length).toBeGreaterThan(0);
      expect(isOperationsNode(d.node), `"${d.title}" → real operations node`).toBe(true);
      expect(isCeiling(d.ceiling)).toBe(true);
      expect(isHandoffTarget(d.handoff)).toBe(true);
      // Citable doc classes only (curated / overview) — never transcript.
      expect(["curated", "overview"]).toContain(d.docClass);
      expect(d.sourcePath.startsWith("/")).toBe(true);
    }
  });

  it("flags uncertain crosswalk mappings in the navigation map doc", () => {
    const navDoc = docs.find((d) => d.slug === "operations-portal-navigation-map");
    expect(navDoc, "navigation map doc exists").toBeDefined();
    const uncertain = uncertainCrosswalkEntries();
    if (uncertain.length > 0) {
      expect(navDoc!.content).toContain("needs human confirmation");
      for (const e of uncertain) {
        const line = navDoc!.content
          .split("\n")
          .find((l) => l.includes(e.current) && e.legacy.some((leg) => l.includes(leg)));
        expect(line, `crosswalk line for "${e.current}"`).toBeDefined();
        expect(line).toContain("needs human confirmation");
      }
    }
  });

  it("covers each required Operations subject", () => {
    const slugs = new Set(docs.map((d) => d.slug));
    for (const required of [
      "operations-coach-roster",
      "operations-coaching-call-hours",
      "operations-support-routing",
      "operations-refunds-overview",
      "operations-membership-basics",
      "operations-how-to-get-help",
      "operations-portal-navigation-map",
    ]) {
      expect(slugs.has(required), `missing Operations doc "${required}"`).toBe(true);
    }
  });

  it("represents both handoff targets (concept→coaching, troubleshooting→support)", () => {
    const handoffs = new Set(docs.map((d) => d.handoff));
    expect(handoffs.has("coaching")).toBe(true);
    expect(handoffs.has("support")).toBe(true);
    // The coaching destination content lives in the coaching-access node.
    expect(docs.some((d) => d.node === "coaching-access" && d.handoff === "coaching")).toBe(true);
    expect(docs.some((d) => d.node === "support" && d.handoff === "support")).toBe(true);
  });

  it("the roster doc names every real coach by first name only", () => {
    const roster = docs.find((d) => d.slug === "operations-coach-roster");
    expect(roster).toBeTruthy();
    for (const c of COACHING_ROSTER) {
      expect(roster!.content, `roster doc names ${c.name}`).toContain(c.name);
      // No surname leakage: first names only.
      expect(c.name).not.toMatch(/\s/);
    }
  });
});
