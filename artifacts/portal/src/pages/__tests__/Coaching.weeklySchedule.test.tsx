import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { CoachingCall } from "@workspace/api-client-react";

// Guards the member-facing recurring "Live Coaching Calls 6 Days/Week" schedule
// on the Coaching page. It is built from the weekly_qa calls returned by the
// backend (one-off call types are no longer surfaced here). Accessible calls
// must show a "Join Call" link; locked calls must show an "Unlock" control that
// deep-links (via wouter navigate) to the call's per-call upgradeUrl — exactly
// the regression class this test exists to catch. The API behavior is covered
// separately (coaching-calls-meet-link-scrub.test.ts); this covers only the
// frontend rendering.

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
const useRegisterForCoachingCall = vi.fn();
const useCancelCoachingCallRegistration = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
  useListCoaches: (...args: unknown[]) => useListCoaches(...args),
  useRegisterForCoachingCall: (...args: unknown[]) =>
    useRegisterForCoachingCall(...args),
  useCancelCoachingCallRegistration: (...args: unknown[]) =>
    useCancelCoachingCallRegistration(...args),
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
  useRegisterForCoachingCall.mockReset();
  useCancelCoachingCallRegistration.mockReset();
  useRegisterForCoachingCall.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useCancelCoachingCallRegistration.mockReturnValue({ mutate: vi.fn(), isPending: false });
  // The "Your Coaches" grid is independent of these assertions; default to an
  // empty roster so the section simply doesn't render.
  useListCoaches.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — data-driven weekly schedule", () => {
  it("renders the recurring schedule from weekly_qa calls with per-session Meet links and gating", async () => {
    const accessible = makeCall({
      id: 10,
      callType: "weekly_qa",
      coachName: "Todd R(Coach)",
      isAccessible: true,
      meetLink: "https://meet.google.com/weekly-aaa-bbb",
      upgradeUrl: null,
      scheduledAt: new Date(2026, 5, 22, 8, 0, 0).toISOString(),
      durationMinutes: 60,
    });
    const locked = makeCall({
      id: 11,
      callType: "weekly_qa",
      coachName: "Bruce C(Coach)",
      isAccessible: false,
      meetLink: null,
      upgradeUrl: "/plans?highlight=3month",
      scheduledAt: new Date(2026, 5, 23, 15, 0, 0).toISOString(),
    });
    // A non-weekly call must stay out of the recurring schedule.
    const oneOff = makeCall({
      id: 12,
      callType: "strategy",
      isAccessible: true,
      meetLink: "https://meet.google.com/strategy-xyz",
    });
    useListCoachingCalls.mockReturnValue({ data: [accessible, locked, oneOff] });

    render(<Coaching />);

    // The recurring schedule renders the two weekly_qa calls, not the strategy call.
    const accessibleRow = screen.getByTestId("weekly-call-10");
    const joinLink = within(accessibleRow).getByRole("link", { name: /join call/i });
    expect(joinLink).toHaveAttribute("href", "https://meet.google.com/weekly-aaa-bbb");

    const lockedRow = screen.getByTestId("weekly-call-11");
    expect(within(lockedRow).queryByRole("link", { name: /join call/i })).not.toBeInTheDocument();
    const unlock = within(lockedRow).getByRole("button", { name: /unlock/i });
    await userEvent.click(unlock);
    expect(navigate).toHaveBeenCalledWith("/plans?highlight=3month");

    expect(screen.queryByTestId("weekly-call-12")).not.toBeInTheDocument();
  });

  it("collapses repeated occurrences of the same weekly slot to its soonest row", () => {
    // Same weekday + time + coach across three weeks is one recurring slot; the
    // backend returns every future occurrence, but the cadence view must show it
    // once (soonest), not as three identical "Saturday 3pm with Bruce" rows.
    const soonest = makeCall({
      id: 30,
      coachId: 5,
      coachName: "Bruce C(Coach)",
      scheduledAt: new Date(2026, 5, 20, 15, 0, 0).toISOString(),
    });
    const nextWeek = makeCall({
      id: 31,
      coachId: 5,
      coachName: "Bruce C(Coach)",
      scheduledAt: new Date(2026, 5, 27, 15, 0, 0).toISOString(),
    });
    const weekAfter = makeCall({
      id: 32,
      coachId: 5,
      coachName: "Bruce C(Coach)",
      scheduledAt: new Date(2026, 6, 4, 15, 0, 0).toISOString(),
    });
    // A genuinely different slot (other weekday/coach) stays as its own row.
    const otherSlot = makeCall({
      id: 33,
      coachId: 7,
      coachName: "Todd R(Coach)",
      scheduledAt: new Date(2026, 5, 22, 8, 0, 0).toISOString(),
    });
    useListCoachingCalls.mockReturnValue({
      data: [nextWeek, weekAfter, soonest, otherSlot],
    });

    render(<Coaching />);

    expect(screen.getByTestId("weekly-call-30")).toBeInTheDocument();
    expect(screen.getByTestId("weekly-call-33")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-call-31")).not.toBeInTheDocument();
    expect(screen.queryByTestId("weekly-call-32")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no weekly group calls", () => {
    const oneOff = makeCall({ id: 20, callType: "strategy", isAccessible: true });
    useListCoachingCalls.mockReturnValue({ data: [oneOff] });

    render(<Coaching />);

    expect(screen.getByText(/no live group calls are scheduled/i)).toBeInTheDocument();
  });
});
