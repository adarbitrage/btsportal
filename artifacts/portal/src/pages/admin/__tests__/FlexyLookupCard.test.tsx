import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const flexyPanelStub = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="stub-flexy-regenerate-panel"
    data-user-id={String(props.userId)}
    data-history-container-test-id={String(props.historyContainerTestId)}
    data-history-item-test-id-prefix={String(props.historyItemTestIdPrefix)}
  />
));
vi.mock("@/components/admin/FlexyRegeneratePanel", () => ({
  FlexyRegeneratePanel: (props: Record<string, unknown>) => flexyPanelStub(props),
}));

import { FlexyLookupCard } from "@/pages/admin/AppsManager";

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

const memberResult = {
  id: 42,
  name: "Test Member",
  email: "member@example.com",
  role: "member",
};

beforeEach(() => {
  flexyPanelStub.mockClear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FlexyLookupCard (Apps Manager)", () => {
  it("searches for members, mounts the regenerate panel for the selection, and uses the default Apps Manager history test ids", async () => {
    const user = userEvent.setup();

    const fetchSpy = installFetchMock(async (url) => {
      if (url.includes("/api/admin/search")) {
        return { ok: true, body: { members: [memberResult] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyLookupCard />);

    // The search input is rendered and the panel is not mounted yet.
    const searchInput = screen.getByTestId("input-flexy-member-search");
    expect(searchInput).toBeInTheDocument();
    expect(screen.queryByTestId("stub-flexy-regenerate-panel")).not.toBeInTheDocument();

    // Typing triggers the debounced search and the result list shows up.
    await user.type(searchInput, "test");

    const resultButton = await screen.findByTestId(`button-select-member-${memberResult.id}`);
    expect(resultButton).toBeInTheDocument();

    // Confirm the search endpoint was called and not any other endpoints.
    await waitFor(() => {
      const searchCalls = fetchSpy.mock.calls.filter(([url]) => {
        const u = typeof url === "string" ? url : (url as URL).toString();
        return u.includes("/api/admin/search");
      });
      expect(searchCalls.length).toBeGreaterThan(0);
    });

    // Selecting the member mounts the regenerate panel for that user id.
    await user.click(resultButton);

    const panel = await screen.findByTestId("stub-flexy-regenerate-panel");
    expect(panel.dataset.userId).toBe(String(memberResult.id));

    // The Apps Manager card intentionally relies on the default history
    // testid scheme (different from MemberDetail's "member-flexy-*" ids), so
    // the wrapper should not override the history props.
    expect(panel.dataset.historyContainerTestId).toBe("undefined");
    expect(panel.dataset.historyItemTestIdPrefix).toBe("undefined");

    const lastCall = flexyPanelStub.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const props = lastCall![0] as Record<string, unknown>;
    expect(props.userId).toBe(memberResult.id);
    expect(props.historyContainerTestId).toBeUndefined();
    expect(props.historyItemTestIdPrefix).toBeUndefined();
    // The wrapper should not flip the showHistory toggle off — the Apps
    // Manager card relies on the panel's default (history shown).
    expect(props.showHistory).toBeUndefined();

    // The Flexy lookup endpoint is the panel's responsibility — it must not
    // be called by the wrapper itself before the panel mounts.
    const lookupCalls = fetchSpy.mock.calls.filter(([url]) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      return u.includes("/api/admin/apps/flexy/lookup/");
    });
    expect(lookupCalls).toHaveLength(0);
  });

  it("clears the selection and unmounts the regenerate panel", async () => {
    const user = userEvent.setup();

    installFetchMock(async (url) => {
      if (url.includes("/api/admin/search")) {
        return { ok: true, body: { members: [memberResult] } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<FlexyLookupCard />);

    const searchInput = screen.getByTestId("input-flexy-member-search");
    await user.type(searchInput, "test");

    const resultButton = await screen.findByTestId(`button-select-member-${memberResult.id}`);
    await user.click(resultButton);

    expect(await screen.findByTestId("stub-flexy-regenerate-panel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("stub-flexy-regenerate-panel")).not.toBeInTheDocument();
    });
  });
});
