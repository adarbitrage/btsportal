import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const fetchFlexyLookup = vi.fn().mockResolvedValue(null);
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: () => <div data-testid="stub-flexy" />,
  FlexyStatusSummary: () => <div data-testid="stub-flexy-summary" />,
  fetchFlexyLookup: (...args: unknown[]) => fetchFlexyLookup(...args),
}));

const getMemberFull = vi.fn();
const revokeMemberSession = vi.fn();
const revokeAllMemberSessions = vi.fn();
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
    revokeMemberSession: (...args: unknown[]) => revokeMemberSession(...args),
    revokeAllMemberSessions: (...args: unknown[]) => revokeAllMemberSessions(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 99, role: "super_admin" } }),
}));

// Gate `members:assign_role` per-test so we can assert the card shows for
// callers that hold it and stays hidden for those that don't. Every other
// permission stays allowed so the rest of the page renders normally.
let assignRoleAllowed = true;
vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>(
    "@/lib/permissions",
  );
  return {
    ...actual,
    hasPermission: (_role: string | undefined, permission: string) =>
      permission === "members:assign_role" ? assignRoleAllowed : true,
  };
});

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  useSearch: () => "",
  useLocation: () => ["/admin/members/42", () => {}],
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import MemberDetail from "@/pages/admin/MemberDetail";

const sessionRow = {
  id: 7,
  createdAt: "2026-06-01T10:00:00.000Z",
  lastSeenAt: "2026-06-09T12:00:00.000Z",
  expiresAt: "2026-06-16T10:00:00.000Z",
  ipAddress: "203.0.113.7",
  userAgent: "Mozilla/5.0 (TestAgent)",
};

function buildMember(activeSessions: unknown[]) {
  return {
    member: {
      id: 42,
      name: "Test Member",
      email: "member@example.com",
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
    phoneHistory: [],
    activeSessions,
  };
}

beforeEach(() => {
  assignRoleAllowed = true;
  fetchFlexyLookup.mockClear();
  fetchFlexyLookup.mockResolvedValue(null);
  getMemberFull.mockReset();
  revokeMemberSession.mockReset();
  revokeAllMemberSessions.mockReset();
  toast.mockReset();
  getMemberFull.mockResolvedValue(buildMember([sessionRow]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — active sessions", () => {
  it("renders the active sessions card with the session's details", async () => {
    render(<MemberDetail />);

    expect(await screen.findByTestId("card-active-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("row-session-7")).toBeInTheDocument();
    expect(screen.getByTestId("text-session-useragent-7")).toHaveTextContent("Mozilla/5.0 (TestAgent)");
    expect(screen.getByTestId("text-session-ip-7")).toHaveTextContent("203.0.113.7");
  });

  it("hides the card when members:assign_role is missing", async () => {
    assignRoleAllowed = false;
    render(<MemberDetail />);

    await screen.findByTestId("admin-layout-stub");
    await waitFor(() => {
      expect(getMemberFull).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("card-active-sessions")).not.toBeInTheDocument();
  });

  it("shows an empty state and no 'End all' button when there are no sessions", async () => {
    getMemberFull.mockResolvedValue(buildMember([]));
    render(<MemberDetail />);

    expect(await screen.findByTestId("text-no-active-sessions")).toBeInTheDocument();
    expect(screen.queryByTestId("button-revoke-all-sessions")).not.toBeInTheDocument();
  });

  it("revokes a single session and shows a success toast", async () => {
    revokeMemberSession.mockResolvedValue({ success: true, id: 42, sessionId: 7, revoked: true });

    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-revoke-session-7"));

    await waitFor(() => {
      expect(revokeMemberSession).toHaveBeenCalledWith(42, 7);
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Session revoked" }),
      );
    });
  });

  it("confirming the 'End all' dialog revokes all sessions", async () => {
    revokeAllMemberSessions.mockResolvedValue({ success: true, id: 42, revokedSessionCount: 1 });

    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-revoke-all-sessions"));

    await screen.findByTestId("dialog-confirm-revoke-all-sessions");
    expect(revokeAllMemberSessions).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("button-confirm-revoke-all-sessions"));

    await waitFor(() => {
      expect(revokeAllMemberSessions).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Sessions revoked" }),
      );
    });
  });

  it("cancelling the 'End all' dialog never revokes", async () => {
    render(<MemberDetail />);

    await userEvent.click(await screen.findByTestId("button-revoke-all-sessions"));
    await screen.findByTestId("dialog-confirm-revoke-all-sessions");
    await userEvent.click(screen.getByTestId("button-cancel-revoke-all-sessions"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("dialog-confirm-revoke-all-sessions"),
      ).not.toBeInTheDocument();
    });
    expect(revokeAllMemberSessions).not.toHaveBeenCalled();
  });
});
