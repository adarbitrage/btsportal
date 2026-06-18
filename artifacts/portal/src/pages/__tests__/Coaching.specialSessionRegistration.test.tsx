import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { CoachingCall } from "@workspace/api-client-react";

// Guards the member-facing RSVP control on the Coaching page's "Upcoming Special
// Sessions" list. Eligible members can reserve a spot ahead of a one-off
// session and cancel that reservation; the list must reflect both the member's
// own registration state (Reserve Spot vs Reserved) and the running
// registeredCount. Regression classes this test exists to catch:
//   - the register/cancel buttons stop calling their mutations
//   - the reserved/not-reserved state stops driving which button renders
//   - the registeredCount stops surfacing
//   - locked sessions accidentally expose a reserve control (they must Unlock)

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/coaching", navigate],
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
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
    callType: "strategy",
    coachId: 1,
    coachName: "Sasha B(Coach)",
    meetLink: null,
    scheduledAt: new Date(2026, 5, 20, 15, 0, 0).toISOString(),
    durationMinutes: 60,
    requiredEntitlement: "coaching:strategy",
    recordingUrl: null,
    registeredCount: 0,
    cancelled: false,
    hasRegistered: false,
    isAccessible: true,
    upgradeUrl: null,
    ...overrides,
  };
}

const registerMutate = vi.fn();
const cancelMutate = vi.fn();

beforeEach(() => {
  navigate.mockReset();
  invalidateQueries.mockReset();
  registerMutate.mockReset();
  cancelMutate.mockReset();
  useListCoachingCalls.mockReset();
  useListCoaches.mockReset();
  useRegisterForCoachingCall.mockReset();
  useCancelCoachingCallRegistration.mockReset();
  useListCoaches.mockReturnValue({ data: [] });
  useRegisterForCoachingCall.mockReturnValue({ mutate: registerMutate, isPending: false });
  useCancelCoachingCallRegistration.mockReturnValue({ mutate: cancelMutate, isPending: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — special-session registration", () => {
  it("lets an eligible member who hasn't registered reserve a spot", async () => {
    const call = makeCall({
      id: 70,
      callType: "strategy",
      isAccessible: true,
      hasRegistered: false,
      registeredCount: 4,
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("oneoff-call-70");
    // Running tally is surfaced.
    expect(within(row).getByTestId("oneoff-registered-count-70")).toHaveTextContent("4 reserved");
    // Not yet registered → a Reserve Spot button, no cancel control.
    expect(within(row).queryByTestId("oneoff-cancel-70")).not.toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("oneoff-register-70"));
    expect(registerMutate).toHaveBeenCalledWith({ id: 70 });
    expect(cancelMutate).not.toHaveBeenCalled();
  });

  it("lets an eligible member who is registered cancel their reservation", async () => {
    const call = makeCall({
      id: 71,
      callType: "mastermind",
      isAccessible: true,
      hasRegistered: true,
      registeredCount: 9,
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("oneoff-call-71");
    expect(within(row).getByTestId("oneoff-registered-count-71")).toHaveTextContent("9 reserved");
    // Already registered → a Reserved button that cancels, no reserve control.
    expect(within(row).queryByTestId("oneoff-register-71")).not.toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("oneoff-cancel-71"));
    expect(cancelMutate).toHaveBeenCalledWith({ id: 71 });
    expect(registerMutate).not.toHaveBeenCalled();
  });

  it("does not expose any reserve/cancel control for a locked session", () => {
    const call = makeCall({
      id: 72,
      callType: "vip_roundtable",
      isAccessible: false,
      hasRegistered: false,
      registeredCount: 2,
      upgradeUrl: "/plans?highlight=vip",
    });
    useListCoachingCalls.mockReturnValue({ data: [call] });

    render(<Coaching />);

    const row = screen.getByTestId("oneoff-call-72");
    expect(within(row).queryByTestId("oneoff-register-72")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("oneoff-cancel-72")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("oneoff-registered-count-72")).not.toBeInTheDocument();
    // Locked sessions still surface the Unlock deep-link.
    expect(within(row).getByRole("button", { name: /unlock/i })).toBeInTheDocument();
  });
});
