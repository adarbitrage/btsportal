import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #1696: the sidebar next-call panel renders ONE card per upcoming
// booked call, in chronological order (source of truth is
// /call-bookings/next, which now returns every upcoming call — not just the
// soonest). Below the cards, a single optional "Your accountability
// partner: {Name}" line appears only when an active assignment exists AND
// none of the shown cards is a partner call. Must still render nothing when
// there is neither an upcoming call nor a partner assignment.

const useNextCallBooking = vi.fn();
const usePartnerPanel = vi.fn();
vi.mock("@/lib/call-bookings-api", () => ({
  useNextCallBooking: () => useNextCallBooking(),
  usePartnerPanel: () => usePartnerPanel(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { name: "Jamie Test", timezone: "America/New_York" } }),
}));

vi.mock("@/lib/coaches-admin-api", () => ({
  resolveCoachPhotoUrl: (url: string | null) => url,
}));

import { NextCallPanel } from "@/components/layout/NextCallPanel";

beforeEach(() => {
  useNextCallBooking.mockReset();
  usePartnerPanel.mockReset();
});

describe("NextCallPanel", () => {
  it("renders nothing when there is no upcoming call and no partner assignment", () => {
    useNextCallBooking.mockReturnValue({ data: { calls: [] }, isLoading: false });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    const { container } = render(<NextCallPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while either query is still loading", () => {
    useNextCallBooking.mockReturnValue({ data: undefined, isLoading: true });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    const { container } = render(<NextCallPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a LaunchPad member's kickoff call even with no partner assignment", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        calls: [
          {
            type: "kickoff",
            scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
            endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
            meetingUrl: "https://meet.example.test/kickoff",
            staff: { displayName: "Neil", photoUrl: null },
          },
        ],
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    render(<NextCallPanel />);

    expect(screen.getByTestId("next-call-panel")).toBeInTheDocument();
    expect(screen.getAllByTestId("next-call-panel-card")).toHaveLength(1);
    expect(screen.getByText("Kickoff Call with Neil")).toBeInTheDocument();
    expect(screen.queryByTestId("next-call-panel-partner-line")).not.toBeInTheDocument();
    const joinLink = screen.getByTestId("next-call-panel-join-link");
    expect(joinLink).toHaveAttribute("href", "https://meet.example.test/kickoff");
  });

  it("emphasizes 'Join Call Now' when the call is today", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        calls: [
          {
            type: "kickoff",
            scheduledAt: new Date().toISOString(),
            endAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            meetingUrl: "https://meet.example.test/kickoff",
            staff: { displayName: "Neil", photoUrl: null },
          },
        ],
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    render(<NextCallPanel />);

    expect(screen.getByText(/Join Call Now/i)).toBeInTheDocument();
  });

  it("renders TWO cards, one per call, for a member with both a kickoff and an accountability call booked", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        calls: [
          {
            type: "kickoff",
            scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
            meetingUrl: "https://meet.example.test/kickoff",
            staff: { displayName: "Todd", photoUrl: null },
          },
          {
            type: "partner",
            scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
            meetingUrl: "https://meet.example.test/partner",
            staff: { displayName: "John", photoUrl: null },
          },
        ],
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({
      data: {
        assignment: {
          partner: { id: 1, displayName: "John", photoUrl: null, bio: null },
          cadencePerWeek: 2,
          nextCall: null,
          completedCallCount: 3,
        },
      },
      isLoading: false,
    });

    render(<NextCallPanel />);

    expect(screen.getAllByTestId("next-call-panel-card")).toHaveLength(2);
    expect(screen.getByText("Kickoff Call with Todd")).toBeInTheDocument();
    expect(screen.getByText("Accountability Call with John")).toBeInTheDocument();
    // The relationship line must NOT duplicate, since one of the cards is
    // already the partner call.
    expect(screen.queryByTestId("next-call-panel-partner-line")).not.toBeInTheDocument();
  });

  it("shows the partner relationship line when an assignment exists but no shown card is the partner call", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        calls: [
          {
            type: "kickoff",
            scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
            meetingUrl: null,
            staff: { displayName: "Neil", photoUrl: null },
          },
        ],
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({
      data: {
        assignment: {
          partner: { id: 2, displayName: "Alex Partner", photoUrl: null, bio: null },
          cadencePerWeek: 1,
          nextCall: null,
          completedCallCount: 0,
        },
      },
      isLoading: false,
    });

    render(<NextCallPanel />);

    expect(screen.getAllByTestId("next-call-panel-card")).toHaveLength(1);
    expect(screen.getByTestId("next-call-panel-partner-line")).toHaveTextContent("Alex Partner");
  });

  it("shows the partner relationship line with no call cards when there is an assignment but no upcoming call", () => {
    useNextCallBooking.mockReturnValue({ data: { calls: [] }, isLoading: false });
    usePartnerPanel.mockReturnValue({
      data: {
        assignment: {
          partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: null },
          cadencePerWeek: 1,
          nextCall: null,
          completedCallCount: 0,
        },
      },
      isLoading: false,
    });

    render(<NextCallPanel />);

    expect(screen.getByTestId("next-call-panel")).toBeInTheDocument();
    expect(screen.queryAllByTestId("next-call-panel-card")).toHaveLength(0);
    expect(screen.getByTestId("next-call-panel-partner-line")).toHaveTextContent("Alex Partner");
  });
});
