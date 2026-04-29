import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getAuditLog = vi.fn();
const exportAuditLog = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAuditLog: (...args: unknown[]) => getAuditLog(...args),
    exportAuditLog: (...args: unknown[]) => exportAuditLog(...args),
  },
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import AuditLog from "@/pages/admin/AuditLog";

const baseResponse = {
  logs: [
    {
      id: 1,
      actionType: "update",
      entityType: "ticket",
      entityId: "42",
      actorId: 5,
      actorEmail: "agent@example.test",
      description: "ticket updated",
      createdAt: "2026-04-22T11:55:00Z",
      details: null,
    },
  ],
  cursors: { next: "next-cursor", prev: "prev-cursor" },
  pagination: { total: 1 },
  exportCap: 10000,
  jumpTo: { found: true },
};

const setUrl = (search: string) => {
  window.history.replaceState({}, "", `/admin/audit-log${search}`);
};

beforeEach(() => {
  getAuditLog.mockReset();
  exportAuditLog.mockReset();
  toastMock.mockReset();
  setUrl("");
  // jsdom doesn't implement scrollIntoView; the deep-link `?expand=` path
  // calls it after the row mounts, which would otherwise throw and surface
  // as an unhandled error in the test runner.
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
  setUrl("");
});

describe("AuditLog ?jumpTo= deep-link", () => {
  it("primes the first fetch with jumpTo and pre-fills the picker when the URL has ?jumpTo=", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?jumpTo=2026-04-22T12:00:00Z");

    render(<AuditLog />);

    await waitFor(() => expect(getAuditLog).toHaveBeenCalled());

    // First call should pass the normalized ISO jumpTo through to the API.
    expect(getAuditLog.mock.calls[0][0]).toMatchObject({
      jumpTo: "2026-04-22T12:00:00.000Z",
      limit: 50,
    });
    // It must NOT also pass cursor (the priority is jumpTo > cursor).
    expect(getAuditLog.mock.calls[0][0].cursor).toBeUndefined();

    // Picker pre-filled with the local-rendered version of the ISO instant.
    const input = await screen.findByTestId(
      "audit-jump-to-input",
    ) as HTMLInputElement;
    const expected = (() => {
      const d = new Date("2026-04-22T12:00:00Z");
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })();
    expect(input.value).toBe(expected);
  });

  it("does not re-jump on subsequent loads (cursor pagination still works)", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?jumpTo=2026-04-22T12:00:00Z");

    render(<AuditLog />);
    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(1));

    // Click "Older" — should paginate by cursor, not re-jump.
    const olderBtn = await screen.findByRole("button", { name: /older/i });
    fireEvent.click(olderBtn);

    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(2));
    expect(getAuditLog.mock.calls[1][0].jumpTo).toBeUndefined();
    expect(getAuditLog.mock.calls[1][0].cursor).toBe("next-cursor");
  });

  it("ignores ?jumpTo= when ?expand= is also present (expand wins)", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?jumpTo=2026-04-22T12:00:00Z&expand=1");

    render(<AuditLog />);
    await waitFor(() => expect(getAuditLog).toHaveBeenCalled());

    expect(getAuditLog.mock.calls[0][0]).toMatchObject({ expand: 1 });
    expect(getAuditLog.mock.calls[0][0].jumpTo).toBeUndefined();
  });

  it("writes ?jumpTo= into the URL when the admin clicks Jump", async () => {
    getAuditLog.mockResolvedValue(baseResponse);

    render(<AuditLog />);
    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(1));

    const input = (await screen.findByTestId(
      "audit-jump-to-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-04-22T05:00" } });

    const jumpBtn = await screen.findByTestId("audit-jump-to-button");
    fireEvent.click(jumpBtn);

    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(2));

    // The URL should now carry jumpTo as the ISO form of the chosen instant.
    const params = new URLSearchParams(window.location.search);
    const urlJumpTo = params.get("jumpTo");
    expect(urlJumpTo).not.toBeNull();
    expect(new Date(urlJumpTo!).toISOString()).toBe(
      new Date("2026-04-22T05:00").toISOString(),
    );

    // And the request reused the same ISO.
    expect(getAuditLog.mock.calls[1][0].jumpTo).toBe(
      new Date("2026-04-22T05:00").toISOString(),
    );
  });

  it("preserves existing query params (actionType, expand) when writing jumpTo to the URL", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?actionType=update&entityType=ticket");

    render(<AuditLog />);
    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(1));

    const input = (await screen.findByTestId(
      "audit-jump-to-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-04-22T05:00" } });

    fireEvent.click(await screen.findByTestId("audit-jump-to-button"));

    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(2));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("actionType")).toBe("update");
    expect(params.get("entityType")).toBe("ticket");
    expect(params.get("jumpTo")).not.toBeNull();
  });

  it("clears ?expand= when the admin clicks Jump so a freshly shared link lands on the jump instant, not the pinned row", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?expand=1");

    render(<AuditLog />);
    // First fetch is the expand deep-link.
    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(1));
    expect(getAuditLog.mock.calls[0][0]).toMatchObject({ expand: 1 });

    const input = (await screen.findByTestId(
      "audit-jump-to-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-04-22T05:00" } });
    fireEvent.click(await screen.findByTestId("audit-jump-to-button"));

    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(2));

    // Second fetch is the jump (initialExpandRef is consumed after the
    // first fetch, so jumpTo wins on the next call).
    expect(getAuditLog.mock.calls[1][0].jumpTo).toBe(
      new Date("2026-04-22T05:00").toISOString(),
    );

    const params = new URLSearchParams(window.location.search);
    expect(params.get("jumpTo")).not.toBeNull();
    // expand is gone — the shared URL now consistently means "jump here",
    // not "open this row centered" (those two intents would conflict).
    expect(params.has("expand")).toBe(false);
  });

  it("ignores an unparseable ?jumpTo= URL value rather than calling the API with junk", async () => {
    getAuditLog.mockResolvedValue(baseResponse);
    setUrl("?jumpTo=not-a-real-date");

    render(<AuditLog />);
    await waitFor(() => expect(getAuditLog).toHaveBeenCalled());

    expect(getAuditLog.mock.calls[0][0].jumpTo).toBeUndefined();

    const input = (await screen.findByTestId(
      "audit-jump-to-input",
    )) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
