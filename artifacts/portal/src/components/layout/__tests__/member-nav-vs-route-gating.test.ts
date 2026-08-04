/**
 * Nav ↔ route gating drift guard (ownership-gated navigation).
 *
 * Extends the nav-consistency guards to cover BOTH gating mechanisms:
 *   - page-key items: a sidebar leaf's `contentPageKey` must match the
 *     `ContentAccessRoute pageKey` of the route for the same href, and
 *     vice versa;
 *   - entitlement items: a sidebar leaf's `requiredEntitlement` must match
 *     the `EntitlementRoute entitlement` of the route for the same href.
 *
 * Direction of severity:
 *   - A route gated MORE strictly than its nav item is the dangerous drift —
 *     the item is visible but clicking it dead-ends in a lock/403. FAIL.
 *   - A nav item gated MORE strictly than its route is allowed (deliberate
 *     "hide the pitch from non-owners; page itself still renders/pitches"),
 *     but must be declared in NAV_ONLY_GATING below so new drift is loud.
 *
 * Route gating is parsed from App.tsx source — routes are JSX, not data, so
 * this is the cheapest reliable way to keep the two files in lockstep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MEMBER_NAV } from "../Sidebar";
import type { NavLeaf, NavNode } from "../sidebar-nav";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(__dir, "../../../App.tsx"), "utf8");

interface RouteGate {
  path: string;
  kind: "entitlement" | "pageKey" | "protected" | "other";
  key?: string;
}

function parseRoutes(src: string): Map<string, RouteGate> {
  const out = new Map<string, RouteGate>();
  const routeRe = /<Route path="([^"]+)">\{\(\) => <(\w+)([^/>]*)\/>\}<\/Route>/g;
  for (const m of src.matchAll(routeRe)) {
    const [, path, comp, attrs] = m;
    let gate: RouteGate;
    if (comp === "EntitlementRoute") {
      const key = attrs.match(/entitlement="([^"]+)"/)?.[1];
      gate = { path, kind: "entitlement", key };
    } else if (comp === "ContentAccessRoute") {
      const key = attrs.match(/pageKey="([^"]+)"/)?.[1];
      gate = { path, kind: "pageKey", key };
    } else if (comp === "ProtectedRoute") {
      gate = { path, kind: "protected" };
    } else {
      gate = { path, kind: "other" };
    }
    // First declaration wins (wouter matches in order).
    if (!out.has(path)) out.set(path, gate);
  }
  return out;
}

function collectLeaves(nodes: readonly NavNode[]): NavLeaf[] {
  const out: NavLeaf[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node);
    else out.push(...collectLeaves(node.children));
  }
  return out;
}

/**
 * Deliberate nav-stricter-than-route gating: the nav hides a pitch/feature
 * item from members without the entitlement, while the page itself stays
 * reachable (it renders its own pitch/locked state). Add entries here ONLY
 * for intentional decisions.
 */
const NAV_ONLY_GATING: Record<string, string> = {
  "/va-calls": "coaching:group",
  "/self-promoting": "commissions:*",
  "/community": "community:access",
  // Pitch items hidden from non-coaching members; pages still render their
  // own pitch for direct visitors (deliberate, per adman3838 2026-08-04).
  "/coaching/book-session": "coaching:group",
  "/coaching/partner-calls": "coaching:group",
  "/concierge": "coaching:group",
};

const routes = parseRoutes(appSource);
const memberLeaves = collectLeaves(MEMBER_NAV).filter((l) => !l.requiredPermission);

describe("member nav ↔ App.tsx route gating drift guard", () => {
  it("parsed a sane number of routes from App.tsx", () => {
    expect(routes.size).toBeGreaterThan(30);
  });

  it("every entitlement-gated route with a sidebar item has matching (or stricter-nav) gating", () => {
    const problems: string[] = [];
    for (const leaf of memberLeaves) {
      const route = routes.get(leaf.href);
      if (!route) continue; // folder hubs / hrefs without a directly-matching route
      if (route.kind === "entitlement") {
        if (leaf.requiredEntitlement !== route.key) {
          problems.push(
            `${leaf.href}: route requires "${route.key}" but nav requires "${leaf.requiredEntitlement ?? "nothing"}" — visible item would 403/lock on click`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every page-key-gated route with a sidebar item has a matching contentPageKey", () => {
    const problems: string[] = [];
    for (const leaf of memberLeaves) {
      const route = routes.get(leaf.href);
      if (!route) continue;
      if (route.kind === "pageKey") {
        if (leaf.contentPageKey !== route.key) {
          problems.push(
            `${leaf.href}: route gated on pageKey "${route.key}" but nav declares "${leaf.contentPageKey ?? "nothing"}"`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("nav-side gating on an ungated route is declared in NAV_ONLY_GATING", () => {
    const problems: string[] = [];
    for (const leaf of memberLeaves) {
      const route = routes.get(leaf.href);
      if (!route) continue;
      if (route.kind === "protected" && leaf.requiredEntitlement) {
        if (NAV_ONLY_GATING[leaf.href] !== leaf.requiredEntitlement) {
          problems.push(
            `${leaf.href}: nav requires "${leaf.requiredEntitlement}" but route is only ProtectedRoute — declare it in NAV_ONLY_GATING if deliberate`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("NAV_ONLY_GATING stays accurate (no stale entries)", () => {
    for (const [href, key] of Object.entries(NAV_ONLY_GATING)) {
      const leaf = memberLeaves.find((l) => l.href === href);
      // Leaf may not exist if the item was removed; that's stale.
      expect(leaf, `${href} in NAV_ONLY_GATING but not in MEMBER_NAV`).toBeTruthy();
      expect(leaf?.requiredEntitlement, `${href} nav entitlement changed`).toBe(key);
      const route = routes.get(href);
      expect(route, `${href} has no route in App.tsx`).toBeTruthy();
    }
  });
});
