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
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMemberFull: (...args: unknown[]) => getMemberFull(...args),
    getMemberEmailAttempts: (...args: unknown[]) => getMemberEmailAttempts(...args),
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
  ADMIN_ROLES: ["admin", "support", "auditor"],
  ROLE_INFO: {
    member: { label: "Member", impact: "" },
    admin: { label: "Admin", impact: "" },
    support: { label: "Support", impact: "" },
    auditor: { label: "Auditor", impact: "" },
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — admin-cancelled email-change attempt rendering", () => {
  it("renders a 'Cancelled by admin' badge with the cancelling admin's name and timestamp", async () => {
    const cancelledAt = new Date(2026, 0, 15, 14, 30, 0).toISOString();
    const requestedAt = new Date(2026, 0, 14, 9, 0, 0).toISOString();
    const expiresAt = new Date(2026, 0, 15, 9, 0, 0).toISOString();

    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [
        {
          id: 7001,
          newEmail: "swap-target@example.test",
          requestedAt,
          expiresAt,
          confirmedAt: null,
          cancelledAt,
          cancelledByAdminId: 99,
          cancelledByAdminName: "Jane Admin",
          cancelledByAdminEmail: "jane.admin@example.test",
          dismissedByMemberAt: null,
          status: "cancelled_by_admin",
        },
      ],
      emailAttemptsTotal: 1,
      emailAttemptsPageSize: 50,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // Badge for the cancelled status uses the dedicated test id and reads
    // "Cancelled by admin" so support can spot it at a glance.
    const badge = await screen.findByTestId("badge-attempt-status-cancelled_by_admin");
    expect(badge).toHaveTextContent(/cancelled by admin/i);

    // The byline carries the cancelling admin's name + the cancelled-at
    // timestamp so support knows who pulled the trigger and when.
    const byline = screen.getByTestId("text-attempt-cancelled-by-7001");
    expect(byline).toHaveTextContent(/Jane Admin/);
    expect(byline).toHaveTextContent(/Jan 15, 2026/);

    // Cancelled rows are not "pending", so there must be no inline "Cancel
    // pending change" button on this row.
    expect(
      screen.queryByTestId("button-cancel-email-attempt-7001"),
    ).not.toBeInTheDocument();
  });

  it("falls back to admin email then 'admin #ID' when the admin name is missing", async () => {
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [
        {
          id: 7100,
          newEmail: "email-fallback@example.test",
          requestedAt: new Date(2026, 1, 1, 10, 0, 0).toISOString(),
          expiresAt: null,
          confirmedAt: null,
          cancelledAt: new Date(2026, 1, 2, 10, 0, 0).toISOString(),
          cancelledByAdminId: 5,
          cancelledByAdminName: null,
          cancelledByAdminEmail: "ops@example.test",
          dismissedByMemberAt: null,
          status: "cancelled_by_admin",
        },
        {
          id: 7101,
          newEmail: "id-fallback@example.test",
          requestedAt: new Date(2026, 1, 3, 10, 0, 0).toISOString(),
          expiresAt: null,
          confirmedAt: null,
          cancelledAt: new Date(2026, 1, 4, 10, 0, 0).toISOString(),
          cancelledByAdminId: 9,
          cancelledByAdminName: null,
          cancelledByAdminEmail: null,
          dismissedByMemberAt: null,
          status: "cancelled_by_admin",
        },
      ],
      emailAttemptsTotal: 2,
      emailAttemptsPageSize: 50,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("text-attempt-cancelled-by-7100")).toHaveTextContent(
      /ops@example.test/,
    );
    expect(screen.getByTestId("text-attempt-cancelled-by-7101")).toHaveTextContent(
      /admin #9/,
    );
  });

  it("appends an admin-cancelled row from the older-attempts pager and renders its badge", async () => {
    // Older admin-cancelled rows can live up to a year, so the "Show older"
    // pager must be able to surface them with the same badge + admin byline.
    const olderRequestedAt = new Date(2025, 6, 1, 9, 0, 0).toISOString();
    const olderExpiresAt = new Date(2025, 6, 2, 9, 0, 0).toISOString();
    const olderCancelledAt = new Date(2025, 6, 1, 18, 0, 0).toISOString();

    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [],
      emailAttemptsTotal: 1,
      emailAttemptsPageSize: 50,
    });
    getMemberEmailAttempts.mockResolvedValue({
      attempts: [
        {
          id: 8200,
          newEmail: "old-cancelled@example.test",
          requestedAt: olderRequestedAt,
          expiresAt: olderExpiresAt,
          confirmedAt: null,
          cancelledAt: olderCancelledAt,
          cancelledByAdminId: 12,
          cancelledByAdminName: "Old Admin",
          cancelledByAdminEmail: "old.admin@example.test",
          dismissedByMemberAt: null,
          status: "cancelled_by_admin",
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    });

    const user = userEvent.setup();
    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // The card still renders because hasMoreAttempts is true even though the
    // first page came back empty.
    const button = await screen.findByTestId("button-load-older-email-attempts");
    await user.click(button);

    const badge = await screen.findByTestId("badge-attempt-status-cancelled_by_admin");
    expect(badge).toHaveTextContent(/cancelled by admin/i);

    const byline = screen.getByTestId("text-attempt-cancelled-by-8200");
    expect(byline).toHaveTextContent(/Old Admin/);
    expect(byline).toHaveTextContent(/Jul 1, 2025/);
  });

  it("renders the member-dismissed-banner indicator next to the cancelled-by-admin badge", async () => {
    // Two cancelled-by-admin rows: one the member already dismissed in the
    // portal (so support sees the dismissal date), and one they have not
    // (so support sees the "not yet dismissed" fallback). Both indicators
    // sit on the same row as the existing cancelled-by-admin badge so
    // support staff can confirm at a glance whether the member ever
    // acknowledged the cancellation.
    const dismissedAt = new Date(2026, 2, 10, 16, 45, 0).toISOString();

    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: [
        {
          id: 7300,
          newEmail: "dismissed@example.test",
          requestedAt: new Date(2026, 2, 9, 9, 0, 0).toISOString(),
          expiresAt: null,
          confirmedAt: null,
          cancelledAt: new Date(2026, 2, 9, 18, 0, 0).toISOString(),
          cancelledByAdminId: 11,
          cancelledByAdminName: "Cancel Admin",
          cancelledByAdminEmail: "ca@example.test",
          dismissedByMemberAt: dismissedAt,
          status: "cancelled_by_admin",
        },
        {
          id: 7301,
          newEmail: "not-dismissed@example.test",
          requestedAt: new Date(2026, 2, 11, 9, 0, 0).toISOString(),
          expiresAt: null,
          confirmedAt: null,
          cancelledAt: new Date(2026, 2, 11, 18, 0, 0).toISOString(),
          cancelledByAdminId: 11,
          cancelledByAdminName: "Cancel Admin",
          cancelledByAdminEmail: "ca@example.test",
          dismissedByMemberAt: null,
          status: "cancelled_by_admin",
        },
      ],
      emailAttemptsTotal: 2,
      emailAttemptsPageSize: 50,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // The dismissed row shows the date the member acknowledged the banner.
    const dismissedIndicator = screen.getByTestId("text-attempt-dismissed-7300");
    expect(dismissedIndicator).toHaveAttribute("data-dismissed", "true");
    expect(dismissedIndicator).toHaveTextContent(/Member dismissed banner on/i);
    expect(dismissedIndicator).toHaveTextContent(/Mar 10, 2026/);

    // The not-yet-dismissed row makes that explicit so support doesn't
    // misread "no date" as "we don't know".
    const notDismissedIndicator = screen.getByTestId("text-attempt-dismissed-7301");
    expect(notDismissedIndicator).toHaveAttribute("data-dismissed", "false");
    expect(notDismissedIndicator).toHaveTextContent(
      /not yet dismissed the cancellation banner/i,
    );

    // The new indicator must sit on the same row container as the
    // existing cancelled-by-admin badge, so support staff see the two
    // pieces of context together rather than chasing them across the page.
    const dismissedRow = screen.getByTestId("row-email-attempt-7300");
    expect(dismissedRow).toContainElement(dismissedIndicator);
    // Both rows render a cancelled-by-admin badge; confirm that the
    // dismissed-row contains its own cancelled-by-admin badge so support
    // sees the two pieces of context (cancelled + dismissed) together.
    const cancelledByAdminBadges = screen.getAllByTestId(
      "badge-attempt-status-cancelled_by_admin",
    );
    expect(cancelledByAdminBadges).toHaveLength(2);
    const matchingBadge = cancelledByAdminBadges.find((badge) =>
      dismissedRow.contains(badge),
    );
    expect(matchingBadge).toBeDefined();
  });
});
