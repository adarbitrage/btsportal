import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UserStrikesDetail as UserStrikesDetailData } from "@/lib/admin-api";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/admin/moderation/ban-controls", () => ({
  BanControls: () => <div data-testid="ban-controls-stub" />,
}));

vi.mock("wouter", () => ({
  useParams: () => ({ userId: "42" }),
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const useAdminUserStrikes = vi.fn();
vi.mock("@/lib/admin-api", () => ({
  useAdminUserStrikes: (...args: unknown[]) => useAdminUserStrikes(...args),
}));

import UserStrikesDetail from "@/pages/admin/moderation/user-strikes";

function baseData(
  overrides: Partial<UserStrikesDetailData> = {},
): UserStrikesDetailData {
  return {
    user: {
      id: 42,
      name: "Test Member",
      email: "member@example.com",
      postingBannedAt: new Date(2026, 0, 10, 9, 30, 0).toISOString(),
      isBanned: true,
    },
    strikes: [],
    strikeCount: 3,
    autoBan: null,
    manualBan: null,
    banHistory: [],
    ...overrides,
  };
}

beforeEach(() => {
  useAdminUserStrikes.mockReset();
});

describe("UserStrikesDetail — Ban Details card", () => {
  it("shows auto-ban details (reviewer, queue id, strike id, strike count)", () => {
    useAdminUserStrikes.mockReturnValue({
      data: baseData({
        autoBan: {
          id: 7001,
          actorId: 5,
          actorEmail: "reviewer@example.com",
          description: null,
          metadata: {
            userId: 42,
            reviewerId: 5,
            triggeringQueueId: 884,
            triggeringStrikeId: 991,
            strikeCount: 3,
          },
          createdAt: new Date(2026, 0, 10, 9, 30, 0).toISOString(),
        },
      }),
      isLoading: false,
      error: null,
    });

    render(<UserStrikesDetail />);

    expect(screen.getByText("Ban Details")).toBeInTheDocument();
    expect(screen.getByText(/Auto-banned on/i)).toBeInTheDocument();
    expect(screen.getByText("reviewer@example.com")).toBeInTheDocument();
    expect(screen.getByText(/via queue #884/i)).toBeInTheDocument();
    expect(screen.getByText("3 strikes at ban")).toBeInTheDocument();
    expect(screen.getByText("Strike #991")).toBeInTheDocument();
    expect(
      screen.getByText(/View triggering queue item/i),
    ).toBeInTheDocument();
  });

  it("shows the neutral 'Banned by admin' state when autoBan is null but user is banned", () => {
    useAdminUserStrikes.mockReturnValue({
      data: baseData({ autoBan: null }),
      isLoading: false,
      error: null,
    });

    render(<UserStrikesDetail />);

    expect(screen.getByText("Ban Details")).toBeInTheDocument();
    expect(screen.getByText("Banned by admin")).toBeInTheDocument();
    expect(screen.queryByText(/Auto-banned on/i)).not.toBeInTheDocument();
  });

  it("does NOT render the Ban Details card when the user is not banned", () => {
    useAdminUserStrikes.mockReturnValue({
      data: baseData({
        user: {
          id: 42,
          name: "Test Member",
          email: "member@example.com",
          postingBannedAt: null,
          isBanned: false,
        },
        autoBan: null,
      }),
      isLoading: false,
      error: null,
    });

    render(<UserStrikesDetail />);

    expect(screen.queryByText("Ban Details")).not.toBeInTheDocument();
    expect(screen.queryByText("Banned by admin")).not.toBeInTheDocument();
  });

  it("renders the full ban/unban history with the most recent event as current reason", () => {
    useAdminUserStrikes.mockReturnValue({
      data: baseData({
        banHistory: [
          {
            id: 3,
            actionType: "ban_posting",
            actorId: 9,
            actorEmail: "current-admin@example.com",
            description: null,
            metadata: { userId: 42 },
            createdAt: new Date(2026, 2, 1, 12, 0, 0).toISOString(),
          },
          {
            id: 2,
            actionType: "unban_posting",
            actorId: 8,
            actorEmail: "lenient-admin@example.com",
            description: null,
            metadata: { userId: 42, strikesCleared: true },
            createdAt: new Date(2026, 1, 1, 12, 0, 0).toISOString(),
          },
          {
            id: 1,
            actionType: "auto_ban_posting",
            actorId: 5,
            actorEmail: "reviewer@example.com",
            description: null,
            metadata: {
              userId: 42,
              triggeringQueueId: 884,
              triggeringStrikeId: 991,
              strikeCount: 3,
            },
            createdAt: new Date(2026, 0, 10, 9, 30, 0).toISOString(),
          },
        ],
      }),
      isLoading: false,
      error: null,
    });

    render(<UserStrikesDetail />);

    expect(screen.getByText("Ban Details")).toBeInTheDocument();
    expect(screen.getByText("3 events")).toBeInTheDocument();
    // Most recent event is shown and flagged as the current reason.
    expect(screen.getByText("Current reason")).toBeInTheDocument();
    expect(screen.getByText("current-admin@example.com")).toBeInTheDocument();

    // Earlier events live behind a collapsible — expand it to reveal them.
    fireEvent.click(screen.getByText(/Show earlier history/i));

    expect(screen.getByText("lenient-admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Strikes cleared")).toBeInTheDocument();
    expect(screen.getByText("reviewer@example.com")).toBeInTheDocument();
  });
});
