import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const flexyPanelStub = vi.fn(() => <div data-testid="stub-flexy" />);
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
  ADMIN_ROLES: ["admin", "super_admin"] as string[],
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

function makeAttempt(
  i: number,
  status: "abandoned" | "expired" | "pending" | "confirmed" | "cancelled_by_admin" = "abandoned",
) {
  return {
    id: 1000 + i,
    newEmail: `attempt-${i}@example.test`,
    requestedAt: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
    expiresAt: new Date(2026, 0, 2, 0, 0, 0, i).toISOString(),
    confirmedAt: null,
    cancelledAt: status === "cancelled_by_admin"
      ? new Date(2026, 0, 1, 1, 0, 0, i).toISOString()
      : null,
    cancelledByAdminId: status === "cancelled_by_admin" ? 99 : null,
    cancelledByAdminName: status === "cancelled_by_admin" ? "Cancel Admin" : null,
    cancelledByAdminEmail: status === "cancelled_by_admin" ? "cancel@example.test" : null,
    status,
  };
}

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

describe("MemberDetail email-change attempts paging", () => {
  it("shows the 'Show older' button when total exceeds the loaded page and appends results on click", async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => makeAttempt(i, "abandoned"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 60,
      emailAttemptsPageSize: 50,
    });

    const olderPage = Array.from({ length: 10 }, (_, i) => makeAttempt(50 + i, "abandoned"));
    getMemberEmailAttempts.mockResolvedValue({
      attempts: olderPage,
      total: 60,
      offset: 50,
      limit: 50,
      hasMore: false,
    });

    const user = userEvent.setup();
    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
      /Showing 50 of 60/i,
    );
    // First-page rows are rendered.
    expect(screen.getByTestId("row-email-attempt-1000")).toBeInTheDocument();
    expect(screen.queryByTestId("row-email-attempt-1050")).not.toBeInTheDocument();

    const button = screen.getByTestId("button-load-older-email-attempts");
    await user.click(button);

    await waitFor(() => {
      expect(getMemberEmailAttempts).toHaveBeenCalledWith(42, { offset: 50, limit: 50 });
    });

    // Older rows are appended; pagination updates and the button disappears
    // because no more pages remain.
    await screen.findByTestId("row-email-attempt-1059");
    expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
      /Showing 60 of 60/i,
    );
    expect(screen.queryByTestId("button-load-older-email-attempts")).not.toBeInTheDocument();
  });

  it("hides the 'Show older' button when all attempts are already loaded", async () => {
    const firstPage = Array.from({ length: 5 }, (_, i) => makeAttempt(i, "abandoned"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 5,
      emailAttemptsPageSize: 50,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("button-load-older-email-attempts")).not.toBeInTheDocument();
    expect(getMemberEmailAttempts).not.toHaveBeenCalled();
  });

  it("refetches with status=cancelled_by_admin when the admin filters to cancelled-by-admin only", async () => {
    // Page 1 of /full has noise + 1 cancelled row, with a much larger total
    // (60). When the admin picks "Cancelled by admin", the page must
    // refetch from the server with status=cancelled_by_admin so the count
    // summary and pager reflect the filtered total — not just the cancelled
    // rows that happened to be in the loaded page.
    const firstPage = [
      ...Array.from({ length: 49 }, (_, i) => makeAttempt(i, "abandoned")),
      makeAttempt(49, "cancelled_by_admin"),
    ];
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 60,
      emailAttemptsPageSize: 50,
    });

    const filteredFirstPage = [
      makeAttempt(49, "cancelled_by_admin"),
      ...Array.from({ length: 4 }, (_, i) =>
        makeAttempt(60 + i, "cancelled_by_admin"),
      ),
    ];
    getMemberEmailAttempts.mockResolvedValueOnce({
      attempts: filteredFirstPage,
      total: 5,
      offset: 0,
      limit: 50,
      hasMore: false,
      status: "cancelled_by_admin",
    });

    const user = userEvent.setup();
    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // Before filtering, the count shows the full total.
    expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
      /Showing 50 of 60/i,
    );

    // Pick the cancelled-by-admin option from the filter dropdown.
    await user.click(screen.getByTestId("select-email-attempts-status"));
    await user.click(
      screen.getByTestId("option-email-attempts-status-cancelled_by_admin"),
    );

    await waitFor(() => {
      expect(getMemberEmailAttempts).toHaveBeenCalledWith(42, {
        offset: 0,
        limit: 50,
        status: "cancelled_by_admin",
      });
    });

    // After filtering, the count summary reflects the filtered total only.
    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 5 of 5 cancelled-by-admin attempts/i,
      );
    });
    // The unrelated abandoned rows from page 1 should no longer render
    // (the loaded list was replaced with the server-filtered page).
    expect(screen.queryByTestId("row-email-attempt-1000")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-email-attempt-1049")).toBeInTheDocument();
  });

  it("paginates within the filtered set when status filter is active", async () => {
    // Filter is on cancelled_by_admin, server reports total=70 and only
    // returns 50 on page 1. "Show older" must request status=cancelled_by_admin
    // so the second page also returns cancelled rows, not unfiltered noise.
    const seedPage = Array.from({ length: 5 }, (_, i) => makeAttempt(i, "abandoned"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: seedPage,
      emailAttemptsTotal: 5,
      emailAttemptsPageSize: 50,
    });

    const filteredPage1 = Array.from({ length: 50 }, (_, i) =>
      makeAttempt(i, "cancelled_by_admin"),
    );
    const filteredPage2 = Array.from({ length: 20 }, (_, i) =>
      makeAttempt(50 + i, "cancelled_by_admin"),
    );
    getMemberEmailAttempts
      .mockResolvedValueOnce({
        attempts: filteredPage1,
        total: 70,
        offset: 0,
        limit: 50,
        hasMore: true,
        status: "cancelled_by_admin",
      })
      .mockResolvedValueOnce({
        attempts: filteredPage2,
        total: 70,
        offset: 50,
        limit: 50,
        hasMore: false,
        status: "cancelled_by_admin",
      });

    const user = userEvent.setup();
    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId("select-email-attempts-status"));
    await user.click(
      screen.getByTestId("option-email-attempts-status-cancelled_by_admin"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 50 of 70 cancelled-by-admin attempts/i,
      );
    });

    await user.click(screen.getByTestId("button-load-older-email-attempts"));

    await waitFor(() => {
      expect(getMemberEmailAttempts).toHaveBeenLastCalledWith(42, {
        offset: 50,
        limit: 50,
        status: "cancelled_by_admin",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 70 of 70 cancelled-by-admin attempts/i,
      );
    });
  });

  it("restores the unfiltered loaded page when the admin clears the filter (without an extra fetch)", async () => {
    // Switching back to "All statuses" should restore the rows /full
    // already embedded — no additional round-trip.
    const firstPage = Array.from({ length: 50 }, (_, i) => makeAttempt(i, "abandoned"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 60,
      emailAttemptsPageSize: 50,
    });
    getMemberEmailAttempts.mockResolvedValueOnce({
      attempts: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: false,
      status: "cancelled_by_admin",
    });

    const user = userEvent.setup();
    render(<MemberDetail />);
    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId("select-email-attempts-status"));
    await user.click(
      screen.getByTestId("option-email-attempts-status-cancelled_by_admin"),
    );
    await waitFor(() => {
      expect(getMemberEmailAttempts).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByTestId("button-clear-email-attempts-status"));

    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 50 of 60/i,
      );
    });
    // Clearing back to "all" should not re-hit the server — the embedded
    // /full data is reused.
    expect(getMemberEmailAttempts).toHaveBeenCalledTimes(1);
  });

  it("preserves rows the admin already paginated into when the filter is cleared", async () => {
    // Admin loads page 1 (50 rows) via /full, then clicks "Show older" to
    // pull a second unfiltered page (10 more rows -> 60 total loaded).
    // Then they apply the cancelled-by-admin filter, and finally clear it.
    // Clearing should restore all 60 rows they had loaded, NOT drop them
    // back to just the embedded /full first page.
    const firstPage = Array.from({ length: 50 }, (_, i) => makeAttempt(i, "abandoned"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 60,
      emailAttemptsPageSize: 50,
    });

    const olderPage = Array.from({ length: 10 }, (_, i) => makeAttempt(50 + i, "abandoned"));
    getMemberEmailAttempts.mockImplementation((_id: number, params: { status?: string }) => {
      if (params?.status === "cancelled_by_admin") {
        return Promise.resolve({
          attempts: [],
          total: 0,
          offset: 0,
          limit: 50,
          hasMore: false,
          status: "cancelled_by_admin",
        });
      }
      return Promise.resolve({
        attempts: olderPage,
        total: 60,
        offset: 50,
        limit: 50,
        hasMore: false,
      });
    });

    const user = userEvent.setup();
    render(<MemberDetail />);
    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // Step 1: paginate unfiltered to load all 60 rows.
    await user.click(screen.getByTestId("button-load-older-email-attempts"));
    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 60 of 60/i,
      );
    });

    // Step 2: apply the filter — server returns 0 matching rows.
    await user.click(screen.getByTestId("select-email-attempts-status"));
    await user.click(
      screen.getByTestId("option-email-attempts-status-cancelled_by_admin"),
    );
    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-empty")).toBeInTheDocument();
    });

    // Step 3: clear the filter. The 60 previously-loaded unfiltered rows
    // must come back, without an extra fetch (the snapshot is restored).
    const callsBeforeClear = getMemberEmailAttempts.mock.calls.length;
    await user.click(screen.getByTestId("button-clear-email-attempts-status"));
    await waitFor(() => {
      expect(screen.getByTestId("text-email-attempts-pagination")).toHaveTextContent(
        /Showing 60 of 60/i,
      );
    });
    expect(getMemberEmailAttempts).toHaveBeenCalledTimes(callsBeforeClear);
  });

  it("renders confirmed attempts as clickable rows and exposes 'Show older' when more pages exist", async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => makeAttempt(i, "confirmed"));
    getMemberFull.mockResolvedValue({
      ...baseMember,
      emailAttempts: firstPage,
      emailAttemptsTotal: 75,
      emailAttemptsPageSize: 50,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(screen.getByTestId("card-email-attempts")).toBeInTheDocument();
    // Confirmed rows are now clickable detail-panel surfaces too, so the
    // empty-state copy should NOT appear when confirmed rows exist.
    expect(screen.queryByTestId("text-email-attempts-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId(`row-email-attempt-${firstPage[0].id}`)).toBeInTheDocument();
    expect(screen.getByTestId("button-load-older-email-attempts")).toBeInTheDocument();
  });
});
