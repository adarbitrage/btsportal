import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const fetchFlexyLookup = vi.fn();
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: () => <div data-testid="stub-flexy-regenerate-panel" />,
  fetchFlexyLookup: (...args: unknown[]) => fetchFlexyLookup(...args),
}));

const getMemberFull = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMemberFull: (...args: unknown[]) => getMemberFull(...args),
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
  id: 42,
  name: "Test Member",
  email: "member@example.com",
  role: "member",
  lockedUntil: null,
  failedLoginCount: 0,
  currentStreak: 0,
};

const baseResponse = {
  member: baseMember,
  products: [],
  tickets: [],
  trainingProgress: [],
  coachingSessions: [],
  commissions: [],
  community: [],
  adminNotes: [],
  auditHistory: [],
  emailHistory: [],
  emailAttempts: [],
};

beforeEach(() => {
  getMemberFull.mockReset();
  fetchFlexyLookup.mockReset();
  fetchFlexyLookup.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail Phone history card", () => {
  it("renders the phone history card and per-row testids when phoneHistory has rows", async () => {
    getMemberFull.mockResolvedValue({
      ...baseResponse,
      phoneHistory: [
        {
          id: 101,
          oldPhone: "+15550000001",
          newPhone: "+15550000002",
          changedAt: new Date("2026-04-20T12:00:00Z").toISOString(),
        },
        {
          id: 202,
          oldPhone: "+15550000002",
          newPhone: "+15550000003",
          changedAt: new Date("2026-04-25T08:30:00Z").toISOString(),
        },
      ],
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(getMemberFull).toHaveBeenCalledWith(42);

    // Card itself.
    expect(await screen.findByTestId("card-phone-history")).toBeInTheDocument();

    // Row + per-row testids for both rows.
    const row1 = screen.getByTestId("row-phone-history-101");
    expect(row1).toBeInTheDocument();
    expect(screen.getByTestId("text-old-phone-101")).toHaveTextContent("+15550000001");
    expect(screen.getByTestId("text-new-phone-101")).toHaveTextContent("+15550000002");

    const row2 = screen.getByTestId("row-phone-history-202");
    expect(row2).toBeInTheDocument();
    expect(screen.getByTestId("text-old-phone-202")).toHaveTextContent("+15550000002");
    expect(screen.getByTestId("text-new-phone-202")).toHaveTextContent("+15550000003");
  });

  it("omits the phone history card when phoneHistory is empty", async () => {
    getMemberFull.mockResolvedValue({
      ...baseResponse,
      phoneHistory: [],
    });

    render(<MemberDetail />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId("card-phone-history")).not.toBeInTheDocument();
  });
});
