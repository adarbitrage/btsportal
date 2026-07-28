import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBER_NAV } from "./Sidebar";
import {
  filterNavByEntitlements,
  filterNavByHiddenRoles,
  filterNavByRole,
  type NavLeaf,
  type NavNode,
} from "./sidebar-nav";

const APP_TSX_PATH = path.resolve(__dirname, "..", "..", "App.tsx");
const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");

describe("App.tsx community routes", () => {
  const expectedRoutes = ["/community", "/community/:postId"];

  for (const route of expectedRoutes) {
    it(`registers a <Route path="${route}"> in App.tsx`, () => {
      expect(APP_TSX).toContain(`path="${route}"`);
    });
  }

  it("does not register any DM/messages routes (feature removed)", () => {
    expect(APP_TSX).not.toContain('path="/dm"');
    expect(APP_TSX).not.toContain('path="/dm/:threadId"');
    expect(APP_TSX).not.toContain('path="/coach/messages"');
    expect(APP_TSX).not.toContain('path="/coach/messages/:threadId"');
  });
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
  const filtered = filterNavByRole(
    filterNavByHiddenRoles(
      filterNavByEntitlements(MEMBER_NAV, entitlements),
      role,
    ),
    role,
  );
  return collectLeaves(filtered).map((l) => l.href);
}

describe("MEMBER_NAV community wiring", () => {
  it("declares the Community leaf with community:access entitlement and no hiddenForRoles", () => {
    const community = collectLeaves(MEMBER_NAV).find(
      (l) => l.href === "/community",
    );
    expect(community).toBeDefined();
    expect(community!.label).toBe("Community");
    expect(community!.requiredEntitlement).toBe("community:access");
    expect(community!.hiddenForRoles ?? []).toEqual([]);
  });

  it("declares no Messages/DM leaf (feature removed)", () => {
    const dm = collectLeaves(MEMBER_NAV).find((l) => l.href === "/dm");
    expect(dm).toBeUndefined();
  });
});

describe("Sidebar nav filtering for community by role and entitlement", () => {
  it("a member with community:access sees Community", () => {
    const hrefs = visibleHrefsForUser(
      new Set(["community:access"]),
      "free_member",
    );
    expect(hrefs).toContain("/community");
  });

  it("a member without community:access does not see Community", () => {
    const hrefs = visibleHrefsForUser(new Set(), "free_member");
    expect(hrefs).not.toContain("/community");
  });

  it("an admin with community:access sees Community", () => {
    const hrefs = visibleHrefsForUser(
      new Set(["community:access"]),
      "super_admin",
    );
    expect(hrefs).toContain("/community");
  });
});
