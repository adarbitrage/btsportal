/**
 * FE "book your call" bottom bar — visibility predicate (fail-closed).
 *
 * Shows ONLY for: plain member role + Frontend-Welcome audience (active
 * FE/funnel grant, no active tier) + a SUCCESSFUL status query reporting no
 * upcoming FE-intensive booking. Everything else — admins/coaches, tier
 * members, booked members, loading, or error — hides the bar.
 */
import { describe, it, expect } from "vitest";
import { shouldShowFeCallBar } from "../use-fe-call-bar";

const active = (productSlug: string) => ({
  productSlug,
  status: "active",
  expiresAt: null,
});

const okStatus = (booking: { id: number } | null) => ({
  isSuccess: true,
  isError: false,
  data: { configured: true, booking },
});

const LOADING = { isSuccess: false, isError: false, data: undefined };
const ERRORED = { isSuccess: false, isError: true, data: undefined };

describe("shouldShowFeCallBar", () => {
  it("shows for a front-end-only member with no upcoming booking", () => {
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_front_end")],
        status: okStatus(null),
      }),
    ).toBe(true);
  });

  it("shows for a funnel-only member with no upcoming booking", () => {
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_21_day_blitz")],
        status: okStatus(null),
      }),
    ).toBe(true);
  });

  it("hides once the member has an active upcoming booking", () => {
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_front_end")],
        status: okStatus({ id: 7 }),
      }),
    ).toBe(false);
  });

  it("hides for mentorship-tier members (incl. FE + tier)", () => {
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("launchpad")],
        status: okStatus(null),
      }),
    ).toBe(false);
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_front_end"), active("launchpad")],
        status: okStatus(null),
      }),
    ).toBe(false);
  });

  it("hides for admins and coaches regardless of grants", () => {
    for (const role of ["admin", "super_admin", "coach", "support_agent"]) {
      expect(
        shouldShowFeCallBar({
          role,
          products: [active("yse_front_end")],
          status: okStatus(null),
        }),
      ).toBe(false);
    }
  });

  it("hides for members with no products and for missing role/user", () => {
    expect(
      shouldShowFeCallBar({ role: "member", products: [], status: okStatus(null) }),
    ).toBe(false);
    expect(
      shouldShowFeCallBar({ role: "member", products: undefined, status: okStatus(null) }),
    ).toBe(false);
    expect(
      shouldShowFeCallBar({
        role: undefined,
        products: [active("yse_front_end")],
        status: okStatus(null),
      }),
    ).toBe(false);
  });

  it("fails closed while the status query is loading or errored", () => {
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_front_end")],
        status: LOADING,
      }),
    ).toBe(false);
    expect(
      shouldShowFeCallBar({
        role: "member",
        products: [active("yse_front_end")],
        status: ERRORED,
      }),
    ).toBe(false);
  });
});
