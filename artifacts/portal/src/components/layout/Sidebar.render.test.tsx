import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks -----------------------------------------------------------------
// These are intentionally allow-list-friendly: each external module is mocked
// with only the members SidebarContent actually consumes. The
// `@workspace/api-client-react` mock spreads the real module so that any
// unrelated hook added to the sidebar later keeps working without forcing an
// update to this file.

const useGetCurrentMemberMock = vi.fn();
const useAuthMock = vi.fn();

// `hasPermission` is mocked so a single test can drive an admin-role user's
// permitted admin children down to zero (the empty-state branch). It is kept
// allow-list-friendly: the factory spreads the real `@workspace/auth` module
// and the mock defaults to the genuine implementation, so every other test
// (and the production permission matrix) behaves exactly as before unless a
// test explicitly overrides it.
const authMocks = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(),
  realHasPermission: undefined as
    | ((role: unknown, permission: unknown) => boolean)
    | undefined,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetCurrentMember: () => useGetCurrentMemberMock(),
  };
});

vi.mock("@workspace/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  authMocks.realHasPermission = actual.hasPermission as (
    role: unknown,
    permission: unknown,
  ) => boolean;
  return {
    ...actual,
    hasPermission: (role: unknown, permission: unknown) =>
      authMocks.hasPermissionMock(role, permission),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
  authFetch: vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) })),
}));

vi.mock("@/hooks/useAdminModeration", () => ({
  useAdminModerationPendingCount: () => ({ data: { count: 0, hasMore: false } }),
}));

vi.mock("@/components/community/NotificationBell", () => ({
  NotificationBell: () => <div data-testid="notification-bell-stub" />,
  NotificationBadgeCount: () => null,
}));

vi.mock("@/components/dm/unread-badge", () => ({
  UnreadBadge: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", () => {}],
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SidebarContent } from "./Sidebar";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const UPGRADE_CARD_TESTID = "upgrade-features-card-sidebar";

beforeEach(() => {
  useGetCurrentMemberMock.mockReset();
  useAuthMock.mockReset();
  // Default to the genuine permission matrix so the staff/coach tests keep
  // exercising real behavior; only the empty-state test overrides this.
  authMocks.hasPermissionMock.mockReset();
  authMocks.hasPermissionMock.mockImplementation((role, permission) =>
    authMocks.realHasPermission!(role, permission),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SidebarContent staff label + upgrade card (rendered)", () => {
  it("shows the Super Admin label and hides the upgrade card for a super_admin", () => {
    useAuthMock.mockReturnValue({ user: { role: "super_admin" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 1,
        name: "Staff Member",
        role: "super_admin",
        entitlements: [],
        // Staff usually have no purchased product, so the slug is "free".
        highestProductSlug: "free",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.queryByText("Free Member")).toBeNull();
    expect(screen.queryByTestId(UPGRADE_CARD_TESTID)).toBeNull();
  });

  it("shows the Admin label and hides the upgrade card for a non-super admin", () => {
    useAuthMock.mockReturnValue({ user: { role: "admin" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 2,
        name: "Admin User",
        role: "admin",
        entitlements: [],
        highestProductSlug: "free",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    expect(screen.getByText("Admin", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Free Member")).toBeNull();
    expect(screen.queryByTestId(UPGRADE_CARD_TESTID)).toBeNull();
  });

  it("shows the Free Member label and the upgrade card for a free member", () => {
    useAuthMock.mockReturnValue({ user: { role: "free_member" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 3,
        name: "Casey Member",
        role: "free_member",
        entitlements: [],
        highestProductSlug: "free",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // The tier label paragraph reads "Free Member".
    expect(screen.getByText("Free Member", { selector: "p" })).toBeInTheDocument();
    // A genuine free member with no entitlements has locked features, so the
    // sidebar upgrade card renders.
    expect(screen.getByTestId(UPGRADE_CARD_TESTID)).toBeInTheDocument();
  });

  it("shows the product-tier label and the upgrade card for a paying member", () => {
    useAuthMock.mockReturnValue({ user: { role: "member" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 4,
        name: "Pat Paying",
        role: "member",
        // A 6-Month member still has features locked behind higher tiers, so
        // the upgrade card must keep rendering for them.
        entitlements: [],
        highestProductSlug: "6month",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // The tier label paragraph reflects the purchased product, not "Free Member".
    expect(screen.getByText("6-Month Mentorship", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Free Member")).toBeNull();
    // Paying members below lifetime still see the sidebar upgrade card.
    expect(screen.getByTestId(UPGRADE_CARD_TESTID)).toBeInTheDocument();
  });

  it("shows the Lifetime Member label and hides the upgrade card for a lifetime member", () => {
    useAuthMock.mockReturnValue({ user: { role: "member" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 5,
        name: "Lee Lifetime",
        role: "member",
        entitlements: [],
        highestProductSlug: "lifetime",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // Lifetime members get the top-tier label and never see the upgrade card.
    expect(screen.getByText("Lifetime Member", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByTestId(UPGRADE_CARD_TESTID)).toBeNull();
  });
});

describe("SidebarContent coach section (rendered)", () => {
  it("shows the Coach section and Mentee Progress, and hides the Messages leaf", () => {
    useAuthMock.mockReturnValue({ user: { role: "coach" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 6,
        name: "Robin Coach",
        role: "coach",
        entitlements: [],
        highestProductSlug: "free",
      },
    });

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // The Coach section heading and its only leaf render for a coach.
    // Scope to the section-heading div: a coach also gets a "Coach" role badge
    // (<p> from getSidebarTierLabel), so an unscoped getByText("Coach") is ambiguous.
    expect(screen.getByText("Coach", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("Mentee Progress")).toBeInTheDocument();
    // The member Messages leaf is hidden for coaches.
    expect(screen.queryByText("Messages")).toBeNull();
  });
});

describe("SidebarContent admin empty state (rendered)", () => {
  it("renders the empty-state block when an admin's permissions filter out every admin child", () => {
    useAuthMock.mockReturnValue({ user: { role: "admin" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 7,
        name: "Avery Admin",
        role: "admin",
        entitlements: [],
        highestProductSlug: "free",
      },
    });
    // Force every admin child's permission check to fail. The user is still an
    // admin (isAdminRole stays real), so the sidebar must fall back to the
    // empty-state block rather than rendering the Admin folder.
    authMocks.hasPermissionMock.mockReturnValue(false);

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // The empty-state container and its "Contact a super admin" support link
    // both render, with the link pointing at /support.
    expect(screen.getByTestId("admin-empty-state")).toBeInTheDocument();
    const supportLink = screen.getByTestId("admin-empty-state-support-link");
    expect(supportLink).toHaveAttribute("href", "/support");
    expect(supportLink).toHaveTextContent("Contact a super admin");

    // The normal Admin folder is NOT shown: its collapsible toggle button
    // (accessible name "Admin") only exists when the folder renders.
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });
});
