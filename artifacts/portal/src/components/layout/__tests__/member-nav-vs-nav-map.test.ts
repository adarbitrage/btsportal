/**
 * Two-way drift guard: member sidebar (MEMBER_NAV) ↔ shared portal nav map
 * (@workspace/portal-nav-map) — Task #1778, step 5.
 *
 * The nav map grounds AI truth-doc synthesis and answer-time navigation, so it
 * must always mirror the REAL member sidebar:
 *   1. every member-visible sidebar leaf must exist in the nav map,
 *   2. every nav-map path must exist in the sidebar (or be an explicit,
 *      deliberate NAV_MAP_ONLY_PATHS entry),
 *   3. the nav map must never contain a staff route (/admin, /coach, /partner),
 *      and no staff sidebar entry may leak into it.
 *
 * Runs in the portal "test" validation gate, so a sidebar change that isn't
 * reflected in the map (or vice versa) fails CI.
 */

import { describe, it, expect } from "vitest";
import {
  flattenNavigationMap,
  NAV_MAP_ONLY_PATHS,
  isStaffRoutePath,
} from "@workspace/portal-nav-map";
import { MEMBER_NAV, ADMIN_CHILDREN, COACH_NAV_NODES, PARTNER_NAV_NODES } from "../Sidebar";
import type { NavLeaf, NavNode } from "../sidebar-nav";

function collectLeaves(nodes: readonly NavNode[]): NavLeaf[] {
  const out: NavLeaf[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node);
    else out.push(...collectLeaves(node.children));
  }
  return out;
}

// Member-visible leaves: exclude entries locked behind a staff PERMISSION
// (e.g. /dm is temporarily admin-only). Entitlement gating and coach-hiding
// (hiddenForRoles) still mean members can see the page, so those stay in.
const memberLeaves = collectLeaves(MEMBER_NAV).filter((l) => !l.requiredPermission);
const memberHrefs = new Set(memberLeaves.map((l) => l.href));
const mapItems = flattenNavigationMap();
const mapPaths = new Set(mapItems.map((i) => i.path));

const stripTrademarks = (s: string) => s.replace(/[™®]/g, "").trim();

describe("MEMBER_NAV ↔ portal nav map drift guard", () => {
  it("every member-visible sidebar leaf is in the nav map", () => {
    const missing = memberLeaves.filter((l) => !mapPaths.has(l.href));
    expect(
      missing.map((l) => `${l.label} (${l.href})`),
      "Sidebar pages missing from @workspace/portal-nav-map — add them so the AI can direct members there",
    ).toEqual([]);
  });

  it("every nav-map path exists in the sidebar (or is an explicit map-only page)", () => {
    const unknown = mapItems.filter(
      (i) => !memberHrefs.has(i.path) && !NAV_MAP_ONLY_PATHS.includes(i.path),
    );
    expect(
      unknown.map((i) => `${i.label} (${i.path})`),
      "Nav-map entries that no longer exist in the member sidebar — remove or move to NAV_MAP_ONLY_PATHS only if the page is still reachable",
    ).toEqual([]);
  });

  it("sidebar labels match nav-map labels for the same path (modulo ™)", () => {
    const mismatched: string[] = [];
    for (const leaf of memberLeaves) {
      const item = mapItems.find((i) => i.path === leaf.href);
      if (item && stripTrademarks(item.label) !== stripTrademarks(leaf.label)) {
        mismatched.push(`${leaf.href}: sidebar "${leaf.label}" vs map "${item.label}"`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("nav map contains no staff routes", () => {
    const staff = mapItems.filter((i) => isStaffRoutePath(i.path));
    expect(staff.map((i) => i.path)).toEqual([]);
  });

  it("isStaffRoutePath rejects staff prefixes but allows member lookalikes", () => {
    expect(isStaffRoutePath("/admin")).toBe(true);
    expect(isStaffRoutePath("/admin/dashboard")).toBe(true);
    expect(isStaffRoutePath("/coach/group-calls")).toBe(true);
    expect(isStaffRoutePath("/partner/roster")).toBe(true);
    // Member routes that merely share a prefix string must NOT match.
    expect(isStaffRoutePath("/coaching")).toBe(false);
    expect(isStaffRoutePath("/coaching/book-session")).toBe(false);
    expect(isStaffRoutePath("/partner-tools")).toBe(false);
  });

  it("no staff sidebar entry leaks into the nav map", () => {
    const staffHrefs = collectLeaves([
      ...ADMIN_CHILDREN,
      ...COACH_NAV_NODES,
      ...PARTNER_NAV_NODES,
    ]).map((l) => l.href);
    const leaked = staffHrefs.filter((href) => mapPaths.has(href));
    expect(leaked).toEqual([]);
  });

  it("NAV_MAP_ONLY_PATHS entries actually exist in the map and stay deliberate", () => {
    for (const path of NAV_MAP_ONLY_PATHS) {
      expect(mapPaths.has(path), `${path} allow-listed but not in the map`).toBe(true);
      expect(memberHrefs.has(path), `${path} is now in the sidebar — remove it from NAV_MAP_ONLY_PATHS`).toBe(false);
    }
  });
});
