import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FlexyRegeneratePanel,
  type FlexyLookup,
  type RegenerateResponse,
} from "@/components/admin/FlexyRegeneratePanel";
import type { FlexyResetEvent } from "@/components/admin/FlexyResetHistory";

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status?: number; body: unknown }>;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetchMock(handler: FetchHandler) {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const result = await handler(url, init);
    return jsonResponse(result.body, { ok: result.ok, status: result.status });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const installedLookup: FlexyLookup = {
  member: {
    id: 42,
    name: "Test Member",
    email: "member@example.com",
    hasPhone: true,
    smsOptIn: true,
  },
  flexy: {
    status: "installed",
    email: "member+flexy@example.com",
    locationId: "loc_123",
    hasStaffUser: true,
    updatedAt: "2026-04-20T00:00:00.000Z",
  },
};

function makeHistoryEvent(id: number, description: string): FlexyResetEvent {
  return {
    id,
    createdAt: new Date(2026, 3, id).toISOString(),
    actionType: "regenerate_password",
    actorId: 1,
    actorEmail: "admin@example.com",
    memberId: 42,
    memberEmail: "member@example.com",
    description,
    channels: null,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FlexyRegeneratePanel", () => {
  it("renders the panel with status badges, login email, and enabled regenerate button when Flexy is installed with phone + SMS opt-in", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/api/admin/apps/flexy/lookup/")) {
        return { ok: true, body: installedLookup };
      }
      if (url.includes("/api/admin/apps/flexy/password-reset-history")) {
        return { ok: true, body: { events: [] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyRegeneratePanel userId={42} />);

    const panel = await screen.findByTestId("flexy-regenerate-panel");
    expect(panel).toBeInTheDocument();

    expect(within(panel).getByText("Installed")).toBeInTheDocument();
    expect(within(panel).getByTestId("badge-flexy-staff-user")).toHaveTextContent(
      /Staff user linked/i,
    );
    expect(within(panel).getByTestId("badge-flexy-sms")).toHaveTextContent(/SMS opt-in/i);

    expect(screen.getByTestId("text-flexy-email")).toHaveTextContent(
      "member+flexy@example.com",
    );

    const regenerateButton = screen.getByTestId("button-regenerate-flexy-password");
    expect(regenerateButton).toBeEnabled();

    const smsCheckbox = screen.getByTestId("checkbox-notify-flexy-sms");
    expect(smsCheckbox).toBeEnabled();

    const emailCheckbox = screen.getByTestId("checkbox-notify-flexy-email");
    expect(emailCheckbox).toBeEnabled();
    expect(emailCheckbox).toHaveAttribute("data-state", "checked");
    expect(smsCheckbox).toHaveAttribute("data-state", "unchecked");
  });

  it("disables the regenerate button and shows the install hint when Flexy is not installed", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/api/admin/apps/flexy/lookup/")) {
        return {
          ok: true,
          body: {
            member: {
              id: 99,
              name: "Uninstalled Member",
              email: "noflexy@example.com",
              hasPhone: false,
              smsOptIn: false,
            },
            flexy: {
              status: "not_installed",
              email: null,
              locationId: null,
              hasStaffUser: false,
              updatedAt: null,
            },
          } satisfies FlexyLookup,
        };
      }
      if (url.includes("/api/admin/apps/flexy/password-reset-history")) {
        return { ok: true, body: { events: [] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyRegeneratePanel userId={99} />);

    await screen.findByTestId("flexy-regenerate-panel");

    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByTestId("badge-flexy-staff-user")).toHaveTextContent(/No staff user/i);

    const regenerateButton = screen.getByTestId("button-regenerate-flexy-password");
    expect(regenerateButton).toBeDisabled();

    expect(
      screen.getByText(/Regenerate is available once Flexy is installed/i),
    ).toBeInTheDocument();

    expect(screen.queryByTestId("text-flexy-email")).not.toBeInTheDocument();
    expect(
      screen.getByText(/does not have a Flexy login on record/i),
    ).toBeInTheDocument();
  });

  it("disables the SMS checkbox when the member has no phone on file", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/api/admin/apps/flexy/lookup/")) {
        return {
          ok: true,
          body: {
            ...installedLookup,
            member: { ...installedLookup.member, hasPhone: false, smsOptIn: false },
          } satisfies FlexyLookup,
        };
      }
      if (url.includes("/api/admin/apps/flexy/password-reset-history")) {
        return { ok: true, body: { events: [] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyRegeneratePanel userId={42} />);

    await screen.findByTestId("flexy-regenerate-panel");

    expect(screen.getByTestId("badge-flexy-sms")).toHaveTextContent(/No phone on file/i);

    const smsCheckbox = screen.getByTestId("checkbox-notify-flexy-sms");
    expect(smsCheckbox).toBeDisabled();
    expect(screen.getByText("(no phone on file)")).toBeInTheDocument();

    expect(screen.getByTestId("checkbox-notify-flexy-email")).toBeEnabled();
    expect(screen.getByTestId("button-regenerate-flexy-password")).toBeEnabled();
  });

  it("disables the SMS checkbox when the member has a phone on file but has not opted in to SMS", async () => {
    installFetchMock(async (url) => {
      if (url.includes("/api/admin/apps/flexy/lookup/")) {
        return {
          ok: true,
          body: {
            ...installedLookup,
            member: { ...installedLookup.member, hasPhone: true, smsOptIn: false },
          } satisfies FlexyLookup,
        };
      }
      if (url.includes("/api/admin/apps/flexy/password-reset-history")) {
        return { ok: true, body: { events: [] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyRegeneratePanel userId={42} />);

    await screen.findByTestId("flexy-regenerate-panel");

    expect(screen.getByTestId("badge-flexy-sms")).toHaveTextContent(
      /Phone on file, no SMS opt-in/i,
    );

    const smsCheckbox = screen.getByTestId("checkbox-notify-flexy-sms");
    expect(smsCheckbox).toBeDisabled();
    expect(screen.getByText(/member not opted in to SMS/i)).toBeInTheDocument();
  });

  it("reveals the new password and refreshes the history list after a successful regenerate", async () => {
    const user = userEvent.setup();

    let historyCallCount = 0;
    const initialHistory = [makeHistoryEvent(1, "Initial reset")];
    const refreshedHistory = [
      makeHistoryEvent(2, "New reset just now"),
      makeHistoryEvent(1, "Initial reset"),
    ];

    const regenerateResponse: RegenerateResponse = {
      email: "member+flexy@example.com",
      newPassword: "Brand-New-Pass!42",
      notifications: {
        email: { requested: true, status: "sent" },
        sms: { requested: false, status: "skipped" },
      },
    };

    const fetchSpy = installFetchMock(async (url, init) => {
      if (url.includes("/api/admin/apps/flexy/lookup/")) {
        return { ok: true, body: installedLookup };
      }
      if (url.includes("/api/admin/apps/flexy/password-reset-history")) {
        historyCallCount += 1;
        const events = historyCallCount === 1 ? initialHistory : refreshedHistory;
        return { ok: true, body: { events } };
      }
      if (url.includes("/api/admin/apps/flexy/regenerate-password/")) {
        expect(init?.method).toBe("POST");
        const body = init?.body ? JSON.parse(init.body as string) : {};
        expect(body).toEqual({ notifyEmail: true, notifySms: false });
        return { ok: true, body: regenerateResponse };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyRegeneratePanel userId={42} />);

    await screen.findByTestId("flexy-regenerate-panel");

    // Initial history loads with one event.
    await screen.findByTestId("flexy-history-event-1");
    expect(screen.queryByTestId("flexy-history-event-2")).not.toBeInTheDocument();
    expect(historyCallCount).toBe(1);

    // Open the confirmation dialog and confirm the regenerate.
    await user.click(screen.getByTestId("button-regenerate-flexy-password"));
    const confirmButton = await screen.findByTestId("button-confirm-regenerate-flexy");
    await user.click(confirmButton);

    // New password is revealed (shown once).
    const passwordCode = await screen.findByTestId("text-flexy-new-password");
    expect(passwordCode).toHaveTextContent("Brand-New-Pass!42");

    // Notification summary mentions the email was sent.
    const summary = screen.getByTestId("flexy-notification-summary");
    expect(within(summary).getByText(/Email to member/i)).toBeInTheDocument();
    expect(within(summary).getByText(/sent/i)).toBeInTheDocument();

    // History list refreshes and now shows the new event at the top.
    await waitFor(() => {
      expect(screen.getByTestId("flexy-history-event-2")).toBeInTheDocument();
    });
    expect(screen.getByTestId("flexy-history-event-1")).toBeInTheDocument();
    expect(historyCallCount).toBeGreaterThanOrEqual(2);

    const regenerateCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.includes("/regenerate-password/");
    });
    expect(regenerateCalls).toHaveLength(1);
  });
});

afterEach(() => {
  // Ensure stale timers from radix overlays don't leak between cases.
  act(() => {});
});
