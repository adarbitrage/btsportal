import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { CoachingCall } from "@workspace/api-client-react";

// Guards the member-facing "Upcoming Calls" list on the Coaching schedule page.
// Accessible calls must show a "Join Call" link; locked calls must show an
// "Unlock" control that deep-links (via wouter navigate) to the call's
// per-call upgradeUrl. A refactor could silently turn locked calls back into
// a dead-end — exactly the regression class this test exists to catch. The API
// behavior is covered separately (coaching-calls-meet-link-scrub.test.ts); this
// covers only the frontend rendering.

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
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — Upcoming Calls Unlock buttons", () => {
  it("shows Join Call for accessible calls and an Unlock CTA that navigates to upgradeUrl for locked calls", async () => {
    const accessible = makeCall({
      id: 1,
      title: "Weekly Q&A",
      isAccessible: true,
      meetLink: "https://meet.google.com/abc-defg-hij",
      upgradeUrl: null,
    });
    const locked = makeCall({
      id: 2,
      title: "VIP Roundtable",
      callType: "vip_roundtable",
      isAccessible: false,
      meetLink: null,
      upgradeUrl: "/plans/vip-roundtable",
    });
    useListCoachingCalls.mockReturnValue({ data: [accessible, locked] });

    render(<Coaching />);

    // Accessible call renders a Join Call link to its meet link.
    const accessibleRow = screen.getByTestId("upcoming-call-1");
    const joinLink = within(accessibleRow).getByRole("link", { name: /join call/i });
    expect(joinLink).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");

    // Locked call shows no Join Call link, only an Unlock control (a button).
    const lockedRow = screen.getByTestId("upcoming-call-2");
    expect(within(lockedRow).queryByRole("link", { name: /join call/i })).not.toBeInTheDocument();
    const unlock = within(lockedRow).getByRole("button", { name: /unlock/i });
    expect(unlock).toBeInTheDocument();

    // Clicking Unlock deep-links to the per-call upgradeUrl.
    await userEvent.click(unlock);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/plans/vip-roundtable");
  });

  it("falls back to /plans when a locked call has no upgradeUrl", async () => {
    const locked = makeCall({
      id: 3,
      title: "Strategy Session",
      callType: "strategy",
      isAccessible: false,
      meetLink: null,
      upgradeUrl: null,
    });
    useListCoachingCalls.mockReturnValue({ data: [locked] });

    render(<Coaching />);

    const unlock = screen.getByRole("button", { name: /unlock/i });
    await userEvent.click(unlock);
    expect(navigate).toHaveBeenCalledWith("/plans");
  });

  it("hides the Upcoming Calls section when there are no upcoming calls", () => {
    useListCoachingCalls.mockReturnValue({ data: [] });

    render(<Coaching />);

    expect(screen.queryByRole("heading", { name: /upcoming calls/i })).not.toBeInTheDocument();
  });

  it("hides the Upcoming Calls section while the calls are still loading", () => {
    useListCoachingCalls.mockReturnValue({ data: undefined });

    render(<Coaching />);

    expect(screen.queryByRole("heading", { name: /upcoming calls/i })).not.toBeInTheDocument();
  });
});
