import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Guards the persistent "Your Accountability Partner" dashboard panel
// (Task #1593): present for members with an active assignment, absent
// (not a loading spinner, not an empty card) for everyone else.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const useGetDashboard = vi.fn();
const useGetCurrentMember = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetDashboard: () => useGetDashboard(),
  useGetCurrentMember: () => useGetCurrentMember(),
}));

vi.mock("@/lib/vault-api", () => ({
  useVaultStats: () => ({ data: undefined }),
}));

const usePartnerPanel = vi.fn();
vi.mock("@/lib/call-bookings-api", () => ({
  usePartnerPanel: () => usePartnerPanel(),
}));

vi.mock("@/components/wins/WinsSummaryWidget", () => ({
  WinsSummaryWidget: () => <div data-testid="wins-summary-stub" />,
}));

vi.mock("@/components/upgrade/UpgradeFeaturesCard", () => ({
  UpgradeFeaturesCard: () => <div data-testid="upgrade-features-stub" />,
}));

vi.mock("@/components/blitz/BlitzContinueCard", () => ({
  BlitzContinueCard: () => <div data-testid="blitz-continue-stub" />,
}));

vi.mock("@/components/blitz/BlitzStreakWidget", () => ({
  BlitzStreakWidget: () => <div data-testid="blitz-streak-stub" />,
}));

vi.mock("@workspace/auth", () => ({
  isCoachRole: () => false,
}));

import Dashboard from "@/pages/Dashboard";

function makeDashboard(overrides: Record<string, unknown> = {}) {
  return {
    memberName: "Jamie Test",
    memberSince: new Date(2025, 0, 1).toISOString(),
    daysSinceJoined: 30,
    highestProductSlug: "lifetime",
    highestProductName: "Lifetime",
    ownedProducts: [],
    nextLesson: null,
    lessonsCompleted: 0,
    totalLessons: 0,
    hoursLearned: 0,
    currentStreak: 0,
    overallProgress: 0,
    entitlements: [],
    recentAnnouncements: [],
    upcomingCalls: [],
    recentTools: [],
    streakDays: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useGetDashboard.mockReset();
  useGetCurrentMember.mockReset();
  usePartnerPanel.mockReset();
  useGetDashboard.mockReturnValue({ data: makeDashboard(), isLoading: false, error: null });
  useGetCurrentMember.mockReturnValue({ data: { entitlements: [], sourceProduct: "lifetime" } });
});

describe("Dashboard accountability partner panel", () => {
  it("is absent for a member with no active partner assignment", () => {
    usePartnerPanel.mockReturnValue({ data: { assignment: null }, isLoading: false });

    render(<Dashboard />);

    expect(screen.queryByTestId("accountability-partner-panel")).not.toBeInTheDocument();
  });

  it("is absent while the panel data is still loading", () => {
    usePartnerPanel.mockReturnValue({ data: undefined, isLoading: true });

    render(<Dashboard />);

    expect(screen.queryByTestId("accountability-partner-panel")).not.toBeInTheDocument();
  });

  it("renders the partner, completed count, and next call for an assigned member", () => {
    usePartnerPanel.mockReturnValue({
      data: {
        assignment: {
          partner: { id: 1, displayName: "Alex Partner", photoUrl: null, bio: "Loves helping members hit goals." },
          cadencePerWeek: 2,
          nextCall: { scheduledAt: new Date(Date.now() + 86400000).toISOString(), meetingUrl: "https://meet.example.test/x" },
          completedCallCount: 4,
        },
      },
      isLoading: false,
    });

    render(<Dashboard />);

    const panel = screen.getByTestId("accountability-partner-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Alex Partner")).toBeInTheDocument();
    expect(screen.getByTestId("partner-completed-count")).toHaveTextContent("4");
    expect(screen.getByText(/Manage Calls/i)).toBeInTheDocument();
  });

  it("shows a 'no call scheduled' state and Book a Call action when there is no upcoming call", () => {
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

    render(<Dashboard />);

    expect(screen.getByText(/No call scheduled yet\./i)).toBeInTheDocument();
    expect(screen.getByText(/Book a Call/i)).toBeInTheDocument();
  });
});
