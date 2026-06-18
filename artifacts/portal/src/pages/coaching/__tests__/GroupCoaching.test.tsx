import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { format } from "date-fns";
import type { ReactNode } from "react";
import type {
  CoachGroupCall,
  CoachGroupCallsResponse,
} from "@/lib/coach-group-calls-api";

// The coach Group Coaching surface is a navigable MONTH CALENDAR scoped to one
// coach's weekly group-call dates. A plain coach sees only their own calendar
// (no picker); an admin (coaching:view) gets a coach picker to view/manage any
// coach. Cancel is confirm-gated and reversible; reinstate is immediate.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const useCoachGroupCalls = vi.fn();
const useGroupCoachingCoaches = vi.fn();
const cancelMutate = vi.fn();
const restoreMutate = vi.fn();
vi.mock("@/lib/coach-group-calls-api", () => ({
  useCoachGroupCalls: (...args: unknown[]) => useCoachGroupCalls(...args),
  useGroupCoachingCoaches: (...args: unknown[]) => useGroupCoachingCoaches(...args),
  useCancelGroupCall: () => ({ mutate: cancelMutate, isPending: false }),
  useRestoreGroupCall: () => ({ mutate: restoreMutate, isPending: false }),
}));

import GroupCoaching from "@/pages/coaching/GroupCoaching";

function makeCall(overrides: Partial<CoachGroupCall>): CoachGroupCall {
  return {
    id: 0,
    title: "Weekly Group Call",
    coachId: 5,
    coachName: "CoachA",
    scheduledAt: new Date(2026, 6, 15, 14, 0, 0).toISOString(),
    durationMinutes: 60,
    registeredCount: 3,
    cancelled: false,
    cancelledAt: null,
    ...overrides,
  };
}

function dayKey(call: CoachGroupCall): string {
  return format(new Date(call.scheduledAt), "yyyy-MM-dd");
}

beforeEach(() => {
  useCoachGroupCalls.mockReset();
  useGroupCoachingCoaches.mockReset();
  cancelMutate.mockReset();
  restoreMutate.mockReset();
  // Default: not an admin, so the picker query is disabled / empty.
  useGroupCoachingCoaches.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GroupCoaching — calendar + coach picker", () => {
  it("shows a coach's own calendar with the soonest date pre-selected and no picker", async () => {
    const active = makeCall({ id: 10 });
    const response: CoachGroupCallsResponse = {
      coachId: 5,
      isAdmin: false,
      calls: [active],
    };
    useCoachGroupCalls.mockReturnValue({ data: response, isLoading: false, isError: false });

    render(<GroupCoaching />);

    // No admin picker for a plain coach.
    expect(screen.queryByTestId("coach-picker")).not.toBeInTheDocument();

    // The calendar renders, the call's day is marked, and the soonest call is
    // pre-selected so its detail (with a cancel control) is visible.
    expect(screen.getByTestId("group-call-calendar")).toBeInTheDocument();
    const cell = screen.getByTestId(`calendar-day-${dayKey(active)}`);
    expect(cell).toHaveAttribute("data-has-events", "true");
    expect(screen.getByTestId("group-call-10")).toBeInTheDocument();
    expect(screen.getByTestId("group-call-cancel-10")).toBeInTheDocument();
  });

  it("selecting a different day shows that day's call detail", async () => {
    const first = makeCall({ id: 10, scheduledAt: new Date(2026, 6, 15, 14, 0, 0).toISOString() });
    const second = makeCall({ id: 11, scheduledAt: new Date(2026, 6, 22, 14, 0, 0).toISOString() });
    useCoachGroupCalls.mockReturnValue({
      data: { coachId: 5, isAdmin: false, calls: [first, second] },
      isLoading: false,
      isError: false,
    });

    render(<GroupCoaching />);

    // Soonest (the 15th) is pre-selected.
    expect(screen.getByTestId("group-call-10")).toBeInTheDocument();
    expect(screen.queryByTestId("group-call-11")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId(`calendar-day-${dayKey(second)}`));

    expect(screen.getByTestId("group-call-11")).toBeInTheDocument();
    expect(screen.queryByTestId("group-call-10")).not.toBeInTheDocument();
  });

  it("cancelling a date is confirm-gated, then calls the cancel mutation", async () => {
    const active = makeCall({ id: 10 });
    useCoachGroupCalls.mockReturnValue({
      data: { coachId: 5, isAdmin: false, calls: [active] },
      isLoading: false,
      isError: false,
    });

    render(<GroupCoaching />);

    await userEvent.click(screen.getByTestId("group-call-cancel-10"));

    // A confirm dialog appears; the mutation only fires on confirm.
    const dialog = await screen.findByRole("alertdialog");
    expect(cancelMutate).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel this date/i }));
    expect(cancelMutate).toHaveBeenCalledWith(10, expect.anything());
  });

  it("reinstating a cancelled date fires immediately (no confirm)", async () => {
    const cancelled = makeCall({ id: 10, cancelled: true, cancelledAt: new Date().toISOString() });
    useCoachGroupCalls.mockReturnValue({
      data: { coachId: 5, isAdmin: false, calls: [cancelled] },
      isLoading: false,
      isError: false,
    });

    render(<GroupCoaching />);

    const cell = screen.getByTestId(`calendar-day-${dayKey(cancelled)}`);
    expect(cell).toHaveAttribute("data-cancelled", "true");

    await userEvent.click(screen.getByTestId("group-call-restore-10"));
    expect(restoreMutate).toHaveBeenCalledWith(10, expect.anything());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the coach picker for admins and scopes the calendar to the chosen coach", async () => {
    useCoachGroupCalls.mockReturnValue({
      data: { coachId: null, isAdmin: true, calls: [makeCall({ id: 10 })] },
      isLoading: false,
      isError: false,
    });
    useGroupCoachingCoaches.mockReturnValue({
      data: [
        { id: 5, name: "CoachA" },
        { id: 6, name: "CoachB" },
      ],
    });

    render(<GroupCoaching />);

    const picker = screen.getByTestId("coach-picker");
    expect(picker).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "CoachA" })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "CoachB" })).toBeInTheDocument();

    // Admin defaults to the first coach, so the calendar is scoped to coach 5.
    await waitFor(() => {
      expect(useCoachGroupCalls).toHaveBeenLastCalledWith(5);
    });

    // Switching the picker re-scopes the calendar to the chosen coach.
    fireEvent.change(picker, { target: { value: "6" } });
    await waitFor(() => {
      expect(useCoachGroupCalls).toHaveBeenLastCalledWith(6);
    });
  });

  it("never renders the picker for a plain coach even with no calls", () => {
    useCoachGroupCalls.mockReturnValue({
      data: { coachId: null, isAdmin: false, calls: [] },
      isLoading: false,
      isError: false,
    });

    render(<GroupCoaching />);

    expect(screen.queryByTestId("coach-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-call-calendar")).toBeInTheDocument();
    expect(screen.getByTestId("day-detail-empty")).toBeInTheDocument();
  });
});
