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

function makeAttempt(i: number, status: "abandoned" | "expired" | "pending" | "confirmed" = "abandoned") {
  return {
    id: 1000 + i,
    newEmail: `attempt-${i}@example.test`,
    requestedAt: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
    expiresAt: new Date(2026, 0, 2, 0, 0, 0, i).toISOString(),
    confirmedAt: null,
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
