import { describe, expect, it } from "vitest";
import {
  filterNavByEntitlements,
  filterNavByRole,
  hasEntitlementCheck,
  type NavLeaf,
  type NavNode,
} from "./sidebar-nav";

const stubIcon = (() => null) as unknown as NavLeaf["icon"];

function leaf(
  href: string,
  extras: Partial<Omit<NavLeaf, "kind" | "href" | "label" | "icon">> = {},
): NavLeaf {
  return {
    kind: "leaf",
    href,
    label: href,
    icon: stubIcon,
    ...extras,
  };
}

function folder(
  storageKey: string,
  children: NavNode[],
): NavNode {
  return {
    kind: "folder",
    storageKey,
    label: storageKey,
    icon: stubIcon,
    children,
  };
}

describe("hasEntitlementCheck", () => {
  it("returns true when no entitlement is required", () => {
    expect(hasEntitlementCheck(undefined, new Set())).toBe(true);
    expect(hasEntitlementCheck(undefined, new Set(["anything"]))).toBe(true);
  });

  it("returns true when the exact entitlement is present", () => {
    expect(
      hasEntitlementCheck("community:access", new Set(["community:access"])),
    ).toBe(true);
  });

  it("returns false when the exact entitlement is missing", () => {
    expect(
      hasEntitlementCheck("community:access", new Set(["software:base"])),
    ).toBe(false);
  });

  it("returns false when the entitlement set is empty", () => {
    expect(hasEntitlementCheck("community:access", new Set())).toBe(false);
  });

  it("matches wildcard entitlements against any entitlement with the prefix", () => {
    expect(
      hasEntitlementCheck(
        "coaching:one_on_one:*",
        new Set(["coaching:one_on_one:3month"]),
      ),
    ).toBe(true);
    expect(
      hasEntitlementCheck("commissions:*", new Set(["commissions:lifetime"])),
    ).toBe(true);
  });

  it("does not match wildcard entitlements when no entitlement shares the prefix", () => {
    expect(
      hasEntitlementCheck(
        "coaching:one_on_one:*",
        new Set(["coaching:group", "community:access"]),
      ),
    ).toBe(false);
  });

  it("wildcard prefix is exact: a prefix that doesn't end with ':' won't accidentally match", () => {
    // "coaching:*" should match "coaching:group", not "coachingother"
    expect(
      hasEntitlementCheck("coaching:*", new Set(["coachingother"])),
    ).toBe(false);
    expect(
      hasEntitlementCheck("coaching:*", new Set(["coaching:group"])),
    ).toBe(true);
  });
});

describe("filterNavByEntitlements", () => {
  it("keeps leaves with no required entitlement", () => {
    const nav: NavNode[] = [leaf("/dashboard"), leaf("/wins")];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result).toHaveLength(2);
    expect(result.map((n) => (n as NavLeaf).href)).toEqual([
      "/dashboard",
      "/wins",
    ]);
  });

  it("filters out leaves whose required entitlement the member lacks", () => {
    const nav: NavNode[] = [
      leaf("/community", { requiredEntitlement: "community:access" }),
      leaf("/dashboard"),
    ];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result.map((n) => (n as NavLeaf).href)).toEqual(["/dashboard"]);
  });

  it("keeps leaves whose required entitlement the member has", () => {
    const nav: NavNode[] = [
      leaf("/community", { requiredEntitlement: "community:access" }),
    ];
    const result = filterNavByEntitlements(
      nav,
      new Set(["community:access"]),
    );
    expect(result).toHaveLength(1);
    expect((result[0] as NavLeaf).href).toBe("/community");
  });

  it("matches wildcard entitlements (e.g. coaching:one_on_one:*)", () => {
    const nav: NavNode[] = [
      leaf("/coaching/one-on-one", {
        requiredEntitlement: "coaching:one_on_one:*",
      }),
    ];
    const withWildcard = filterNavByEntitlements(
      nav,
      new Set(["coaching:one_on_one:6month"]),
    );
    expect(withWildcard).toHaveLength(1);

    const withoutWildcard = filterNavByEntitlements(
      nav,
      new Set(["coaching:group"]),
    );
    expect(withoutWildcard).toHaveLength(0);
  });

  it("removes folders where every child is filtered out (empty-folder cascade)", () => {
    const nav: NavNode[] = [
      folder("earn", [
        leaf("/commissions", { requiredEntitlement: "commissions:*" }),
        leaf("/self-promoting", {
          requiredEntitlement: "commissions:*",
        }),
      ]),
    ];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result).toEqual([]);
  });

  it("keeps folders that retain at least one allowed child", () => {
    const nav: NavNode[] = [
      folder("earn", [
        leaf("/commissions", { requiredEntitlement: "commissions:*" }),
        leaf("/ad-credit"),
      ]),
    ];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result).toHaveLength(1);
    const earn = result[0];
    expect(earn.kind).toBe("folder");
    if (earn.kind !== "folder") throw new Error("expected folder");
    expect(earn.children).toHaveLength(1);
    expect((earn.children[0] as NavLeaf).href).toBe("/ad-credit");
  });

  it("does not mutate the original folder's children", () => {
    const earnFolder = folder("earn", [
      leaf("/commissions", { requiredEntitlement: "commissions:*" }),
      leaf("/ad-credit"),
    ]);
    const nav: NavNode[] = [earnFolder];
    const result = filterNavByEntitlements(nav, new Set());
    if (earnFolder.kind !== "folder") throw new Error("expected folder");
    expect(earnFolder.children).toHaveLength(2);
    expect(result).not.toBe(nav);
  });

  it("recursively filters nested folders and removes empty parents", () => {
    const nav: NavNode[] = [
      folder("outer", [
        folder("inner", [
          leaf("/locked", { requiredEntitlement: "premium:access" }),
        ]),
      ]),
    ];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result).toEqual([]);
  });

  it("recursively keeps nested folders when at least one descendant survives", () => {
    const nav: NavNode[] = [
      folder("outer", [
        folder("inner", [
          leaf("/locked", { requiredEntitlement: "premium:access" }),
          leaf("/free"),
        ]),
      ]),
    ];
    const result = filterNavByEntitlements(nav, new Set());
    expect(result).toHaveLength(1);
    const outer = result[0];
    if (outer.kind !== "folder") throw new Error("expected folder");
    expect(outer.children).toHaveLength(1);
    const inner = outer.children[0];
    if (inner.kind !== "folder") throw new Error("expected folder");
    expect(inner.children).toHaveLength(1);
    expect((inner.children[0] as NavLeaf).href).toBe("/free");
  });
});

