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
const updateMemberRole = vi.fn();
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
    updateMemberRole: (...args: unknown[]) => updateMemberRole(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  // The current admin viewing the page is a different user than the member
  // being edited, and they have permissions returned by the mock below.
  useAuth: () => ({ user: { id: 99, role: "super_admin" } }),
}));

// Use the real ROLE_INFO / getRoleLabel so the test exercises the actual
// label + impact text the component renders for super-admins. We still mock
// hasPermission so the dropdown is shown regardless of the matrix.
vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>(
    "@/lib/permissions",
  );
  return {
    ...actual,
    hasPermission: () => true,
  };
});

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
    role: "compliance_reviewer",
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

beforeEach(() => {
  flexyPanelStub.mockClear();
  fetchFlexyLookup.mockClear();
  fetchFlexyLookup.mockResolvedValue(null);
  getMemberFull.mockReset();
  updateMemberRole.mockReset();
  getMemberFull.mockResolvedValue(baseMember);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — role assignment dropdown", () => {
  it("renders friendly labels for the current role and each option", async () => {
    render(<MemberDetail />);

    // Trigger displays the friendly label for the member's current role.
    const trigger = await screen.findByTestId("select-member-role");
    expect(trigger).toHaveTextContent("Compliance Reviewer (audit-only)");

    // Open the dropdown and verify each option uses friendly labels rather
    // than the raw role identifiers.
    await userEvent.click(trigger);

    expect(
      await screen.findByTestId("option-role-member"),
    ).toHaveTextContent("Member (no admin access)");
    expect(screen.getByTestId("option-role-super_admin")).toHaveTextContent(
      "Super Admin (full access)",
    );
    expect(screen.getByTestId("option-role-admin")).toHaveTextContent(/^Admin$/);
    expect(screen.getByTestId("option-role-support_agent")).toHaveTextContent(
      "Support Agent",
    );
    expect(screen.getByTestId("option-role-content_manager")).toHaveTextContent(
      "Content Manager",
    );
    expect(
      screen.getByTestId("option-role-compliance_reviewer"),
    ).toHaveTextContent("Compliance Reviewer (audit-only)");
  });

  it("opens a confirmation dialog summarising the impact and does not call the API until confirmed", async () => {
    render(<MemberDetail />);

    const trigger = await screen.findByTestId("select-member-role");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId("option-role-super_admin"));

    // Dialog appears with current → next labels and the impact summary.
    const dialog = await screen.findByTestId("dialog-confirm-role-change");
    expect(dialog).toHaveTextContent("Change role?");
    expect(screen.getByTestId("text-role-current")).toHaveTextContent(
      "Compliance Reviewer (audit-only)",
    );
    expect(screen.getByTestId("text-role-next")).toHaveTextContent(
      "Super Admin (full access)",
    );
    expect(screen.getByTestId("text-role-impact")).toHaveTextContent(
      /every admin permission/i,
    );

    // No API call yet — the dropdown stays on the original value until
    // the super-admin confirms.
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it("cancelling the dialog leaves the dropdown on the original value and never calls the API", async () => {
    render(<MemberDetail />);

    const trigger = await screen.findByTestId("select-member-role");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId("option-role-admin"));

    await screen.findByTestId("dialog-confirm-role-change");
    await userEvent.click(screen.getByTestId("button-cancel-role-change"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("dialog-confirm-role-change"),
      ).not.toBeInTheDocument();
    });

    // Dropdown still shows the original role and no role-update request was
    // sent.
    expect(screen.getByTestId("select-member-role")).toHaveTextContent(
      "Compliance Reviewer (audit-only)",
    );
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it("confirming the dialog sends the new role to the API", async () => {
    updateMemberRole.mockResolvedValue({ changed: true, role: "admin" });

    render(<MemberDetail />);

    const trigger = await screen.findByTestId("select-member-role");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId("option-role-admin"));

    await screen.findByTestId("dialog-confirm-role-change");
    await userEvent.click(screen.getByTestId("button-confirm-role-change"));

    await waitFor(() => {
      expect(updateMemberRole).toHaveBeenCalledWith(42, "admin");
    });
  });
});
