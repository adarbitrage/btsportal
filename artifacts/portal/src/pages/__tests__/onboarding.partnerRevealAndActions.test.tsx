import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// Guards three things for Task #1666 (send_off replaces pillars_watched +
// partner_call_completed as the single final step for both variants):
//   1. Partner reveal timing: the partner reveal card only appears on the
//      send_off step once a partner is actually assigned (usePartnerInfo
//      returns one); it must NOT render for members with no partner assigned
//      yet.
//   2. One-primary-action-per-step: the send_off page exposes exactly one
//      primary (non-outline) call-to-action button.
//   3. Completion routing: the single CTA completes onboarding and lands the
//      member on the 7 Pillars page (/core-training/7-pillars) — NOT Home.

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding/send-off", navigate],
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const refreshAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { name: "Test Member", onboardingStep: 5, onboardingVariant: "full" }, refreshAuth }),
}));

const patchOnboardingMutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  usePatchOnboardingStep: () => ({ mutateAsync: patchOnboardingMutateAsync }),
  useGetOnboardingSendOff: () => ({ data: { videoUrl: null, kickoff: null, partnerCall: null }, isLoading: false }),
}));

const usePartnerInfo = vi.fn();
vi.mock("@/lib/call-bookings-api", () => ({
  usePartnerInfo: () => usePartnerInfo(),
}));

import OnboardingSendOffPage from "@/pages/onboarding/SendOff";

beforeEach(() => {
  usePartnerInfo.mockReset();
  refreshAuth.mockReset();
  patchOnboardingMutateAsync.mockReset();
  navigate.mockReset();
});

describe("onboarding step indicator", () => {
  it("shows 'Step 5 of 5' for the send_off step (full variant, Task #1666: 5-step contract)", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingSendOffPage />);
    expect(screen.getByTestId("onboarding-step-indicator")).toHaveTextContent("Step 5 of 5");
  });
});

describe("partner reveal timing on send_off", () => {
  it("does not show the partner reveal card when no partner is assigned yet", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingSendOffPage />);

    expect(screen.queryByTestId("partner-reveal-card")).not.toBeInTheDocument();
  });

  it("shows the partner reveal card once a partner is assigned", () => {
    usePartnerInfo.mockReturnValue({
      data: { partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: null } },
    });

    render(<OnboardingSendOffPage />);

    expect(screen.getByTestId("partner-reveal-card")).toBeInTheDocument();
    expect(screen.getByText("Alex Partner")).toBeInTheDocument();
  });
});

describe("one primary action on the send_off step", () => {
  it("has exactly one primary action button", () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });

    render(<OnboardingSendOffPage />);

    const buttons = screen.getAllByRole("button");
    const primaryButtons = buttons.filter((btn) => !/^Back$/i.test(btn.textContent?.trim() || ""));
    expect(primaryButtons.length).toBe(1);
    expect(screen.getByText(/Start with the 7 Pillars/i)).toBeInTheDocument();
  });
});

describe("send_off completion routing", () => {
  it("completes onboarding and navigates to the 7 Pillars page (not Home)", async () => {
    usePartnerInfo.mockReturnValue({ data: { partner: null } });
    patchOnboardingMutateAsync.mockResolvedValue({});

    render(<OnboardingSendOffPage />);

    fireEvent.click(screen.getByText(/Start with the 7 Pillars/i));

    await waitFor(() => expect(patchOnboardingMutateAsync).toHaveBeenCalledWith({ data: { step: 5 } }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/core-training/7-pillars"));
  });
});
