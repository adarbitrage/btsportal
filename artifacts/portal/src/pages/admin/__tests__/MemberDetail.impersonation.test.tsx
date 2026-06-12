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
const startImpersonation = vi.fn();
const stopImpersonation = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMemberFull: (...args: unknown[]) => getMemberFull(...args),
    getMemberEmailAttempts: vi.fn().mockResolvedValue({ attempts: [], total: 0 }),
    listProducts: vi.fn().mockResolvedValue([]),
    grantProduct: vi.fn(),
    addMemberNote: vi.fn(),
    unlockMember: vi.fn(),
    revokeProduct: vi.fn(),
    cancelMemberEmailChange: vi.fn(),
    updateMemberRole: vi.fn().mockResolvedValue({ changed: false, role: "member" }),
    startImpersonation: (...args: unknown[]) => startImpersonation(...args),
    stopImpersonation: (...args: unknown[]) => stopImpersonation(...args),
  },
}));

let mockRole = "admin";
const mockRefreshAuth = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, role: mockRole }, refreshAuth: mockRefreshAuth }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "55" }),
  useSearch: () => "",
  useLocation: () => ["/admin/members/55", mockNavigate],
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
  mockRole = "admin";
  getMemberFull.mockReset();
  startImpersonation.mockReset();
  stopImpersonation.mockReset();
  mockRefreshAuth.mockReset().mockResolvedValue(undefined);
  mockNavigate.mockReset();
  fetchFlexyLookupMock.mockReset().mockResolvedValue(null);
  getMemberFull.mockResolvedValue(baseMember);
});

describe("MemberDetail — impersonation button (admin role)", () => {
  it("shows 'Log in as member' card when admin views a regular member", async () => {
    render(<MemberDetail />);

    expect(await screen.findByTestId("card-impersonation")).toBeInTheDocument();
    expect(screen.getByTestId("button-impersonate")).toBeInTheDocument();
  });

  it("opens confirmation dialog when 'Log in as member' is clicked; does not call API yet", async () => {
    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-impersonate"));

    expect(await screen.findByTestId("dialog-confirm-impersonate")).toBeInTheDocument();
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it("confirms impersonation: calls API then refreshAuth then navigates to /", async () => {
    startImpersonation.mockResolvedValue({
      member: { id: 55, name: "Jane Member", email: "jane@example.com" },
    });

    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-impersonate"));
    await screen.findByTestId("dialog-confirm-impersonate");
    await userEvent.click(screen.getByTestId("button-confirm-impersonate"));

    await waitFor(() => {
      expect(startImpersonation).toHaveBeenCalledWith(55);
    });
    await waitFor(() => {
      expect(mockRefreshAuth).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/");
    });
  });

  it("cancelling the dialog closes it and never calls startImpersonation", async () => {
    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-impersonate"));
    await screen.findByTestId("dialog-confirm-impersonate");
    await userEvent.click(screen.getByTestId("button-cancel-impersonate"));

    await waitFor(() => {
      expect(screen.queryByTestId("dialog-confirm-impersonate")).not.toBeInTheDocument();
    });
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it("does NOT show 'Log in as member' card when user lacks members:impersonate (support_agent)", async () => {
    mockRole = "support_agent";

    render(<MemberDetail />);

    await screen.findByText("Jane Member");
    expect(screen.queryByTestId("card-impersonation")).not.toBeInTheDocument();
  });

  it("does NOT show 'Log in as member' card when the target member is an admin", async () => {
    getMemberFull.mockResolvedValue({
      ...baseMember,
      member: { ...baseMember.member, role: "admin" },
    });

    render(<MemberDetail />);

    await screen.findByText("Jane Member");
    expect(screen.queryByTestId("card-impersonation")).not.toBeInTheDocument();
  });

  it("does NOT show 'Log in as member' card when the target member is a super_admin", async () => {
    getMemberFull.mockResolvedValue({
      ...baseMember,
      member: { ...baseMember.member, role: "super_admin" },
    });

    render(<MemberDetail />);

    await screen.findByText("Jane Member");
    expect(screen.queryByTestId("card-impersonation")).not.toBeInTheDocument();
  });
});
