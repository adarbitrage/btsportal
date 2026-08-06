/**
 * Front-end-only (funnel buyer) simplified nav — unit tests.
 *
 * Covers:
 *   - buildFrontendOnlyNav reduces the filtered member nav to Welcome + the
 *     "Your Purchases" dropdown folder (preserved, ownership-filtered) +
 *     other content-access-gated leaves the member passed + Account
 *     (other folders flattened, no empty shells, entitlement-only leaves
 *     dropped);
 *   - mentorship tiers / admins / coaches are never in this mode (the caller
 *     gates on the shared audience predicate — asserted here for the
 *     predicate itself);
 *   - the advisor-call nav link's hidden / cta / booked states.
 */
import { describe, it, expect } from "vitest";
import { MEMBER_NAV } from "../Sidebar";
import {
  buildFrontendOnlyNav,
  filterNavByContentAccess,
  filterNavByEntitlements,
  filterNavByHiddenRoles,
  filterNavByRole,
  filterNavByOwnedProducts,
  PURCHASES_FOLDER_STORAGE_KEY,
  type NavFolder,
  type NavLeaf,
  type NavNode,
} from "../sidebar-nav";
import { isFrontendWelcomeMember } from "@/pages/Landing";
import { getAdvisorCallNavState } from "@/hooks/use-fe-call-bar";

/** Run the exact filter pipeline Sidebar uses for a plain member. */
function memberFiltered(
  entitlements: Set<string>,
  accessiblePageKeys: Set<string>,
): NavNode[] {
  return filterNavByRole(
    filterNavByHiddenRoles(
      filterNavByContentAccess(
        filterNavByEntitlements(MEMBER_NAV, entitlements, false),
        accessiblePageKeys,
        false,
      ),
      "member",
    ),
    "member",
  );
}

const allPageKeys = new Set([
  "pillars-to-blitz",
  "blitz",
  "partner-tools",
  "resource-hub",
  "prime-corporate",
  "ad-credit",
  "become-a-coach",
]);

function allHrefs(nodes: readonly NavNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node.href);
    else out.push(...allHrefs(node.children));
  }
  return out;
}

function purchasesFolderIn(nodes: readonly NavNode[]): NavFolder | undefined {
  return nodes.find(
    (n): n is NavFolder =>
      n.kind === "folder" && n.storageKey === PURCHASES_FOLDER_STORAGE_KEY,
  );
}

