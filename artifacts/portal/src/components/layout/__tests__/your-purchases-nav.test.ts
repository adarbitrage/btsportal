/**
 * "Your Purchases" sidebar folder — ownership-driven visibility.
 *
 * The old "7 Pillars" Training leaf is replaced by a "Your Purchases" folder
 * whose children are the member's purchased offers under their real product
 * names (front-end offer → "Your Second Engine"). Children are gated by
 * `ownedProductSlugs` via filterNavByOwnedProducts; the folder disappears
 * when the member owns none of the mapped offers; admins/coaches bypass.
 */
import { describe, it, expect } from "vitest";
import { MEMBER_NAV } from "../Sidebar";
import {
  filterNavByOwnedProducts,
  getActiveOwnedProductSlugs,
  PURCHASE_OWNER_SLUGS,
  type NavFolder,
  type NavLeaf,
  type NavNode,
} from "../sidebar-nav";

function collectLeaves(nodes: readonly NavNode[]): NavLeaf[] {
  const out: NavLeaf[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node);
    else out.push(...collectLeaves(node.children));
  }
  return out;
}

const purchasesFolder = MEMBER_NAV.find(
  (n): n is NavFolder => n.kind === "folder" && n.label === "Your Purchases",
);

describe("MEMBER_NAV structure", () => {
  it("has a 'Your Purchases' folder and no '7 Pillars' label anywhere", () => {
    expect(purchasesFolder).toBeDefined();
    expect(collectLeaves(MEMBER_NAV).map((l) => l.label)).not.toContain("7 Pillars");
    expect(MEMBER_NAV.some((n) => n.kind === "folder" && n.label === "Training")).toBe(false);
  });

  it("maps the front-end offer to 'Your Second Engine' → the Seven Pillars page", () => {
    const yse = purchasesFolder!.children.find(
      (c): c is NavLeaf => c.kind === "leaf" && c.label === "Your Second Engine",
    );
    expect(yse).toBeDefined();
    expect(yse!.href).toBe("/core-training/pillars-to-blitz");
    expect(yse!.contentPageKey).toBe("pillars-to-blitz");
    expect(yse!.ownedProductSlugs).toEqual(PURCHASE_OWNER_SLUGS.yourSecondEngine);
  });

  it("keeps The Blitz™ under purchases with its ownership slugs", () => {
    const blitz = purchasesFolder!.children.find(
      (c): c is NavLeaf => c.kind === "leaf" && c.href === "/blitz",
    );
    expect(blitz).toBeDefined();
    expect(blitz!.label).toBe("The Blitz™");
    expect(blitz!.ownedProductSlugs).toEqual(PURCHASE_OWNER_SLUGS.blitz);
  });
});

describe("filterNavByOwnedProducts", () => {
  it("shows only owned entries; unowned ones are dropped", () => {
    const filtered = filterNavByOwnedProducts(MEMBER_NAV, new Set(["yse_front_end"]));
    const folder = filtered.find(
      (n): n is NavFolder => n.kind === "folder" && n.label === "Your Purchases",
    );
    expect(folder).toBeDefined();
    const labels = folder!.children.map((c) => (c as NavLeaf).label);
    expect(labels).toEqual(["Your Second Engine"]);
  });

  it("a mentorship tier owns both entries", () => {
    const filtered = filterNavByOwnedProducts(MEMBER_NAV, new Set(["launchpad"]));
    const folder = filtered.find(
      (n): n is NavFolder => n.kind === "folder" && n.label === "Your Purchases",
    );
    expect(folder!.children.map((c) => (c as NavLeaf).label)).toEqual([
      "Your Second Engine",
      "The Blitz™",
    ]);
  });

  it("the empty folder disappears when the member owns nothing mapped", () => {
    const filtered = filterNavByOwnedProducts(MEMBER_NAV, new Set());
    expect(
      filtered.some((n) => n.kind === "folder" && n.label === "Your Purchases"),
    ).toBe(false);
    // Ungated leaves/folders are untouched.
    expect(filtered.some((n) => n.kind === "leaf" && n.href === "/account")).toBe(true);
  });

  it("admin/coach bypass keeps every entry", () => {
    const filtered = filterNavByOwnedProducts(MEMBER_NAV, new Set(), true);
    const folder = filtered.find(
      (n): n is NavFolder => n.kind === "folder" && n.label === "Your Purchases",
    );
    expect(folder!.children).toHaveLength(2);
  });
});

describe("getActiveOwnedProductSlugs", () => {
  const now = new Date("2026-08-06T00:00:00Z").getTime();

  it("keeps active unexpired grants, drops expired/inactive ones", () => {
    const slugs = getActiveOwnedProductSlugs(
      [
        { productSlug: "yse_front_end", status: "active", expiresAt: null },
        { productSlug: "yse_21_day_blitz", status: "active", expiresAt: "2026-01-01T00:00:00Z" },
        { productSlug: "launchpad", status: "revoked" },
        { productSlug: "3month", status: "active", expiresAt: "2027-01-01T00:00:00Z" },
      ],
      now,
    );
    expect(slugs).toEqual(new Set(["yse_front_end", "3month"]));
  });

  it("handles undefined products", () => {
    expect(getActiveOwnedProductSlugs(undefined, now)).toEqual(new Set());
  });
});
