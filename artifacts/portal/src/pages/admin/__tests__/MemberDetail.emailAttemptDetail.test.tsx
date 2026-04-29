import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const flexyPanelStub = vi.fn((_props: Record<string, unknown>) => (
  <div data-testid="stub-flexy" />
));
const fetchFlexyLookup = vi.fn().mockResolvedValue(null);
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: (props: Record<string, unknown>) => flexyPanelStub(props),
  FlexyStatusSummary: () => <div data-testid="stub-flexy-summary" />,
  fetchFlexyLookup: (...args: unknown[]) => fetchFlexyLookup(...args),
}));

const getMemberFull = vi.fn();
const getMemberEmailAttempts = vi.fn();
const getMemberEmailAttemptDetail = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMemberFull: (...args: unknown[]) => getMemberFull(...args),
    getMemberEmailAttempts: (...args: unknown[]) => getMemberEmailAttempts(...args),
    getMemberEmailAttemptDetail: (...args: unknown[]) =>
      getMemberEmailAttemptDetail(...args),
    listProducts: vi.fn().mockResolvedValue([]),
    grantProduct: vi.fn(),
    addMemberNote: vi.fn(),
    unlockMember: vi.fn(),
    revokeProduct: vi.fn(),
    cancelMemberEmailChange: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

vi.mock("@/lib/permissions", () => ({
  hasPermission: () => true,
  ADMIN_ROLES: ["admin", "super_admin"],
  ROLE_INFO: {
    member: { label: "Member", impact: "" },
    admin: { label: "Admin", impact: "" },
    super_admin: { label: "Super Admin", impact: "" },
  },
  getRoleLabel: (r: string) => r,
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

const baseMember = {
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
};

beforeEach(() => {
  flexyPanelStub.mockClear();
  fetchFlexyLookup.mockClear();
  fetchFlexyLookup.mockResolvedValue(null);
  getMemberFull.mockReset();
  getMemberEmailAttempts.mockReset();
  getMemberEmailAttemptDetail.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — email-change attempt detail dialog", () => {
  it("opens a detail dialog with the audit trail and the next attempt when a row is clicked", async () => {
    const requestedAt = new Date(2026, 0, 10, 9, 0, 0).toISOString();
    const expiresAt = new Date(2026, 0, 11, 9, 0, 0).toISOString();
    const nextRequestedAt = new Date(2026, 0, 12, 9, 0, 0).toISOString();
    const confirmedAt = new Date(2026, 0, 12, 9, 30, 0).toISOString();

    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [
        {
          id: 5001,
          newEmail: "first-target@example.test",
          requestedAt,
          expiresAt,
          confirmedAt: null,
          status: "expired",
        },
      ],
      emailAttemptsTotal: 1,
      emailAttemptsPageSize: 50,
    });

    getMemberEmailAttemptDetail.mockResolvedValue({
      attempt: {
        id: 5001,
        newEmail: "first-target@example.test",
        requestedAt,
        expiresAt,
        confirmedAt: null,
        status: "expired",
      },
      auditEntries: [
        {
          id: 901,
          actionType: "view_member",
          actorEmail: "admin@example.test",
          description: "Admin viewed member 42",
          createdAt: new Date(2026, 0, 10, 10, 0, 0).toISOString(),
        },
      ],
      nextAttempt: {
        id: 5002,
        newEmail: "second-target@example.test",
        requestedAt: nextRequestedAt,
        expiresAt: null,
        confirmedAt,
        status: "confirmed",
      },
      subsequentConfirmation: {
        id: 77,
        oldEmail: "member@example.com",
        newEmail: "second-target@example.test",
        changedAt: confirmedAt,
      },
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    const row = screen.getByTestId("row-email-attempt-5001");
    await userEvent.click(row);

    // The detail endpoint is called with the right ids.
    await waitFor(() => {
      expect(getMemberEmailAttemptDetail).toHaveBeenCalledWith(42, 5001);
    });

    // Dialog renders all three sections.
    const dialog = await screen.findByTestId("dialog-email-attempt-detail");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("section-attempt-detail-attempt")).toBeInTheDocument();
    expect(screen.getByTestId("text-attempt-detail-email")).toHaveTextContent(
      "first-target@example.test",
    );
    expect(screen.getByTestId("section-attempt-detail-resolution")).toBeInTheDocument();
    expect(screen.getByTestId("row-attempt-detail-confirmation")).toBeInTheDocument();
    expect(
      screen.getByTestId("text-attempt-detail-confirmation-new"),
    ).toHaveTextContent("second-target@example.test");
    expect(screen.getByTestId("row-attempt-detail-next-attempt")).toBeInTheDocument();
    expect(
      screen.getByTestId("text-attempt-detail-next-attempt-email"),
    ).toHaveTextContent("second-target@example.test");
    expect(screen.getByTestId("section-attempt-detail-audit")).toBeInTheDocument();
    expect(screen.getByTestId("row-attempt-detail-audit-901")).toBeInTheDocument();
    expect(
      screen.getByTestId("text-attempt-detail-audit-description-901"),
    ).toHaveTextContent("Admin viewed member 42");
  });

  it("opens the same detail dialog for a confirmed attempt row", async () => {
    const requestedAt = new Date(2026, 0, 5, 12, 0, 0).toISOString();
    const confirmedAt = new Date(2026, 0, 5, 12, 30, 0).toISOString();

    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [
        {
          id: 6001,
          newEmail: "confirmed-target@example.test",
          requestedAt,
          expiresAt: null,
          confirmedAt,
          status: "confirmed",
        },
      ],
      emailAttemptsTotal: 1,
      emailAttemptsPageSize: 50,
    });

    getMemberEmailAttemptDetail.mockResolvedValue({
      attempt: {
        id: 6001,
        newEmail: "confirmed-target@example.test",
        requestedAt,
        expiresAt: null,
        confirmedAt,
        status: "confirmed",
      },
      auditEntries: [],
      nextAttempt: null,
      subsequentConfirmation: {
        id: 88,
        oldEmail: "member@example.com",
        newEmail: "confirmed-target@example.test",
        changedAt: confirmedAt,
      },
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    const row = screen.getByTestId("row-email-attempt-6001");
    await userEvent.click(row);

    await waitFor(() => {
      expect(getMemberEmailAttemptDetail).toHaveBeenCalledWith(42, 6001);
    });

    expect(await screen.findByTestId("dialog-email-attempt-detail")).toBeInTheDocument();
    expect(
      screen.getByTestId("text-attempt-detail-confirmation-new"),
    ).toHaveTextContent("confirmed-target@example.test");
    // Empty audit + no further attempts use their dedicated empty-state hooks.
    expect(screen.getByTestId("text-attempt-detail-no-audit")).toBeInTheDocument();
    expect(screen.queryByTestId("row-attempt-detail-next-attempt")).not.toBeInTheDocument();
  });
});
