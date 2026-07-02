import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Guards two things for Task #1593:
//   1. Partner reveal timing: the partner reveal card only appears on steps
//      6/7 once a partner is actually assigned (usePartnerInfo returns one);
//      it must NOT render for members with no partner assigned yet.
//   2. One-primary-action-per-step: each onboarding step page exposes exactly
//      one primary (non-outline) call-to-action button.

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding/pillars", vi.fn()],
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const refreshAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { name: "Test Member", onboardingStep: 6 }, refreshAuth }),
}));

const patchOnboardingMutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  usePatchOnboardingStep: () => ({ mutateAsync: patchOnboardingMutateAsync }),
}));

const usePartnerInfo = vi.fn();
vi.mock("@/lib/call-bookings-api", () => ({
  usePartnerInfo: () => usePartnerInfo(),
}));

import OnboardingWatchPillars from "@/pages/onboarding/WatchPillars";
import OnboardingPartnerCallPending from "@/pages/onboarding/PartnerCallPending";

beforeEach(() => {
  usePartnerInfo.mockReset();
  refreshAuth.mockReset();
  patchOnboardingMutateAsync.mockReset();
});

describe("onboarding step indicator", () => {
  it("shows 'Step X of 7' for step 6 and step 7", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    const { unmount } = render(<OnboardingWatchPillars />);
    expect(screen.getByTestId("onboarding-step-indicator")).toHaveTextContent("Step 6 of 7");
    unmount();

    render(<OnboardingPartnerCallPending />);
    expect(screen.getByTestId("onboarding-step-indicator")).toHaveTextContent("Step 7 of 7");
  });
});

describe("partner reveal timing on steps 6/7", () => {
  it("does not show the partner reveal card on step 6 when no partner is assigned yet", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingWatchPillars />);

    expect(screen.queryByTestId("partner-reveal-card")).not.toBeInTheDocument();
  });

  it("shows the partner reveal card on step 6 once a partner is assigned", () => {
    usePartnerInfo.mockReturnValue({
      data: { partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: null } },
    });

    render(<OnboardingWatchPillars />);

    expect(screen.getByTestId("partner-reveal-card")).toBeInTheDocument();
    expect(screen.getByText("Alex Partner")).toBeInTheDocument();
  });

  it("does not show the partner reveal card on step 7 when no partner is assigned yet", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingPartnerCallPending />);

    expect(screen.queryByTestId("partner-reveal-card")).not.toBeInTheDocument();
  });

  it("shows the partner reveal card on step 7 once a partner is assigned", () => {
    usePartnerInfo.mockReturnValue({
      data: { partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: null } },
    });

    render(<OnboardingPartnerCallPending />);

    expect(screen.getByTestId("partner-reveal-card")).toBeInTheDocument();
  });
});

describe("one primary action per onboarding step", () => {
  it("step 6 (Watch Pillars) has exactly one primary action button", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingWatchPillars />);

    const buttons = screen.getAllByRole("button");
    const primaryButtons = buttons.filter((btn) => !btn.className.includes("variant-outline") && btn.textContent?.match(/Continue/i));
    expect(primaryButtons.length).toBe(1);
    expect(screen.getByText(/I've watched it — Continue/i)).toBeInTheDocument();
  });

  it("step 7 (Partner Call Pending) has exactly one primary action button, plus the shared Back nav", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingPartnerCallPending />);

    const buttons = screen.getAllByRole("button");
    const primaryButtons = buttons.filter((btn) => !/^Back$/i.test(btn.textContent?.trim() || ""));
    expect(primaryButtons.length).toBe(1);
    expect(primaryButtons[0]).toHaveTextContent(/Check status/i);
  });
});
