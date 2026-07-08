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

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const useListCoachingCalls = vi.fn();
const useListCoaches = vi.fn();
const joinMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
  useListCoaches: (...args: unknown[]) => useListCoaches(...args),
  useRegisterForCoachingCall: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelCoachingCallRegistration: () => ({ mutate: vi.fn(), isPending: false }),
  useJoinCoachingCall: () => ({ mutate: joinMutate, isPending: false }),
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
    cancelled: false,
    hasRegistered: false,
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
  it("renders a Join Call button that fires the join mutation for an RSVP'd member inside the join window", async () => {
    // Inside the join window: started 10 minutes ago, member has RSVP'd.
    const call = makeCall({
      id: 30,
      isAccessible: true,
      hasRegistered: true,
      meetLink: null, // the listing withholds the link; the join endpoint hands it back
      upgradeUrl: null,
      scheduledAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-30");
    const joinButton = within(row).getByTestId("weekly-join-30");
    expect(joinButton).toHaveTextContent(/join call/i);
    await userEvent.click(joinButton);
    expect(joinMutate).toHaveBeenCalledWith({ id: 30 });
    // It must not fall back to an Unlock / disabled control.
    expect(within(row).queryByRole("button", { name: /unlock/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /rsvps closed/i })).not.toBeInTheDocument();
  });

  it("renders a disabled 'RSVPs closed' button for a non-registered member past the RSVP cutoff", () => {
    // Accessible call starting in 30 minutes (inside the 1h cutoff), never RSVP'd.
    const call = makeCall({
      id: 31,
      isAccessible: true,
      hasRegistered: false,
      meetLink: null,
      upgradeUrl: null,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("weekly-call-31");
    const closed = within(row).getByTestId("weekly-closed-31");
    expect(closed).toBeDisabled();
    expect(closed).toHaveTextContent(/rsvps closed/i);
    // The Join button is now always visible but stays disabled without an RSVP.
    expect(within(row).getByTestId("weekly-join-31")).toBeDisabled();
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
