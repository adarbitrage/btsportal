import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/account", () => {}],
}));

const useGetCurrentMember = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  usePatchMemberProfile: () => ({ mutateAsync: vi.fn() }),
  useChangeMemberPassword: () => ({ mutateAsync: vi.fn() }),
  useRequestMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useCancelMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
}));

import Account from "@/pages/Account";

const baseMember = {
  id: 1,
  email: "member@example.com",
  name: "Test Member",
  phone: null,
  timezone: "America/New_York",
  smsOptIn: false,
  marketingOptIn: true,
  pendingEmail: null,
  lastAdminCancelledEmailChange: null,
};

beforeEach(() => {
  useGetCurrentMember.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Account — admin-cancelled email-change banner timestamp", () => {
  it("renders the cancellation timestamp in a member-friendly format", async () => {
    const cancelledAt = new Date(2026, 3, 15, 14, 30, 0).toISOString();

    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        pendingEmail: null,
        lastAdminCancelledEmailChange: {
          newEmail: "swap-target@example.test",
          cancelledAt,
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const banner = await screen.findByTestId("email-admin-cancelled-banner");
    expect(banner).toBeInTheDocument();

    expect(screen.getByTestId("text-admin-cancelled-email")).toHaveTextContent(
      "swap-target@example.test",
    );

    // The page formats with Date#toLocaleString — to stay locale/TZ agnostic,
    // we recompute the expected text using the same options the component uses.
    const expectedTimestamp = new Date(cancelledAt).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const cancelledAtNode = screen.getByTestId("text-admin-cancelled-at");
    expect(cancelledAtNode).toHaveTextContent(expectedTimestamp);

    // Sanity-check the formatted text isn't empty (would mean the cancelledAt
    // wasn't surfaced at all) and contains a 4-digit year so it's clearly
    // a member-friendly absolute date and not a bare ISO string or "0".
    expect(cancelledAtNode.textContent?.trim()).not.toBe("");
    expect(cancelledAtNode).toHaveTextContent(/2026/);
  });

  it("does not render the admin-cancelled banner when there's a pending email change", async () => {
    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        pendingEmail: "new-email@example.test",
        lastAdminCancelledEmailChange: {
          newEmail: "swap-target@example.test",
          cancelledAt: new Date(2026, 3, 15, 14, 30, 0).toISOString(),
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    await waitFor(() => {
      expect(screen.getByTestId("email-pending-banner")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("email-admin-cancelled-banner"),
    ).not.toBeInTheDocument();
  });
});
