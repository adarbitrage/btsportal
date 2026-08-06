/**
 * Front-end-only (funnel buyer) simplified nav — unit tests.
 *
 * Covers:
 *   - buildFrontendOnlyNav reduces the filtered member nav to a flat list of
 *     Welcome + content-access-gated leaves the member passed + Account
 *     (folders flattened, no empty shells, entitlement-only leaves dropped);
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

describe("buildFrontendOnlyNav", () => {
  it("Blitz-style owner: flat Welcome + granted content pages + Account, nothing else", () => {
    const filtered = memberFiltered(
      new Set(), // no entitlements — funnel products grant none of the gated ones
      new Set(["pillars-to-blitz", "blitz", "resource-hub"]),
    );
    const nav = buildFrontendOnlyNav(filtered);
    expect(nav.every((n) => n.kind === "leaf")).toBe(true);
    expect(nav.map((l) => l.href)).toEqual([
      "/",
      "/core-training/pillars-to-blitz",
      "/blitz",
      "/resource-hub",
      "/account",
    ]);
  });

  it("drops content pages the member's access map does not grant", () => {
    const nav = buildFrontendOnlyNav(
      memberFiltered(new Set(), new Set(["resource-hub"])),
    );
    expect(nav.map((l) => l.href)).toEqual(["/", "/resource-hub", "/account"]);
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
    const hrefs = nav.map((l) => l.href);
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
    // No folders survive — flat list only.
    expect(nav.every((n) => n.kind === "leaf")).toBe(true);
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
