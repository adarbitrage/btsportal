import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// The partner mentee-detail page shows a "Mark Done" button only for calls
// the partner can actually complete. Backend/DB call_bookings.status values
// are booked | completed | no_show | canceled — there is no "scheduled"
// status. This test pins the button to the real "booked" vocabulary so a
// future refactor can't silently reintroduce the booked/scheduled mismatch
// that made the button never appear.

vi.mock("wouter", () => ({
  useParams: () => ({ memberId: "42" }),
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 99, email: "partner@example.com", role: "partner" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/coaching/StatusPill", () => ({
  StatusPill: ({ status }: { status: string }) => (
    <span data-testid="status-pill">{status}</span>
  ),
}));

const markDoneMutate = vi.fn();
const useGetPartnerMenteeDetail = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetPartnerMenteeDetail: (...args: unknown[]) => useGetPartnerMenteeDetail(...args),
  useAddPartnerMenteeNote: () => ({ mutate: vi.fn(), isPending: false }),
  useSetPartnerMenteeCadence: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkPartnerCallDoneRoute: () => ({ mutate: markDoneMutate, isPending: false }),
  getGetPartnerMenteeDetailQueryKey: () => ["partner", "mentee-detail"],
  getGetPartnerRosterQueryKey: () => ["partner", "roster"],
  getGetPartnerTodayQueryKey: () => ["partner", "today"],
}));

function baseMentee(callStatus: string, scheduledAt: string) {
  return {
    member_id: 42,
    name: "Jane Mentee",
    email: "jane@example.com",
    joined_at: "2025-01-15T00:00:00.000Z",
    current_section: null,
    blitz_status: "in_progress",
    blitz_completion_pct: 40,
    cadence_per_week: 2,
    assigned_at: "2025-02-01T00:00:00.000Z",
    last_completed_call_at: null,
    days_since_last_completed_call: null,
    consecutive_no_shows: 0,
    notes: [],
    calls: [
      {
        id: 7,
        scheduled_at: scheduledAt,
        end_at: scheduledAt,
        status: callStatus,
        meeting_url: null,
      },
    ],
  };
}

import PartnerMenteeDetail from "@/pages/partner/PartnerMenteeDetail";

beforeEach(() => {
  markDoneMutate.mockReset();
  useGetPartnerMenteeDetail.mockReset();
});

describe("PartnerMenteeDetail — Mark Done button visibility", () => {
  it("shows Mark Done for a past call with status 'booked'", async () => {
    useGetPartnerMenteeDetail.mockReturnValue({
      data: baseMentee("booked", "2020-01-01T00:00:00.000Z"),
      isLoading: false,
      isError: false,
    });

    renderWithQueryClient(<PartnerMenteeDetail />);

    const button = await screen.findByRole("button", { name: /mark done/i });
    expect(button).toBeInTheDocument();

    await userEvent.click(button);
    expect(markDoneMutate).toHaveBeenCalledTimes(1);
    expect(markDoneMutate.mock.calls[0][0]).toEqual({ id: 7 });
  });

  it("does not show Mark Done for a completed call", () => {
    useGetPartnerMenteeDetail.mockReturnValue({
      data: baseMentee("completed", "2020-01-01T00:00:00.000Z"),
      isLoading: false,
      isError: false,
    });

    renderWithQueryClient(<PartnerMenteeDetail />);

    expect(screen.queryByRole("button", { name: /mark done/i })).not.toBeInTheDocument();
  });

  it("does not show Mark Done for a future booked call", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    useGetPartnerMenteeDetail.mockReturnValue({
      data: baseMentee("booked", future),
      isLoading: false,
      isError: false,
    });

    renderWithQueryClient(<PartnerMenteeDetail />);

    expect(screen.queryByRole("button", { name: /mark done/i })).not.toBeInTheDocument();
  });
});
