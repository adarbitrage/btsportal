import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// --- Mocks -----------------------------------------------------------------
// These are intentionally allow-list-friendly: each external module is mocked
// with only the members SidebarContent actually consumes. The
// `@workspace/api-client-react` mock spreads the real module so that any
// unrelated hook added to the sidebar later keeps working without forcing an
// update to this file.

const useGetCurrentMemberMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetCurrentMember: () => useGetCurrentMemberMock(),
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

const UPGRADE_CARD_TESTID = "upgrade-features-card-sidebar";

beforeEach(() => {
  useGetCurrentMemberMock.mockReset();
  useAuthMock.mockReset();
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

    render(<SidebarContent />);

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

    render(<SidebarContent />);

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

    render(<SidebarContent />);

    // The tier label paragraph reads "Free Member".
    expect(screen.getByText("Free Member", { selector: "p" })).toBeInTheDocument();
    // A genuine free member with no entitlements has locked features, so the
    // sidebar upgrade card renders.
    expect(screen.getByTestId(UPGRADE_CARD_TESTID)).toBeInTheDocument();
  });
});
