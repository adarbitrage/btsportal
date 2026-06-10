import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// After a member finishes checkout at the cart provider, the browser is bounced
// back into the SPA at the `returnPath` the Plans page asked for
// (`/plans?upgraded=1`). This test pins the *resolved* destination of that
// return trip: the member must land back on the Plans page with the
// "Thanks for upgrading!" confirmation — and must NOT be redirected away from
// the upgrade screen. A regression that strands the member elsewhere (or fires
// a redirect off the page) would lose the purchase confirmation.
//
// We reuse the wouter <Redirect> stub pattern from onboardingGate.test.tsx:
// every route-guard bounce renders <Redirect/>, so a marker node lets us assert
// that *no* redirect fired while the member sits on the post-upgrade screen.
let currentLocation = "/plans?upgraded=1";
vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, vi.fn()],
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const useGetCurrentMember = vi.fn();
const useListPlans = vi.fn();
const startCheckoutMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  useListPlans: () => useListPlans(),
  useStartMemberCheckout: () => ({ mutate: startCheckoutMutate }),
  getGetCurrentMemberQueryKey: () => ["/members/me"],
  getGetMemberEntitlementsQueryKey: () => ["/members/me/entitlements"],
  getGetMemberProductsQueryKey: () => ["/members/me/products"],
}));

import Plans from "@/pages/Plans";

const member = {
  id: 1,
  email: "buyer@example.com",
  name: "Paying Member",
  sourceProduct: "launchpad",
};

const plans = [
  {
    slug: "launchpad",
    rank: 1,
    name: "BTS Launchpad",
    tagline: "Get started",
    priceDisplay: "$497",
    durationLabel: "one-time",
    highlights: ["Software access"],
    entitlements: ["software:base"],
    recommended: false,
  },
  {
    slug: "3month",
    rank: 2,
    name: "BTS 3-Month Mentorship",
    tagline: "Level up",
    priceDisplay: "$1,997",
    durationLabel: "3 months",
    highlights: ["Group coaching"],
    entitlements: ["software:base", "coaching:group"],
    recommended: true,
  },
];

beforeEach(() => {
  currentLocation = "/plans?upgraded=1";
  invalidateQueries.mockReset();
  startCheckoutMutate.mockReset();
  useGetCurrentMember.mockReset();
  useListPlans.mockReset();
  useGetCurrentMember.mockReturnValue({ data: member });
  useListPlans.mockReturnValue({
    data: plans,
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("post-upgrade return — member lands on the Plans page with the confirmation", () => {
  it("shows the 'Thanks for upgrading!' banner and does not redirect away when returning with ?upgraded=1", () => {
    render(<Plans />);

    // The member is on the right place: the Plans page itself rendered…
    expect(screen.getByTestId("plans-page")).toBeInTheDocument();
    // …with the post-upgrade confirmation banner.
    const banner = screen.getByTestId("plans-upgrade-success-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/thanks for upgrading/i);

    // And crucially, the member was NOT bounced off the upgrade screen: no
    // route-guard redirect fired.
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("refetches member-scoped data on return so the new tier surfaces once the webhook lands", () => {
    render(<Plans />);

    // The return trip invalidates member, entitlements, and products so the
    // current-tier badge / sidebar reflect the upgrade as soon as the cart
    // provider's webhook grants it.
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/members/me"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/members/me/entitlements"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/members/me/products"],
    });
  });

  it("does not show the confirmation banner on a normal (non-return) visit to the Plans page", () => {
    // Control: visiting /plans without the upgraded flag must not flash the
    // success banner — it's specifically the post-checkout confirmation.
    currentLocation = "/plans";

    render(<Plans />);

    expect(screen.getByTestId("plans-page")).toBeInTheDocument();
    expect(screen.queryByTestId("plans-upgrade-success-banner")).toBeNull();
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
});
