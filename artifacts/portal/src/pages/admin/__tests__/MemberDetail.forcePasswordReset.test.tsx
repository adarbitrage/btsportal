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
const forceMemberPasswordReset = vi.fn();
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
    forceMemberPasswordReset: (...args: unknown[]) =>
      forceMemberPasswordReset(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 99, role: "super_admin" } }),
}));

// Gate `members:assign_role` per-test so we can assert the control shows for
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
  emailAttempts: [],
  emailAttemptsTotal: 0,
};

beforeEach(() => {
  assignRoleAllowed = true;
  fetchFlexyLookup.mockClear();
  fetchFlexyLookup.mockResolvedValue(null);
  getMemberFull.mockReset();
  forceMemberPasswordReset.mockReset();
  toast.mockReset();
  getMemberFull.mockResolvedValue(baseMember);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberDetail — force password reset", () => {
  it("shows the Force password reset control for callers with members:assign_role", async () => {
    render(<MemberDetail />);

    expect(
      await screen.findByTestId("button-force-password-reset"),
    ).toBeInTheDocument();
  });

  it("hides the Force password reset control when members:assign_role is missing", async () => {
    assignRoleAllowed = false;
    render(<MemberDetail />);

    // Wait for the page to finish loading before asserting absence so we
    // don't pass simply because the data hasn't arrived yet.
    await screen.findByTestId("admin-layout-stub");
    await waitFor(() => {
      expect(getMemberFull).toHaveBeenCalled();
    });

    expect(
      screen.queryByTestId("button-force-password-reset"),
    ).not.toBeInTheDocument();
  });

  it("confirming the dialog calls forceMemberPasswordReset and shows the success toast", async () => {
    forceMemberPasswordReset.mockResolvedValue({
      success: true,
      id: 42,
      mustChangePassword: true,
      alreadySet: false,
    });

    render(<MemberDetail />);

    await userEvent.click(
      await screen.findByTestId("button-force-password-reset"),
    );

    // The confirmation dialog appears and no request has fired yet.
    await screen.findByTestId("dialog-confirm-force-password-reset");
    expect(forceMemberPasswordReset).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByTestId("button-confirm-force-password-reset"),
    );

    await waitFor(() => {
      expect(forceMemberPasswordReset).toHaveBeenCalledWith(42);
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Password reset forced" }),
      );
    });
  });

  it("cancelling the dialog never calls forceMemberPasswordReset", async () => {
    render(<MemberDetail />);

    await userEvent.click(
      await screen.findByTestId("button-force-password-reset"),
    );

    await screen.findByTestId("dialog-confirm-force-password-reset");
    await userEvent.click(
      screen.getByTestId("button-cancel-force-password-reset"),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("dialog-confirm-force-password-reset"),
      ).not.toBeInTheDocument();
    });

    expect(forceMemberPasswordReset).not.toHaveBeenCalled();
  });
});
