import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const fetchFlexyLookupMock = vi.fn().mockResolvedValue(null);
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: () => <div data-testid="stub-flexy" />,
  FlexyStatusSummary: () => <div data-testid="stub-flexy-summary" />,
  fetchFlexyLookup: (...args: unknown[]) => fetchFlexyLookupMock(...args),
}));

const getMemberFull = vi.fn();
const getMemberImpersonationHistory = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMemberFull: (...args: unknown[]) => getMemberFull(...args),
    getMemberImpersonationHistory: (...args: unknown[]) =>
      getMemberImpersonationHistory(...args),
    getMemberEmailAttempts: vi.fn().mockResolvedValue({ attempts: [], total: 0 }),
    listProducts: vi.fn().mockResolvedValue([]),
    grantProduct: vi.fn(),
    addMemberNote: vi.fn(),
    unlockMember: vi.fn(),
    revokeProduct: vi.fn(),
    cancelMemberEmailChange: vi.fn(),
    updateMemberRole: vi.fn().mockResolvedValue({ changed: false, role: "member" }),
    startImpersonation: vi.fn(),
    stopImpersonation: vi.fn(),
  },
}));

const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, role: "super_admin" }, refreshAuth: mockRefreshAuth }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "55" }),
  useSearch: () => "",
  useLocation: () => ["/admin/members/55", vi.fn()],
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>(
    "@/lib/permissions",
  );
  return { ...actual };
});

const baseMember = {
  member: {
    id: 55,
    name: "Jane Member",
    email: "jane@example.com",
    role: "member",
    lockedUntil: null,
    failedLoginCount: 0,
    currentStreak: 0,
  },
  products: [],
  tickets: [],
  trainingProgress: { completedLessons: 0 },
  coachingSessions: [],
  commissions: [],
  community: { posts: 0, comments: 0 },
  adminNotes: [],
  auditHistory: [],
  emailHistory: [],
  emailAttempts: [],
  emailAttemptsTotal: 0,
};

import MemberDetail from "@/pages/admin/MemberDetail";

beforeEach(() => {
  getMemberFull.mockReset().mockResolvedValue(baseMember);
  getMemberImpersonationHistory.mockReset();
  mockRefreshAuth.mockReset().mockResolvedValue(undefined);
  fetchFlexyLookupMock.mockReset().mockResolvedValue(null);
});

describe("MemberDetail — impersonation history tab", () => {
  it("lazily loads sessions when the tab is opened and renders admin + duration", async () => {
    getMemberImpersonationHistory.mockResolvedValue({
      sessions: [
        {
          adminId: 7,
          adminEmail: "ops@example.com",
          startId: 201,
          startedAt: "2026-01-01T10:00:00.000Z",
          stopId: 202,
          stoppedAt: "2026-01-01T10:05:00.000Z",
          durationMs: 5 * 60 * 1000,
        },
        {
          adminId: 7,
          adminEmail: "ops@example.com",
          startId: 203,
          startedAt: "2026-01-02T09:00:00.000Z",
          stopId: null,
          stoppedAt: null,
          durationMs: null,
        },
      ],
      total: 2,
      limit: 200,
    });

    render(<MemberDetail />);

    // Tab is not fetched until opened.
    const tab = await screen.findByTestId("tab-impersonation");
    expect(getMemberImpersonationHistory).not.toHaveBeenCalled();

    await userEvent.click(tab);

    await waitFor(() => {
      expect(getMemberImpersonationHistory).toHaveBeenCalledWith(55);
    });

    // Paired session: admin email + a formatted duration badge.
    const paired = await screen.findByTestId("impersonation-session-201");
    expect(paired).toBeInTheDocument();
    expect(screen.getByTestId("impersonation-session-admin-201")).toHaveTextContent(
      "ops@example.com",
    );
    expect(paired).toHaveTextContent("5m");
    expect(screen.getByTestId("link-impersonation-201")).toBeInTheDocument();

    // Ongoing session shows the "ongoing / unknown" badge.
    const ongoing = screen.getByTestId("impersonation-session-203");
    expect(ongoing).toHaveTextContent("ongoing / unknown");
  });

  it("shows the empty state when the member has no impersonation sessions", async () => {
    getMemberImpersonationHistory.mockResolvedValue({ sessions: [], total: 0, limit: 200 });

    render(<MemberDetail />);
    await userEvent.click(await screen.findByTestId("tab-impersonation"));

    expect(await screen.findByTestId("text-impersonation-empty")).toBeInTheDocument();
  });
});
