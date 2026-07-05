import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #1688: the persistent sidebar "next call" panel. Must show for a
// LaunchPad member with a booked kickoff call and NO partner assignment
// (source of truth is /call-bookings/next, not /partner/me), must show the
// partner relationship line without duplicating the headline photo/name
// when the next call itself is the partner call, and must render nothing
// when there is neither an upcoming call nor a partner assignment.

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
    useNextCallBooking.mockReturnValue({ data: { call: null }, isLoading: false });
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
        call: {
          type: "kickoff",
          scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
          meetingUrl: "https://meet.example.test/kickoff",
          staff: { displayName: "Neil", photoUrl: null },
        },
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    render(<NextCallPanel />);

    expect(screen.getByTestId("next-call-panel")).toBeInTheDocument();
    expect(screen.getByText("Neil")).toBeInTheDocument();
    expect(screen.getByText("Kickoff Call")).toBeInTheDocument();
    expect(screen.queryByTestId("next-call-panel-partner-line")).not.toBeInTheDocument();
    const joinLink = screen.getByTestId("next-call-panel-join-link");
    expect(joinLink).toHaveAttribute("href", "https://meet.example.test/kickoff");
  });

  it("emphasizes 'Join Call Now' when the call is today", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        call: {
          type: "kickoff",
          scheduledAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          meetingUrl: "https://meet.example.test/kickoff",
          staff: { displayName: "Neil", photoUrl: null },
        },
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    render(<NextCallPanel />);

    expect(screen.getByText(/Join Call Now/i)).toBeInTheDocument();
  });

  it("shows the partner relationship line for an assigned member with an upcoming partner call, without duplicating the name", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        call: {
          type: "partner",
          scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
          meetingUrl: "https://meet.example.test/partner",
          staff: { displayName: "Alex Partner", photoUrl: null },
        },
      },
      isLoading: false,
    });
    usePartnerPanel.mockReturnValue({
      data: {
        assignment: {
          partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: null },
          cadencePerWeek: 2,
          nextCall: null,
          completedCallCount: 3,
        },
      },
      isLoading: false,
    });

    render(<NextCallPanel />);

    expect(screen.getAllByText("Alex Partner")).toHaveLength(1);
    expect(screen.getByTestId("next-call-panel-partner-line")).toHaveTextContent(
      "Your Accountability Partner",
    );
    expect(screen.getByTestId("next-call-panel-partner-line")).toHaveTextContent("2x per week");
  });

  it("names the real partner separately when the next call is a kickoff call but a partner is also assigned", () => {
    useNextCallBooking.mockReturnValue({
      data: {
        call: {
          type: "kickoff",
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
          meetingUrl: null,
          staff: { displayName: "Neil", photoUrl: null },
        },
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

    expect(screen.getByText("Neil")).toBeInTheDocument();
    expect(screen.getByTestId("next-call-panel-partner-line")).toHaveTextContent("Alex Partner");
  });

  it("shows the partner relationship with no call info when there is an assignment but no upcoming call", () => {
    useNextCallBooking.mockReturnValue({ data: { call: null }, isLoading: false });
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
    expect(screen.getAllByText("Alex Partner").length).toBeGreaterThan(0);
    expect(screen.queryByText("Kickoff Call")).not.toBeInTheDocument();
    expect(screen.queryByText("Accountability Partner Call")).not.toBeInTheDocument();
  });
});
