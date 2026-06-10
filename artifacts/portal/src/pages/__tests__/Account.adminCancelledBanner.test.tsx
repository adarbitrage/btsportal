import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

const useGetCurrentMember = vi.fn();
const dismissMutate = vi.fn(async () => ({ dismissed: true }));
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  usePatchMemberProfile: () => ({ mutateAsync: vi.fn() }),
  useChangeMemberPassword: () => ({ mutateAsync: vi.fn() }),
  useRequestMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useCancelMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useDismissAdminCancelledEmailChange: () => ({ mutateAsync: dismissMutate }),
  useGetMyActiveSessions: () => ({ data: { sessions: [] }, isLoading: false, refetch: vi.fn() }),
  useRevokeMyActiveSession: () => ({ mutateAsync: vi.fn() }),
  useRevokeMyOtherSessions: () => ({ mutateAsync: vi.fn() }),
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
  dismissMutate.mockReset();
  dismissMutate.mockResolvedValue({ dismissed: true });
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

  it("calls the dismiss endpoint and refetches when the member clicks the dismiss button", async () => {
    const refetch = vi.fn();
    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        lastAdminCancelledEmailChange: {
          newEmail: "swap-target@example.test",
          cancelledAt: new Date(2026, 3, 15, 14, 30, 0).toISOString(),
        },
      },
      isLoading: false,
      refetch,
    });

    render(<Account />);

    const dismissButton = await screen.findByTestId(
      "button-dismiss-admin-cancelled-banner",
    );
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(dismissMutate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("hides the banner once `lastAdminCancelledEmailChange` clears (post-refetch)", async () => {
    // After the dismiss POST + refetch, the API returns
    // `lastAdminCancelledEmailChange: null`. We simulate that second render
    // by mocking the hook to return a payload with the field cleared and
    // assert the banner is gone — proving the page fully relies on the
    // server-stored dismissal rather than ephemeral local state.
    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        lastAdminCancelledEmailChange: null,
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("email-admin-cancelled-banner"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a 'Contact support' link inside the banner pointing at the pre-filled support form", async () => {
    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        lastAdminCancelledEmailChange: {
          newEmail: "swap-target@example.test",
          cancelledAt: new Date(2026, 3, 15, 14, 30, 0).toISOString(),
        },
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const link = await screen.findByTestId(
      "link-admin-cancelled-contact-support",
    );
    expect(link).toBeInTheDocument();
    // The link must live inside the cancelled-email banner so members can act
    // on this security-sensitive notice without hunting for the support page.
    const banner = screen.getByTestId("email-admin-cancelled-banner");
    expect(banner).toContainElement(link);
    // Pre-filling the support form via a topic param keeps the click count to
    // one — without it, members would land on a blank form and have to retype
    // the context themselves.
    expect(link.getAttribute("href")).toMatch(
      /^\/support\/contact\?topic=email-admin-cancelled(?:&|$)/,
    );
    expect(link).toHaveTextContent(/contact support/i);
  });

  it("does not dismiss the banner when the support link is clicked", async () => {
    const refetch = vi.fn();
    useGetCurrentMember.mockReturnValue({
      data: {
        ...baseMember,
        lastAdminCancelledEmailChange: {
          newEmail: "swap-target@example.test",
          cancelledAt: new Date(2026, 3, 15, 14, 30, 0).toISOString(),
        },
      },
      isLoading: false,
      refetch,
    });

    render(<Account />);

    const link = await screen.findByTestId(
      "link-admin-cancelled-contact-support",
    );
    // Stop the anchor from doing a real navigation in jsdom — we only care
    // that activating the link does not also fire the dismiss endpoint.
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);

    // The dismiss endpoint must NOT have been hit. If we had wired the link
    // inside the dismiss button, or wrapped the banner in a single click
    // handler, this would call dismissMutate too.
    expect(dismissMutate).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
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