describe("buildFrontendOnlyNav", () => {
  it("Blitz-style owner: Welcome, 'Your Purchases' dropdown with granted pages, Account", () => {
    // NOTE: resource-hub is deliberately absent — it is gated LaunchPad+ by
    // default now, so a front-end/funnel member's access map never grants it.
    const filtered = memberFiltered(
      new Set(), // no entitlements — funnel products grant none of the gated ones
      new Set(["pillars-to-blitz", "blitz"]),
    );
    const nav = buildFrontendOnlyNav(filtered);
    // Shape: flat Welcome, then the preserved purchases FOLDER, then flat Account.
    expect(
      nav.map((n) => (n.kind === "leaf" ? n.href : `folder:${n.storageKey}`)),
    ).toEqual(["/", `folder:${PURCHASES_FOLDER_STORAGE_KEY}`, "/account"]);
    const folder = purchasesFolderIn(nav)!;
    expect(folder.label).toBe("Your Purchases");
    expect(folder.children.map((c) => (c as NavLeaf).href)).toEqual([
      "/core-training/pillars-to-blitz",
      "/blitz",
    ]);
  });

  it("purchases folder children respect ownership filtering (front-end-only owner sees just Your Second Engine)", () => {
    // Full Sidebar pipeline including the ownership filter, as a real
    // yse_front_end-only member: owns only the front-end offer.
    const filtered = memberFiltered(
      new Set(),
      new Set(["pillars-to-blitz"]),
    );
    const owned = filterNavByOwnedProducts(filtered, new Set(["yse_front_end"]));
    const nav = buildFrontendOnlyNav(owned);
    const folder = purchasesFolderIn(nav)!;
    expect(folder.children.map((c) => (c as NavLeaf).label)).toEqual([
      "Your Second Engine",
    ]);
  });

  it("drops content pages the member's access map does not grant (resource-hub hidden without a grant)", () => {
    const nav = buildFrontendOnlyNav(
      memberFiltered(new Set(), new Set(["blitz"])),
    );
    expect(allHrefs(nav)).toEqual(["/", "/blitz", "/account"]);
    // Blitz stays inside the preserved dropdown, not flattened.
    expect(purchasesFolderIn(nav)).toBeDefined();
    expect(allHrefs(nav)).not.toContain("/resource-hub");
  });

  it("the purchases folder vanishes when the member owns/passes none of its entries", () => {
    const nav = buildFrontendOnlyNav(memberFiltered(new Set(), new Set()));
    expect(purchasesFolderIn(nav)).toBeUndefined();
    expect(allHrefs(nav)).toEqual(["/", "/account"]);
  });

  it("never includes entitlement-only or ungated tool leaves (AI Assistant, Apps, Community, Coaching...)", () => {
    // Even with every entitlement + every page key, non-content leaves other
    // than Welcome/Account are excluded from the simplified nav.
    const filtered = memberFiltered(
      new Set([
        "software:base",
        "voice:access",
        "coaching:group",
        "community:access",
        "commissions:promote",
      ]),
      allPageKeys,
    );
    const nav = buildFrontendOnlyNav(filtered);
    const hrefs = allHrefs(nav);
    for (const banned of [
      "/apps",
      "/ai-assistant",
      "/assistant/voice",
      "/compliance",
      "/coaching",
      "/community",
      "/self-promoting",
    ]) {
      expect(hrefs).not.toContain(banned);
    }
    expect(hrefs[0]).toBe("/");
    expect(hrefs[hrefs.length - 1]).toBe("/account");
    // The ONLY folder that survives is the purchases dropdown; everything
    // else is flat.
    const folders = nav.filter((n) => n.kind === "folder");
    expect(folders.map((f) => (f as NavFolder).storageKey)).toEqual([
      PURCHASES_FOLDER_STORAGE_KEY,
    ]);
  });
});

describe("front-end-only audience gate (predicate the Sidebar uses)", () => {
  const active = (slug: string) => ({ productSlug: slug, status: "active" });

  it("front-end/funnel-only member is in the audience", () => {
    expect(isFrontendWelcomeMember([active("yse_front_end")])).toBe(true);
  });

  it("mentorship tier keeps the full nav (not in audience)", () => {
    expect(
      isFrontendWelcomeMember([active("yse_front_end"), active("launchpad")]),
    ).toBe(false);
  });
});

describe("getAdvisorCallNavState", () => {
  const products = [{ productSlug: "yse_front_end", status: "active" }];
  const ok = (booking: { id: number } | null) => ({
    isSuccess: true,
    isError: false,
    data: { configured: true, booking },
  });

  it("hidden for non-members (admin/coach) and non-audience members", () => {
    expect(
      getAdvisorCallNavState({ role: "admin", products, status: ok(null) }),
    ).toBe("hidden");
    expect(
      getAdvisorCallNavState({ role: "coach", products, status: ok(null) }),
    ).toBe("hidden");
    expect(
      getAdvisorCallNavState({
        role: "member",
        products: [{ productSlug: "launchpad", status: "active" }],
        status: ok(null),
      }),
    ).toBe("hidden");
  });

  it("cta for audience member with no active booking", () => {
    expect(
      getAdvisorCallNavState({ role: "member", products, status: ok(null) }),
    ).toBe("cta");
  });

  it("cta (fail-open) while status is loading or errored — link destination is always valid", () => {
    expect(
      getAdvisorCallNavState({
        role: "member",
        products,
        status: { isSuccess: false, isError: false },
      }),
    ).toBe("cta");
    expect(
      getAdvisorCallNavState({
        role: "member",
        products,
        status: { isSuccess: false, isError: true },
      }),
    ).toBe("cta");
  });

  it("booked when an active upcoming booking exists", () => {
    expect(
      getAdvisorCallNavState({ role: "member", products, status: ok({ id: 7 }) }),
    ).toBe("booked");
  });
});
