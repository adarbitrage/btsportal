import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { CoachingCall } from "@workspace/api-client-react";

// Guards the member-facing "Upcoming Special Sessions" list on the Coaching
// page. This is the one-off (strategy / mastermind / vip_roundtable) counterpart
// to the recurring weekly schedule: those call types are NOT shown in the weekly
// cadence — they live only in this list, each with its own CallAction gating and
// per-call deep-link. The regression class this test exists to catch:
//   - one-off calls leak into the recurring weekly schedule (or vice versa)
//   - one-off calls drop their CallAction gating (Join Call vs Unlock)
//   - locked one-off calls deep-link somewhere other than their own upgradeUrl
// We render the real Coaching page, mocking only the data hooks. The weekly
// schedule and per-call action branching are covered separately in
// Coaching.weeklySchedule.test.tsx / Coaching.callAction.test.tsx.

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
    callType: "strategy",
    coachId: 1,
    coachName: "Sasha B(Coach)",
    meetLink: null,
    scheduledAt: new Date(2026, 5, 20, 15, 0, 0).toISOString(),
    durationMinutes: 60,
    requiredEntitlement: "coaching:strategy",
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
  // The "Your Coaches" grid is independent of these assertions; default to an
  // empty roster so the section simply doesn't render.
  useListCoaches.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — upcoming one-off special sessions", () => {
  it("renders strategy / mastermind / VIP calls in the special-sessions list with their type labels and gating", async () => {
    const strategy = makeCall({
      id: 40,
      callType: "strategy",
      coachName: "Sasha B(Coach)",
      isAccessible: true,
      meetLink: "https://meet.google.com/strategy-40",
      upgradeUrl: null,
      scheduledAt: new Date(2026, 5, 22, 9, 0, 0).toISOString(),
      durationMinutes: 60,
    });
    const mastermind = makeCall({
      id: 41,
      callType: "mastermind",
      coachName: "Todd R(Coach)",
      isAccessible: false,
      meetLink: null,
      upgradeUrl: "/plans?highlight=mastermind",
      scheduledAt: new Date(2026, 5, 24, 13, 0, 0).toISOString(),
    });
    const vip = makeCall({
      id: 42,
      callType: "vip_roundtable",
      coachName: "Bruce C(Coach)",
      isAccessible: true,
      meetLink: null,
      upgradeUrl: null,
      scheduledAt: new Date(2026, 5, 26, 17, 0, 0).toISOString(),
    });
    useListCoachingCalls.mockReturnValue({ data: [strategy, mastermind, vip] });

    render(<Coaching />);

    // Accessible strategy call → Join Call link pointing at its OWN meetLink.
    const strategyRow = screen.getByTestId("oneoff-call-40");
    expect(within(strategyRow).getByTestId("oneoff-call-type-40")).toHaveTextContent("Strategy");
    const joinLink = within(strategyRow).getByRole("link", { name: /join call/i });
    expect(joinLink).toHaveAttribute("href", "https://meet.google.com/strategy-40");

    // Locked mastermind call → Unlock navigating to its OWN upgradeUrl.
    const mastermindRow = screen.getByTestId("oneoff-call-41");
    expect(within(mastermindRow).getByTestId("oneoff-call-type-41")).toHaveTextContent("Mastermind");
    expect(within(mastermindRow).queryByRole("link", { name: /join call/i })).not.toBeInTheDocument();
    await userEvent.click(within(mastermindRow).getByRole("button", { name: /unlock/i }));
    expect(navigate).toHaveBeenCalledWith("/plans?highlight=mastermind");

    // Accessible VIP call without a published link yet → disabled "Link soon".
    const vipRow = screen.getByTestId("oneoff-call-42");
    expect(within(vipRow).getByTestId("oneoff-call-type-42")).toHaveTextContent("VIP Roundtable");
    expect(within(vipRow).getByRole("button", { name: /link soon/i })).toBeDisabled();
  });

  it("keeps one-off calls out of the recurring weekly schedule and weekly calls out of the special-sessions list", () => {
    const weekly = makeCall({
      id: 50,
      callType: "weekly_qa",
      isAccessible: true,
      meetLink: "https://meet.google.com/weekly-50",
    });
    const strategy = makeCall({
      id: 51,
      callType: "strategy",
      isAccessible: true,
      meetLink: "https://meet.google.com/strategy-51",
    });
    useListCoachingCalls.mockReturnValue({ data: [weekly, strategy] });

    render(<Coaching />);

    // The weekly_qa call renders only in the recurring schedule.
    expect(screen.getByTestId("weekly-call-50")).toBeInTheDocument();
    expect(screen.queryByTestId("oneoff-call-50")).not.toBeInTheDocument();

    // The strategy call renders only in the special-sessions list.
    expect(screen.getByTestId("oneoff-call-51")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-call-51")).not.toBeInTheDocument();
  });

  it("does not render the special-sessions section when there are no one-off calls", () => {
    const weekly = makeCall({ id: 60, callType: "weekly_qa", isAccessible: true });
    useListCoachingCalls.mockReturnValue({ data: [weekly] });

    render(<Coaching />);

    expect(screen.queryByText(/upcoming special sessions/i)).not.toBeInTheDocument();
  });
});
