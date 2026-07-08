import { describe, it, expect } from "vitest";
import {
  NAV_APPS,
  NAV_APP_SLUGS,
  resolveNavApp,
  detectNavActions,
  normalizeNavArea,
  NAV_GENERAL_AREA,
} from "../lib/kb-nav-vocabulary";

describe("nav vocabulary", () => {
  it("has unique slugs and valid tiers", () => {
    expect(new Set(NAV_APP_SLUGS).size).toBe(NAV_APPS.length);
    for (const app of NAV_APPS) {
      expect([1, 2]).toContain(app.tier);
      expect(app.triggers.length).toBeGreaterThan(0);
    }
  });

  it("resolveNavApp resolves known slugs and rejects unknowns", () => {
    expect(resolveNavApp(NAV_APPS[0].slug)?.slug).toBe(NAV_APPS[0].slug);
    expect(resolveNavApp("not-a-real-app")).toBeNull();
    expect(resolveNavApp(null)).toBeNull();
  });
});

describe("detectNavActions", () => {
  it("detects an action-verb-gated app mention", () => {
    const hits = detectNavActions(
      "So next you go into Flexy and click the campaigns tab, then set up your first campaign there.",
    );
    expect(hits.some((h) => h.app.slug === "flexy")).toBe(true);
  });

  it("does NOT flag a bare app mention without action language", () => {
    const hits = detectNavActions("Flexy is a great tool. Many members like Flexy.");
    expect(hits.length).toBe(0);
  });

  it("never flags ignore-listed apps", () => {
    const hits = detectNavActions(
      "Go into MaxWeb and click the offers tab, then set up your tracking link inside MaxWeb.",
    );
    expect(hits.length).toBe(0);
  });

  it("returns at most one hit per app", () => {
    const text =
      "Open Flexy and click the campaigns tab to set up your campaign. Later, go back into Flexy, click the settings menu, then navigate to billing and set up your payment.";
    const hits = detectNavActions(text).filter((h) => h.app.slug === "flexy");
    expect(hits.length).toBe(1);
    expect(hits[0].evidence.length).toBeGreaterThan(0);
  });
});

describe("normalizeNavArea", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeNavArea("  Campaign   Setup ")).toBe("campaign setup");
  });
  it("falls back to the general area", () => {
    expect(normalizeNavArea(null)).toBe(NAV_GENERAL_AREA);
    expect(normalizeNavArea("   ")).toBe(NAV_GENERAL_AREA);
  });
});
