import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

// Smoke coverage for the Conversions and Payouts tabs: each must render its
// loading, empty, and data states correctly. We stub the data hooks so we can
// drive those states deterministically, and stub AppLayout so the page renders
// without the full app shell (sidebar, auth, router providers).
vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const useAffiliateConversions = vi.fn();
const useAffiliatePayouts = vi.fn();
vi.mock("@/hooks/use-affiliate-performance", () => ({
  useAffiliateConversions: (...args: unknown[]) => useAffiliateConversions(...args),
  useAffiliatePayouts: (...args: unknown[]) => useAffiliatePayouts(...args),
}));

import MediaMavensPerformance from "@/pages/MediaMavensPerformance";

const idle = { data: undefined, isLoading: false, isError: false };

beforeEach(() => {
  // Default both tabs to a benign idle state; individual tests override the one
  // they care about. The Payouts tab isn't mounted until selected, but the hook
  // still needs a safe default.
  useAffiliateConversions.mockReset().mockReturnValue(idle);
  useAffiliatePayouts.mockReset().mockReturnValue(idle);
});

describe("MediaMavensPerformance — Conversions tab", () => {
  it("renders skeleton rows while loading (no empty-state copy)", () => {
    useAffiliateConversions.mockReturnValue({ ...idle, isLoading: true });
    render(<MediaMavensPerformance />);

    expect(screen.queryByText(/no conversions yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to load conversions/i)).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no conversions", () => {
    useAffiliateConversions.mockReturnValue({
      ...idle,
      data: { items: [], hasNextPage: false, page: 1 },
    });
    render(<MediaMavensPerformance />);

    expect(screen.getByText(/no conversions yet/i)).toBeInTheDocument();
  });

  it("renders conversion rows with formatted currency and program title", () => {
    useAffiliateConversions.mockReturnValue({
      ...idle,
      data: {
        items: [
          {
            id: "c1",
            created_at: "2026-06-01T00:00:00Z",
            amount: "100",
            commission: { amount: "20" },
            status: "approved",
            program: { id: "p1", title: "Heat Haven" },
          },
        ],
        hasNextPage: false,
        page: 1,
      },
    });
    render(<MediaMavensPerformance />);

    expect(screen.getByText("Heat Haven")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText(/no conversions yet/i)).not.toBeInTheDocument();
  });

  it("renders the error state when the query fails", () => {
    useAffiliateConversions.mockReturnValue({ ...idle, isError: true });
    render(<MediaMavensPerformance />);

    expect(screen.getByText(/failed to load conversions/i)).toBeInTheDocument();
  });
});

describe("MediaMavensPerformance — Payouts tab", () => {
  async function openPayoutsTab() {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<MediaMavensPerformance />);
    await user.click(screen.getByRole("tab", { name: /payouts/i }));
    return screen.getByRole("tabpanel");
  }

  it("renders skeleton rows while loading (no empty/error copy)", async () => {
    useAffiliatePayouts.mockReturnValue({ ...idle, isLoading: true });

    const payoutsPanel = await openPayoutsTab();

    expect(within(payoutsPanel).queryByText(/no payouts yet/i)).not.toBeInTheDocument();
    expect(
      within(payoutsPanel).queryByText(/failed to load payouts/i),
    ).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no payouts", async () => {
    useAffiliatePayouts.mockReturnValue({
      ...idle,
      data: { items: [], hasNextPage: false, page: 1 },
    });

    const payoutsPanel = await openPayoutsTab();

    expect(within(payoutsPanel).getByText(/no payouts yet/i)).toBeInTheDocument();
  });

  it("renders payout rows when the Payouts tab is active", async () => {
    useAffiliatePayouts.mockReturnValue({
      ...idle,
      data: {
        items: [
          {
            id: "po1",
            created_at: "2026-06-02T00:00:00Z",
            amount: "50",
            payment_method: "paypal",
            status: "paid",
          },
        ],
        hasNextPage: false,
        page: 1,
      },
    });

    const payoutsPanel = await openPayoutsTab();

    expect(within(payoutsPanel).getByText("$50.00")).toBeInTheDocument();
    expect(within(payoutsPanel).getByText("paypal")).toBeInTheDocument();
    expect(within(payoutsPanel).getByText("Paid")).toBeInTheDocument();
    expect(within(payoutsPanel).queryByText(/no payouts yet/i)).not.toBeInTheDocument();
  });

  it("renders the error state when the payouts query fails", async () => {
    useAffiliatePayouts.mockReturnValue({ ...idle, isError: true });

    const payoutsPanel = await openPayoutsTab();

    expect(within(payoutsPanel).getByText(/failed to load payouts/i)).toBeInTheDocument();
  });
});
