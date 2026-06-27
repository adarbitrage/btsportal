import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Module mocks (same allow-list pattern as Sidebar.render.test.tsx)
// ---------------------------------------------------------------------------

const useGetCurrentMemberMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetCurrentMember: () => useGetCurrentMemberMock(),
  };
});

vi.mock("@workspace/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual };
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
  useLocation: () => ["/earn/become-a-coach", () => {}],
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

const SCROLL_KEY = "sidebar-scroll-top";

function stubMember(overrides: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({ user: { role: "member" }, logout: vi.fn() });
  useGetCurrentMemberMock.mockReturnValue({
    data: {
      id: 1,
      name: "Test Member",
      role: "member",
      entitlements: ["commissions:lifetime"],
      highestProductSlug: "lifetime",
      ...overrides,
    },
  });
}

beforeEach(() => {
  useGetCurrentMemberMock.mockReset();
  useAuthMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Directly sets scrollTop on the element (jsdom allows this) and fires a
 * scroll event so the save listener captures the new value.
 */
function simulateScroll(el: HTMLElement, offset: number) {
  Object.defineProperty(el, "scrollTop", {
    value: offset,
    writable: true,
    configurable: true,
  });
  el.dispatchEvent(new Event("scroll"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SidebarContent scroll persistence", () => {
  it("saves scrollTop to sessionStorage when the user scrolls the nav container", () => {
    stubMember();
    render(<SidebarContent />, { wrapper: makeWrapper() });

    const container = screen.getByTestId("member-sidebar-scroll");
    simulateScroll(container, 150);

    expect(sessionStorage.getItem(SCROLL_KEY)).toBe("150");
  });

  it("restores saved scroll position on remount (simulates Earn → Become a Coach navigation)", () => {
    // Pre-seed the saved offset as if the member had scrolled before navigating.
    sessionStorage.setItem(SCROLL_KEY, "220");
    stubMember();

    render(<SidebarContent />, { wrapper: makeWrapper() });

    // useLayoutEffect runs synchronously before paint in jsdom; scrollTop
    // must be set to the saved value by the time the assertion runs.
    const container = screen.getByTestId("member-sidebar-scroll");
    expect(container.scrollTop).toBe(220);
  });

  it("leaves scrollTop at 0 when there is no saved value", () => {
    stubMember();

    render(<SidebarContent />, { wrapper: makeWrapper() });

    const container = screen.getByTestId("member-sidebar-scroll");
    expect(container.scrollTop).toBe(0);
  });

  it("re-applies the saved offset after member data resolves when content grew", () => {
    // Start with no member data (loading state), then resolve it.
    useAuthMock.mockReturnValue({ user: { role: "member" }, logout: vi.fn() });
    useGetCurrentMemberMock.mockReturnValue({ data: undefined });
    sessionStorage.setItem(SCROLL_KEY, "180");

    const { rerender } = render(<SidebarContent />, { wrapper: makeWrapper() });

    // Member data arrives — more nav rows render, content grows taller.
    useGetCurrentMemberMock.mockReturnValue({
      data: {
        id: 1,
        name: "Test Member",
        role: "member",
        entitlements: ["commissions:lifetime"],
        highestProductSlug: "lifetime",
      },
    });
    rerender(<SidebarContent />);

    const container = screen.getByTestId("member-sidebar-scroll");
    // The re-apply useLayoutEffect must have set scrollTop to 180.
    expect(container.scrollTop).toBe(180);
  });

  it("scroll/restore round-trip: scroll, remount, offset is preserved", () => {
    stubMember();
    const { unmount } = render(<SidebarContent />, { wrapper: makeWrapper() });

    const container = screen.getByTestId("member-sidebar-scroll");
    simulateScroll(container, 300);
    expect(sessionStorage.getItem(SCROLL_KEY)).toBe("300");

    unmount();

    // Second mount simulates navigating to a new page (full remount).
    stubMember();
    render(<SidebarContent />, { wrapper: makeWrapper() });

    const restored = screen.getByTestId("member-sidebar-scroll");
    expect(restored.scrollTop).toBe(300);
  });
});
