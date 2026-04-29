import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  ADMIN_ROLES: ["admin", "support"],
}));

let currentSearch = "";
vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  useSearch: () => currentSearch,
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

const phoneHistoryFixture = [
  {
    id: 9001,
    oldPhone: "+15551112222",
    newPhone: "+15553334444",
    changedAt: new Date(2026, 0, 5, 10, 0, 0).toISOString(),
  },
  {
    id: 9002,
    oldPhone: "+15555556666",
    newPhone: "+15557778888",
    changedAt: new Date(2026, 0, 6, 11, 0, 0).toISOString(),
  },
];

beforeEach(() => {
  flexyPanelStub.mockClear();
  fetchFlexyLookup.mockClear();
  fetchFlexyLookup.mockResolvedValue(null);
  getMemberFull.mockReset();
  getMemberEmailAttempts.mockReset();
  currentSearch = "";
  // jsdom doesn't implement scrollIntoView, but the component invokes it
  // when a highlighted row is rendered.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  } else {
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — phone history matched-search highlight", () => {
  it("renders no highlight on any phone-history row when highlightOldPhone is absent", async () => {
    currentSearch = "";
    getMemberFull.mockResolvedValue({
      ...baseMember,
      phoneHistory: phoneHistoryFixture,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    // Both rows must be present and explicitly marked as not highlighted.
    const row1 = await screen.findByTestId("row-phone-history-9001");
    const row2 = await screen.findByTestId("row-phone-history-9002");
    expect(row1).toHaveAttribute("data-highlighted", "false");
    expect(row2).toHaveAttribute("data-highlighted", "false");

    // No "Matched search" badge should exist on any row.
    expect(
      screen.queryByTestId("badge-matched-old-phone-9001"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("badge-matched-old-phone-9002"),
    ).not.toBeInTheDocument();
  });

  it("highlights exactly the row whose oldPhone matches highlightOldPhone and shows the 'Matched search' badge", async () => {
    // Mirror the URL GlobalSearch builds: ?highlightOldPhone=<encoded oldPhone>.
    const targetOldPhone = phoneHistoryFixture[0].oldPhone;
    currentSearch = `highlightOldPhone=${encodeURIComponent(targetOldPhone)}`;

    getMemberFull.mockResolvedValue({
      ...baseMember,
      phoneHistory: phoneHistoryFixture,
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    const matchedRow = await screen.findByTestId("row-phone-history-9001");
    const otherRow = await screen.findByTestId("row-phone-history-9002");

    // data-highlighted must be true only on the matching row.
    expect(matchedRow).toHaveAttribute("data-highlighted", "true");
    expect(otherRow).toHaveAttribute("data-highlighted", "false");

    // The "Matched search" badge must exist only on the matching row.
    const matchedBadge = within(matchedRow).getByTestId(
      "badge-matched-old-phone-9001",
    );
    expect(matchedBadge).toHaveTextContent(/matched search/i);
    expect(
      screen.queryByTestId("badge-matched-old-phone-9002"),
    ).not.toBeInTheDocument();
  });
});