describe("filterNavByRole", () => {
  it("keeps leaves with no required permission", () => {
    const nav: NavNode[] = [leaf("/help")];
    expect(filterNavByRole(nav, undefined)).toHaveLength(1);
    expect(filterNavByRole(nav, "anything")).toHaveLength(1);
  });

  it("filters out leaves requiring a permission when the user has no admin role", () => {
    const nav: NavNode[] = [
      leaf("/admin/members", { requiredPermission: "members:view" }),
    ];
    expect(filterNavByRole(nav, undefined)).toEqual([]);
    expect(filterNavByRole(nav, "")).toEqual([]);
    expect(filterNavByRole(nav, "free_member")).toEqual([]);
  });

  it("keeps leaves whose required permission the role has", () => {
    const nav: NavNode[] = [
      leaf("/admin/members", { requiredPermission: "members:view" }),
    ];
    const result = filterNavByRole(nav, "support_agent");
    expect(result).toHaveLength(1);
  });

  it("filters out leaves whose permission the role lacks", () => {
    // support_agent does not have settings:manage
    const nav: NavNode[] = [
      leaf("/admin/settings", { requiredPermission: "settings:manage" }),
    ];
    expect(filterNavByRole(nav, "support_agent")).toEqual([]);
    expect(filterNavByRole(nav, "super_admin")).toHaveLength(1);
  });

  it("removes admin folders whose children are all filtered out", () => {
    // support_agent cannot view coaching
    const nav: NavNode[] = [
      folder("admin-coaching", [
        leaf("/admin/coaching/availability", {
          requiredPermission: "coaching:manage",
        }),
        leaf("/admin/coaching", {
          requiredPermission: "coaching:view",
        }),
      ]),
    ];
    expect(filterNavByRole(nav, "support_agent")).toEqual([]);
  });

  it("keeps admin folders that retain at least one allowed child", () => {
    const nav: NavNode[] = [
      folder("admin-support", [
        leaf("/admin/tickets", {
          requiredPermission: "tickets:view",
        }),
        leaf("/admin/agent-performance", {
          requiredPermission: "members:edit",
        }),
      ]),
    ];
    const result = filterNavByRole(nav, "support_agent");
    expect(result).toHaveLength(1);
    const supportFolder = result[0];
    if (supportFolder.kind !== "folder") throw new Error("expected folder");
    expect(supportFolder.children).toHaveLength(1);
    expect((supportFolder.children[0] as NavLeaf).href).toBe("/admin/tickets");
  });

  it("recursively filters nested folders", () => {
    const nav: NavNode[] = [
      folder("outer", [
        folder("inner", [
          leaf("/admin/locked", {
            requiredPermission: "settings:manage",
          }),
        ]),
      ]),
    ];
    expect(filterNavByRole(nav, "support_agent")).toEqual([]);
    expect(filterNavByRole(nav, "super_admin")).toHaveLength(1);
  });
});
