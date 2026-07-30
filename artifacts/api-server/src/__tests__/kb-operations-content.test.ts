import { describe, it, expect } from "vitest";
import {
  LEGACY_CROSSWALK,
  crosswalkByKind,
  uncertainCrosswalkEntries,
} from "../lib/kb-legacy-crosswalk";
import {
  PORTAL_NAVIGATION_MAP,
  flattenNavigationMap,
} from "../lib/kb-portal-navigation-map";

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
    for (const p of ["/blitz", "/apps", "/coaching", "/support", "/resource-hub", "/account"]) {
      expect(paths.has(p), `nav map is missing ${p}`).toBe(true);
    }
    expect(PORTAL_NAVIGATION_MAP.some((s) => s.section === "Coaching")).toBe(true);
  });
});
