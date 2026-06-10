import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";

// When a member clicks "Upgrade" and the checkout request fails, the Plans page
// must show a friendly error banner — never a raw "[object Object]". The error
// shape is extracted by `extractErrorMessage`: the generated client throws an
// ApiError with the parsed JSON body on `.data`, so `.data.error` carries the
// server-provided message. This test pins that behaviour for both shapes:
//   1. an ApiError-with-`.data.error` (surface the server's message), and
//   2. a generic error (fall back to the friendly default).
// A regression in the extraction would silently start showing members an
// unreadable error string, so we lock the resolved banner text here.
//
// We reuse the page-test mocking pattern from Plans.upgradeReturn.test.tsx
// (mock AppLayout, wouter, and @workspace/api-client-react). The one addition:
// the checkout hook receives an `onError` callback in its config, so our mock
// captures that callback and lets the test fire it to simulate a failed
// mutation.
let currentLocation = "/plans";
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

// Capture the onError callback the page wires into the checkout hook so the
// test can simulate the mutation failing.
let capturedOnError: ((error: unknown) => void) | undefined;
const startCheckoutMutate = vi.fn();
const useGetCurrentMember = vi.fn();
const useListPlans = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  useListPlans: () => useListPlans(),
  useStartMemberCheckout: (opts?: {
    mutation?: { onError?: (error: unknown) => void };
  }) => {
    capturedOnError = opts?.mutation?.onError;
    return { mutate: startCheckoutMutate };
  },
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
  currentLocation = "/plans";
  capturedOnError = undefined;
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

describe("Plans checkout failure — member sees a friendly error banner, never [object Object]", () => {
  it("surfaces the server-provided message from an ApiError's `.data.error`", () => {
    render(<Plans />);

    // No error banner before the member tries to upgrade.
    expect(screen.queryByTestId("plans-checkout-error-banner")).toBeNull();

    // Member clicks the upgrade CTA for the higher tier.
    fireEvent.click(screen.getByTestId("plan-cta-3month"));
    expect(startCheckoutMutate).toHaveBeenCalledTimes(1);

    // The checkout mutation fails with the shape the generated client throws:
    // an ApiError carrying the parsed JSON body on `.data`.
    expect(capturedOnError).toBeTypeOf("function");
    act(() => {
      capturedOnError!({
        name: "ApiError",
        status: 409,
        data: { error: "You already own this plan." },
      });
    });

    const banner = screen.getByTestId("plans-checkout-error-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("You already own this plan.");
    expect(banner).not.toHaveTextContent("[object Object]");
  });

  it("falls back to the friendly generic message for an error without `.data.error`", () => {
    render(<Plans />);

    fireEvent.click(screen.getByTestId("plan-cta-3month"));
    expect(startCheckoutMutate).toHaveBeenCalledTimes(1);

    // A generic error — e.g. a network failure — carries no server message.
    expect(capturedOnError).toBeTypeOf("function");
    act(() => {
      capturedOnError!(new Error("Network request failed"));
    });

    const banner = screen.getByTestId("plans-checkout-error-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      "We couldn't start checkout. Please try again or contact support.",
    );
    expect(banner).not.toHaveTextContent("[object Object]");
  });

  it("never renders [object Object] when `.data.error` is itself an object", () => {
    // Defensive: if the server body's `error` is a nested object (not a string),
    // the extractor must still fall back to the friendly message rather than
    // stringifying the object into "[object Object]".
    render(<Plans />);

    fireEvent.click(screen.getByTestId("plan-cta-3month"));
    expect(capturedOnError).toBeTypeOf("function");
    act(() => {
      capturedOnError!({
        name: "ApiError",
        status: 500,
        data: { error: { code: "INTERNAL", message: "boom" } },
      });
    });

    const banner = screen.getByTestId("plans-checkout-error-banner");
    expect(banner).toHaveTextContent(
      "We couldn't start checkout. Please try again or contact support.",
    );
    expect(banner).not.toHaveTextContent("[object Object]");
  });
});
