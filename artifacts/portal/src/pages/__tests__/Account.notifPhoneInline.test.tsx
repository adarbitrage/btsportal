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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Account from "@/pages/Account";

function qcWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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

// The notification preferences live inside a collapsed card, so each test
// must expand it before its content is in the DOM.
async function renderAndExpandNotifications() {
  render(<Account />, { wrapper: qcWrapper });
  const toggle = await waitFor(() =>
    screen.getByTestId("button-toggle-notifications"),
  );
  fireEvent.click(toggle);
}

function getSaveButton() {
  return screen.getByRole("button", { name: /save preferences/i });
}

beforeEach(() => {
  useGetCurrentMember.mockReset();
  patchProfileMutate.mockReset();
  patchProfileMutate.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Account — inline phone capture in Notification Preferences", () => {
  it("shows the inline phone field with guidance and a blocked save for a phone-less member with SMS on", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, phone: null, smsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    await renderAndExpandNotifications();

    const phoneInput = await waitFor(() => screen.getByTestId("input-notif-phone"));
    expect(phoneInput).toBeInTheDocument();
    expect(
      screen.getByTestId("text-notif-sms-phone-blocked"),
    ).toHaveTextContent(
      "Add a phone number to receive text reminders — or uncheck SMS notifications",
    );

    // Nothing dirty and no phone entered: save must be disabled — the raw
    // 400 dead-end can never fire.
    expect(getSaveButton()).toBeDisabled();
    expect(patchProfileMutate).not.toHaveBeenCalled();
  });

  it("blocks the save client-side (no request) when SMS is toggled on with no phone entered", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, phone: null, smsOptIn: false },
      isLoading: false,
      refetch: vi.fn(),
    });

    await renderAndExpandNotifications();

    const smsSwitch = await waitFor(() =>
      screen.getByRole("switch", { name: /toggle sms notifications/i }),
    );
    fireEvent.click(smsSwitch);
    await waitFor(() =>
      expect(screen.getByTestId("input-notif-phone")).toBeInTheDocument(),
    );

    const saveButton = getSaveButton();
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    // Client-side guard: friendly message shown, no request fired.
    await waitFor(() =>
      expect(
        screen.getAllByText(
          /Add a phone number to receive text reminders — or uncheck SMS notifications/i,
        ).length,
      ).toBeGreaterThan(0),
    );
    expect(patchProfileMutate).not.toHaveBeenCalled();
  });

  it("entering a phone enables saving and sends it in the PATCH alongside the preferences", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, phone: null, smsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    await renderAndExpandNotifications();

    const phoneInput = await waitFor(() => screen.getByTestId("input-notif-phone"));
    fireEvent.change(phoneInput, { target: { value: "+1 555 000 1234" } });

    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(patchProfileMutate).toHaveBeenCalledTimes(1));
    expect(patchProfileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: "+1 555 000 1234",
          smsOptIn: true,
        }),
      }),
    );
  });

  it("shows the server body's error text (not a raw HTTP-prefixed message) when the save fails", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, phone: null, smsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });
    const err: any = new Error("HTTP 400 · something raw");
    err.data = { error: "A friendly server message" };
    patchProfileMutate.mockRejectedValueOnce(err);

    await renderAndExpandNotifications();

    const phoneInput = await waitFor(() => screen.getByTestId("input-notif-phone"));
    fireEvent.change(phoneInput, { target: { value: "+15550001234" } });
    fireEvent.click(getSaveButton());

    await waitFor(() =>
      expect(screen.getByText("A friendly server message")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/HTTP 400 ·/)).not.toBeInTheDocument();
  });

  it("shows no inline phone field for a member with a phone on file, and saves as before", async () => {
    useGetCurrentMember.mockReturnValue({
      data: { ...baseMember, smsOptIn: true },
      isLoading: false,
      refetch: vi.fn(),
    });

    await renderAndExpandNotifications();

    await waitFor(() =>
      screen.getByRole("switch", { name: /toggle sms notifications/i }),
    );
    expect(screen.queryByTestId("input-notif-phone")).not.toBeInTheDocument();

    // Flip a preference to make the form dirty and save as before — no phone
    // key in the payload.
    fireEvent.click(screen.getByRole("switch", { name: /toggle marketing emails/i }));
    const saveButton = getSaveButton();
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(patchProfileMutate).toHaveBeenCalledTimes(1));
    const payload = (patchProfileMutate.mock.calls[0] as any[])[0];
    expect(payload.data).not.toHaveProperty("phone");
    expect(payload.data).toEqual(expect.objectContaining({ marketingOptIn: false }));
  });
});
