import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_NAV } from "./Sidebar";
import {
  filterNavByEntitlements,
  filterNavByHiddenRoles,
  type NavLeaf,
  type NavNode,
} from "./sidebar-nav";

const APP_TSX_PATH = path.resolve(__dirname, "..", "..", "App.tsx");
const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");

describe("App.tsx community and DM routes", () => {
  const expectedRoutes = [
    "/community",
    "/community/:postId",
    "/dm",
    "/dm/:threadId",
  ];

  for (const route of expectedRoutes) {
    it(`registers a <Route path="${route}"> in App.tsx`, () => {
      expect(APP_TSX).toContain(`path="${route}"`);
    });
  }
});

function collectLeaves(nodes: NavNode[]): NavLeaf[] {
  const out: NavLeaf[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node);
    else out.push(...collectLeaves(node.children));
  }
  return out;
}

function visibleHrefsForUser(
  entitlements: Set<string>,
  role: string | undefined,
): string[] {
  const filtered = filterNavByHiddenRoles(
    filterNavByEntitlements(MEMBER_NAV, entitlements),
    role,
  );
  return collectLeaves(filtered).map((l) => l.href);
}

describe("MEMBER_NAV community and messages wiring", () => {
  it("declares the Community leaf with community:access entitlement and no hiddenForRoles", () => {
    const community = collectLeaves(MEMBER_NAV).find(
      (l) => l.href === "/community",
    );
    expect(community).toBeDefined();
    expect(community!.label).toBe("Community");
    expect(community!.requiredEntitlement).toBe("community:access");
    expect(community!.hiddenForRoles ?? []).toEqual([]);
  });

  it("declares the Messages leaf hidden for coaches with no entitlement gate", () => {
    const messages = collectLeaves(MEMBER_NAV).find((l) => l.href === "/dm");
    expect(messages).toBeDefined();
    expect(messages!.label).toBe("Messages");
    expect(messages!.requiredEntitlement).toBeUndefined();
    expect(messages!.hiddenForRoles).toEqual(["coach"]);
  });
});

describe("Sidebar nav filtering for community/DM by role and entitlement", () => {
  it("a user with community:access sees both Community and Messages", () => {
    const hrefs = visibleHrefsForUser(
      new Set(["community:access"]),
      "free_member",
    );
    expect(hrefs).toContain("/community");
    expect(hrefs).toContain("/dm");
  });

  it("a user without community:access sees Messages but not Community", () => {
    const hrefs = visibleHrefsForUser(new Set(), "free_member");
    expect(hrefs).not.toContain("/community");
    expect(hrefs).toContain("/dm");
  });

  it("a coach sees neither Community nor Messages", () => {
    // Coaches typically don't have community:access; even if they did, Messages
    // is hidden for the coach role.
    const hrefs = visibleHrefsForUser(new Set(), "coach");
    expect(hrefs).not.toContain("/community");
    expect(hrefs).not.toContain("/dm");

    const hrefsWithAccess = visibleHrefsForUser(
      new Set(["community:access"]),
      "coach",
    );
    // Coach role hides Messages regardless of entitlement.
    expect(hrefsWithAccess).not.toContain("/dm");
  });

  it("an admin (with community:access) sees both Community and Messages", () => {
    const hrefs = visibleHrefsForUser(
      new Set(["community:access"]),
      "super_admin",
    );
    expect(hrefs).toContain("/community");
    expect(hrefs).toContain("/dm");
  });
});
