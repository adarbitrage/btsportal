import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const flexyPanelStub = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="stub-flexy-regenerate-panel"
    data-user-id={String(props.userId)}
    data-history-container-test-id={String(props.historyContainerTestId)}
    data-history-item-test-id-prefix={String(props.historyItemTestIdPrefix)}
    data-history-header-label={String(props.historyHeaderLabel)}
    data-show-history-actor-filter={String(props.showHistoryActorFilter)}
  />
));
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: (props: Record<string, unknown>) => flexyPanelStub(props),
  fetchFlexyLookup: vi.fn().mockResolvedValue(null),
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

beforeEach(() => {
  flexyPanelStub.mockClear();
  getMemberFull.mockReset();
  getMemberFull.mockResolvedValue({
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
    trainingProgress: [],
    coachingSessions: [],
    commissions: [],
    community: [],
    adminNotes: [],
    auditHistory: [],
    emailHistory: [],
    emailAttempts: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail Password Resets tab", () => {
  it("renders the FlexyRegeneratePanel with the member id and history wiring when the Password Resets tab is selected", async () => {
    const user = userEvent.setup();
    render(<MemberDetail />);

    // Wait for the member load to complete and the page chrome to render.
    await waitFor(() => {
      expect(screen.queryByText(/Loading member details/i)).not.toBeInTheDocument();
    });

    expect(getMemberFull).toHaveBeenCalledWith(42);

    // Click the Password Resets tab trigger.
    const tabTrigger = await screen.findByTestId("tab-password-resets");
    await user.click(tabTrigger);

    // The stubbed FlexyRegeneratePanel should be rendered inside the active tab.
    const stub = await screen.findByTestId("stub-flexy-regenerate-panel");
    expect(stub).toBeInTheDocument();

    // Verify the props the page passes through so the Member Detail history
    // surface stays distinct from the Apps Manager card.
    expect(stub.dataset.userId).toBe("42");
    expect(stub.dataset.historyContainerTestId).toBe("member-flexy-reset-history");
    expect(stub.dataset.historyItemTestIdPrefix).toBe("member-flexy-history");
    expect(stub.dataset.historyHeaderLabel).toBe(
      "All password reset events for this member",
    );
    expect(stub.dataset.showHistoryActorFilter).toBe("true");

    expect(flexyPanelStub).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        historyContainerTestId: "member-flexy-reset-history",
        historyItemTestIdPrefix: "member-flexy-history",
        historyHeaderLabel: "All password reset events for this member",
        showHistoryActorFilter: true,
      }),
    );
  });
});
