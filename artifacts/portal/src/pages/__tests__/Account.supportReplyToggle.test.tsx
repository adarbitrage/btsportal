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
const patchProfileMutate = vi.fn(async () => ({}));
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMember(),
  usePatchMemberProfile: () => ({ mutateAsync: patchProfileMutate }),
  useChangeMemberPassword: () => ({ mutateAsync: vi.fn() }),
  useRequestMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useCancelMemberEmailChange: () => ({ mutateAsync: vi.fn() }),
  useDismissAdminCancelledEmailChange: () => ({ mutateAsync: vi.fn() }),
  useGetMyActiveSessions: () => ({ data: { sessions: [] }, isLoading: false, refetch: vi.fn() }),
  useRevokeMyActiveSession: () => ({ mutateAsync: vi.fn() }),
  useRevokeMyOtherSessions: () => ({ mutateAsync: vi.fn() }),
}));

import Account from "@/pages/Account";

const baseMember = {
  id: 1,
  email: "member@example.com",
  name: "Test Member",
  phone: "+15555550123",
  timezone: "America/New_York",
  smsOptIn: true,
  ticketReplySmsOptIn: true,
  marketingOptIn: true,
  pendingEmail: null,
  lastAdminCancelledEmailChange: null,
};

function getSupportReplySwitch() {
  return screen.getByRole("switch", { name: /support reply texts/i });
}

beforeEach(() => {
  useGetCurrentMember.mockReset();
  patchProfileMutate.mockReset();
  patchProfileMutate.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Account — support-reply SMS toggle", () => {
  it("reflects the member's current ticketReplySmsOptIn value (on)", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, smsOptIn: true, ticketReplySmsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const toggle = await waitFor(() => getSupportReplySwitch());
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).not.toBeDisabled();
  });

  it("reflects the member's current ticketReplySmsOptIn value (off)", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, smsOptIn: true, ticketReplySmsOptIn: false },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const toggle = await waitFor(() => getSupportReplySwitch());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).not.toBeDisabled();
  });

  it("is disabled (and reads off) when master SMS opt-in is off", async () => {
    useGetCurrentMember.mockReturnValue({
      // Even though ticketReplySmsOptIn is true, the master SMS switch being
      // off must force the dependent toggle off and non-interactive.
      data: { ...baseMember, smsOptIn: false, ticketReplySmsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const toggle = await waitFor(() => getSupportReplySwitch());
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("includes ticketReplySmsOptIn in the save payload when preferences are saved", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, smsOptIn: true, ticketReplySmsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<Account />);

    const toggle = await waitFor(() => getSupportReplySwitch());
    // Flip the support-reply preference off so the form becomes dirty and the
    // Save button enables.
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-checked", "false"),
    );

    const saveButton = screen.getByRole("button", { name: /save preferences/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(patchProfileMutate).toHaveBeenCalledTimes(1));
    expect(patchProfileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketReplySmsOptIn: false,
        }),
      }),
    );
  });
});
