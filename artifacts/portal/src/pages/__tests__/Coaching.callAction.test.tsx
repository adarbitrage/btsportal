import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { CoachingCall } from "@workspace/api-client-react";

// Focused guard for the per-call action buttons rendered on the Coaching page
// (the CallAction component). The branching gates off each call's
// `isAccessible` flag and, when locked, deep-links to that call's OWN
// `upgradeUrl` — never a single shared upgrade link or Meet link. This is the
// regression class the test exists to catch:
//   - accessible + meetLink  -> "Join Call" link pointing at THAT call's link
//   - accessible + no link   -> disabled "Link soon" button
//   - locked                 -> "Unlock" navigating to THAT call's upgradeUrl
//                               (falling back to "/plans" when none is set)
// We drive it through the rendered Coaching page's weekly schedule rows so the
// real wiring (props passed to CallAction, onUnlock=navigate) is exercised.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/coaching", navigate],
}));

const useListCoachingCalls = vi.fn();
const useListCoaches = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
  useListCoaches: (...args: unknown[]) => useListCoaches(...args),
}));

import Coaching from "@/pages/Coaching";

function makeCall(overrides: Partial<CoachingCall>): CoachingCall {
  return {
    id: 0,
    title: "Coaching Call",
    description: "",
    callType: "weekly_qa",
    coachId: 1,
    coachName: "Sasha B(Coach)",
    meetLink: null,
    scheduledAt: new Date(2026, 5, 20, 15, 0, 0).toISOString(),
    durationMinutes: 60,
    requiredEntitlement: "coaching:weekly",
    recordingUrl: null,
    registeredCount: 0,
    isAccessible: true,
    upgradeUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  navigate.mockReset();
  useListCoachingCalls.mockReset();
  useListCoaches.mockReset();
  // The "Your Coaches" grid is irrelevant here; render an empty roster.
  useListCoaches.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — CallAction button gating", () => {
  it("renders a Join Call link pointing at the call's own meetLink when accessible", () => {
    const call = makeCall({
      id: 30,
      isAccessible: true,
      meetLink: "https://meet.google.com/call-30-link",
      upgradeUrl: null,
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-30");
    const joinLink = within(row).getByRole("link", { name: /join call/i });
    expect(joinLink).toHaveAttribute("href", "https://meet.google.com/call-30-link");
    // It must not fall back to an Unlock / disabled control.
    expect(within(row).queryByRole("button", { name: /unlock/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /link soon/i })).not.toBeInTheDocument();
  });

  it("renders a disabled 'Link soon' button when accessible but the meetLink is not published yet", () => {
    const call = makeCall({
      id: 31,
      isAccessible: true,
      meetLink: null,
      upgradeUrl: null,
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-31");
    const linkSoon = within(row).getByRole("button", { name: /link soon/i });
    expect(linkSoon).toBeDisabled();
    expect(within(row).queryByRole("link", { name: /join call/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /unlock/i })).not.toBeInTheDocument();
  });

  it("renders an Unlock button that navigates to the call's own upgradeUrl when locked", async () => {
    const call = makeCall({
      id: 32,
      isAccessible: false,
      meetLink: null,
      upgradeUrl: "/plans?highlight=vip",
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-32");
    const unlock = within(row).getByRole("button", { name: /unlock/i });
    await userEvent.click(unlock);
    expect(navigate).toHaveBeenCalledWith("/plans?highlight=vip");
    // A locked call must never expose the Meet link.
    expect(within(row).queryByRole("link", { name: /join call/i })).not.toBeInTheDocument();
  });

  it("falls back to /plans when a locked call has no upgradeUrl", async () => {
    const call = makeCall({
      id: 33,
      isAccessible: false,
      meetLink: null,
      upgradeUrl: null,
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-33");
    const unlock = within(row).getByRole("button", { name: /unlock/i });
    await userEvent.click(unlock);
    expect(navigate).toHaveBeenCalledWith("/plans");
  });
});
