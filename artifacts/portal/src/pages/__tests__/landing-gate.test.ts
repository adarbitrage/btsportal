/**
 * Root landing gate — grant-derived branch logic (Front-End Welcome page).
 *
 * Four required states:
 *   1. FE-only buyer (front-end and/or funnel products, no tier) → Welcome
 *   2. Tier member → today's Home (unchanged)
 *   3. Upgraded member (FE product + newly granted tier) → Home next render
 *   4. No products at all → Home (unchanged)
 */
import { describe, it, expect } from "vitest";
import { isFrontendWelcomeMember } from "../Landing";

const active = (productSlug: string, expiresAt: string | null = null) => ({
  productSlug,
  status: "active",
  expiresAt,
});

describe("isFrontendWelcomeMember (root landing branch)", () => {
  it("FE-only buyer lands on the Welcome page", () => {
    expect(isFrontendWelcomeMember([active("yse_front_end")])).toBe(true);
    expect(isFrontendWelcomeMember([active("backroad")])).toBe(true);
    expect(isFrontendWelcomeMember([active("offmarket")])).toBe(true);
    expect(isFrontendWelcomeMember([active("reserve_income")])).toBe(true);
    expect(isFrontendWelcomeMember([active("silent_partner")])).toBe(true);
    expect(isFrontendWelcomeMember([active("test_like_mad")])).toBe(true);
  });

  it("funnel-only buyer (e.g. Blitz upsell) lands on the Welcome page", () => {
    expect(isFrontendWelcomeMember([active("yse_21_day_blitz")])).toBe(true);
    expect(
      isFrontendWelcomeMember([
        active("yse_front_end"),
        active("yse_profit_maximizer_pass"),
      ]),
    ).toBe(true);
  });

  it("tier member gets today's Home, byte-for-byte", () => {
    for (const tier of ["launchpad", "3month", "6month", "1year", "lifetime", "vip"]) {
      expect(isFrontendWelcomeMember([active(tier)])).toBe(false);
    }
  });

  it("upgraded member (FE + tier) flips to Home on next render", () => {
    expect(
      isFrontendWelcomeMember([active("yse_front_end"), active("launchpad")]),
    ).toBe(false);
  });

  it("no-product member is unchanged (Home)", () => {
    expect(isFrontendWelcomeMember([])).toBe(false);
    expect(isFrontendWelcomeMember(undefined)).toBe(false);
  });

  it("ignores non-active or expired grants", () => {
    expect(
      isFrontendWelcomeMember([{ productSlug: "yse_front_end", status: "refunded" }]),
    ).toBe(false);
    // Expired tier + live FE product → Welcome (tier no longer active)
    expect(
      isFrontendWelcomeMember([
        active("yse_front_end"),
        active("launchpad", "2020-01-01T00:00:00.000Z"),
      ]),
    ).toBe(true);
  });

  it("unknown slugs never trigger the Welcome branch", () => {
    expect(isFrontendWelcomeMember([active("vip_arbitrage")])).toBe(false);
  });
});
