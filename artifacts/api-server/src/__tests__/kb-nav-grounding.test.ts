/**
 * Navigation grounding for KB synthesis (Task #1778): prompt section contract,
 * deterministic post-draft legacy-location screen, and the marker lockstep
 * with kb-review-risk.
 */

import { describe, it, expect } from "vitest";
import {
  NAV_CONFLICT_MARKER,
  buildNavigationGroundingSection,
  screenDraftForLegacyNavigation,
  applyNavigationScreen,
  getNavMapVersion,
} from "../lib/kb-nav-grounding";
import {
  NAV_CONFLICT_PREFIX,
  analyzeDraftForReview,
  hasNavigationConflictMarker,
} from "../lib/kb-review-risk";
import {
  flattenNavigationMap,
  computeNavMapVersion,
  diffNavMaps,
  changeReferenceTokens,
  isStaffRoutePath,
  canonicalNavMapSnapshot,
  type NavItem,
} from "@workspace/portal-nav-map";

describe("NAV_CONFLICT_MARKER lockstep", () => {
  it("marker contains the kb-review-risk mirror prefix", () => {
    expect(NAV_CONFLICT_MARKER).toContain(NAV_CONFLICT_PREFIX);
  });

  it("a screen-produced callout is detected by review-risk highlights + flag detector", () => {
    const body = applyNavigationScreen("Head to General Support and open a ticket.");
    expect(hasNavigationConflictMarker(body)).toBe(true);
    const highlights = analyzeDraftForReview(body);
    expect(highlights.some((h) => h.kind === "navigation_conflict")).toBe(true);
  });
});

describe("buildNavigationGroundingSection", () => {
  const section = buildNavigationGroundingSection();

  it("contains every nav-map page label and path", () => {
    for (const item of flattenNavigationMap()) {
      expect(section).toContain(item.label);
      expect(section).toContain(item.path);
    }
  });

  it("lists the confirmed General Support → Support rewrite rule", () => {
    expect(section).toContain("General Support");
    expect(section).toContain("Support (/support)");
  });

  it("lists Ask the Masters as uncertain (adjudicate, do not silently rewrite)", () => {
    expect(section).toContain("Ask the Masters");
    expect(section).toContain(NAV_CONFLICT_MARKER);
  });

  it("never directs to staff areas", () => {
    for (const item of flattenNavigationMap()) {
      expect(isStaffRoutePath(item.path)).toBe(false);
    }
    expect(section).toContain("never direct members to admin, coach or partner areas");
  });
});

describe("screenDraftForLegacyNavigation / applyNavigationScreen", () => {
  it("flags a surviving 'Ask the Masters' reference — never published silently", () => {
    const draft = "Post your question in Ask the Masters and a coach will answer.";
    const matches = screenDraftForLegacyNavigation(draft);
    expect(matches.map((m) => m.phrase.toLowerCase())).toContain("ask the masters");
    const out = applyNavigationScreen(draft);
    expect(out).toContain(NAV_CONFLICT_MARKER);
    expect(out).toContain('"Ask the Masters"');
    expect(out).toContain("NOT confirmed");
  });

  it("flags a surviving 'General Support' reference with the confirmed current location", () => {
    const out = applyNavigationScreen("Contact General Support if you're stuck.");
    expect(out).toContain(NAV_CONFLICT_MARKER);
    expect(out).toContain("Support (/support)");
    expect(out).not.toContain("NOT confirmed");
  });

  it("matches whole phrases case-insensitively, not substrings", () => {
    expect(screenDraftForLegacyNavigation("ask the masters section")).toHaveLength(1);
    // "generally supportive" must not match "General Support".
    expect(screenDraftForLegacyNavigation("The team is generally supportive.")).toHaveLength(0);
  });

  it("returns the draft unchanged when clean", () => {
    const clean = "Open the Support page (/support) and start a ticket.";
    expect(applyNavigationScreen(clean)).toBe(clean);
  });

  it("is idempotent — re-screening never re-flags its own callouts", () => {
    const once = applyNavigationScreen("Go to Ask the Masters.");
    const twice = applyNavigationScreen(once);
    // The original line still matches, but the callout must be deduped to one
    // distinct phrase and the callout line itself skipped.
    const markers = twice.split("\n").filter((l) => l.includes(NAV_CONFLICT_MARKER));
    expect(markers).toHaveLength(1);
  });
});

describe("nav-map versioning + diff (shared lib)", () => {
  it("getNavMapVersion matches the lib hash and is stable", () => {
    expect(getNavMapVersion()).toBe(computeNavMapVersion());
    expect(getNavMapVersion()).toBe(getNavMapVersion());
  });

  it("diffNavMaps detects removed/renamed items and emits reference tokens", () => {
    const current = canonicalNavMapSnapshot();
    const old: NavItem[] = [
      ...current,
      { label: "Ask the Masters", path: "/ask-the-masters", description: "Legacy Q&A" },
    ];
    const changes = diffNavMaps(old, current);
    const removed = changes.find((c) => c.kind === "removed");
    expect(removed?.oldLabel).toBe("Ask the Masters");
    const tokens = changeReferenceTokens(changes);
    expect(tokens).toContain("Ask the Masters");
    expect(tokens).toContain("/ask-the-masters");
  });

  it("identical maps diff to no changes", () => {
    const snap = canonicalNavMapSnapshot();
    expect(diffNavMaps(snap, snap)).toEqual([]);
  });
});
