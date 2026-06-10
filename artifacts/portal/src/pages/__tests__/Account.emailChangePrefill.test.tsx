import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
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
const getMemberEmailChangePrefillMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  usePatchMemberProfile: () => ({ mutateAsync: vi.fn() }),
  useChangeMemberPassword: () => ({ mutateAsync: vi.fn() }),
  useRequestMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useCancelMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useDismissAdminCancelledEmailChange: () => ({ mutateAsync: vi.fn() }),
  getMemberEmailChangePrefill: (...args: unknown[]) =>
    getMemberEmailChangePrefillMock(...args),
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

function setLocationSearch(search: string) {
  // jsdom doesn't allow assigning window.location directly, but
  // history.replaceState updates window.location.search in-place, which is
  // what the page reads via URLSearchParams(window.location.search).
  window.history.replaceState({}, "", `/account${search}`);
}

beforeEach(() => {
  useGetCurrentMember.mockReset();
  getMemberEmailChangePrefillMock.mockReset();
  toastMock.mockReset();
  setLocationSearch("");
});

afterEach(() => {
  vi.restoreAllMocks();
  setLocationSearch("");
});

describe("Account — email-change pre-fill from cancellation deep link", () => {
  it("opens the email-change dialog with the prefilled address when the token resolves", async () => {
    useGetCurrentMember.mockReturnValue({
      data: baseMember,
      isLoading: false,
      refetch: vi.fn(),
    });
    getMemberEmailChangePrefillMock.mockResolvedValue({
      prefillEmail: "wanted-address@example.test",
    });

    setLocationSearch("?email_change_prefill=signed-token-abc");

    render(<Account />);

    // The dialog should pop open and pre-fill the new-email input.
    await waitFor(() =>
      expect(screen.getByTestId("dialog-update-email")).toBeInTheDocument(),
    );
    const newEmailInput = screen.getByTestId("input-new-email") as HTMLInputElement;
    expect(newEmailInput.value).toBe("wanted-address@example.test");

    // The endpoint must be called with the token from the query string.
    expect(getMemberEmailChangePrefillMock).toHaveBeenCalledWith({
      token: "signed-token-abc",
    });

    // After the prefill resolves, the URL should be cleaned up so a refresh
    // doesn't repeat the flow / leak the token in the address bar.
    await waitFor(() =>
      expect(window.location.search).toBe(""),
    );

    // The user is informed via a toast that the form was pre-filled.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/pre-filled/i),
      }),
    );
  });

  it("shows a destructive toast and does not open the dialog when the token is invalid", async () => {
    useGetCurrentMember.mockReturnValue({
      data: baseMember,
      isLoading: false,
      refetch: vi.fn(),
    });
    // 410 Gone from the API — the customFetch helper rejects with a thrown
    // object whose `data` field carries the server's error body.
    getMemberEmailChangePrefillMock.mockRejectedValue({
      data: { error: "This pre-fill link is no longer valid." },
    });

    setLocationSearch("?email_change_prefill=expired-token");

    render(<Account />);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());

    // Dialog must NOT be auto-opened on failure — we don't want to show an
    // empty "update email" dialog out of nowhere.
    expect(screen.queryByTestId("dialog-update-email")).not.toBeInTheDocument();

    // Toast surfaces the server's error message.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/couldn't pre-fill/i),
        variant: "destructive",
      }),
    );

    // URL still gets stripped even on failure so a hard refresh doesn't
    // spam the user with the same toast.
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("does nothing when there is no email_change_prefill query param", async () => {
    useGetCurrentMember.mockReturnValue({
      data: baseMember,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    // Give any (non-existent) effect a chance to run.
    await act(async () => {
      await Promise.resolve();
    });

    expect(getMemberEmailChangePrefillMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-update-email")).not.toBeInTheDocument();
  });

  it("silently no-ops when the prefill address already matches the current email", async () => {
    // Edge case: the pending change happened to be to an address that the
    // member has since switched to. Nothing to retry — don't pop a dialog
    // suggesting they "update" to their own current email.
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, email: "now-current@example.test" },
      isLoading: false,
      refetch: vi.fn(),
    });
    getMemberEmailChangePrefillMock.mockResolvedValue({
      prefillEmail: "now-current@example.test",
    });

    setLocationSearch("?email_change_prefill=stale-but-valid");

    render(<Account />);

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.queryByTestId("dialog-update-email")).not.toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
