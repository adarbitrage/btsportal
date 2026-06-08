import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  saveBlobAsFile: vi.fn(),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastSpy(...args) }),
}));

// jsdom does not implement URL.createObjectURL or HTMLAnchorElement.click()
// triggering a download, so stub both: we only care that handleExport
// reaches the post-download toast logic.
beforeEach(() => {
  getAuditLog.mockReset();
  exportAuditLog.mockReset();
  toastSpy.mockReset();
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: vi.fn(() => "blob:stub"),
    });
  } else {
    (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      () => "blob:stub",
    );
  }
  if (!("revokeObjectURL" in URL)) {
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: vi.fn(),
    });
  } else {
    (URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>) = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

import AuditLog from "@/pages/admin/AuditLog";

function seedAuditLogResponse(opts: {
  total: number | null;
  exportCap: number;
}) {
  getAuditLog.mockResolvedValue({
    logs: [],
    pagination: { page: null, limit: 50, total: opts.total, totalPages: null },
    cursors: { next: null, prev: null },
    exportCap: opts.exportCap,
  });
}

describe("AuditLog — post-export truncation toast", () => {
  it("warns the admin when the streamed row count hits the cap and matching rows exceed it", async () => {
    // 100,000 matching rows, but the export hard cap is 5 → server
    // streams the newest 5 and the trailers report truncation. The
    // browser path can't read trailers, so the page must derive
    // truncation from rowsReceived === hardCap and totalMatching > cap.
    seedAuditLogResponse({ total: 100_000, exportCap: 5 });
    exportAuditLog.mockImplementation(async (_fmt, _filters, onProgress) => {
      onProgress?.({ bytesReceived: 1234, rowsReceived: 5 });
      return {
        blob: new Blob(["[]"], { type: "application/json" }),
        bytesReceived: 1234,
        rowsReceived: 5,
        hardCap: 5,
        // Browsers don't expose trailers — null mirrors what the helper
        // would actually return for a real fetch() call.
        truncated: null,
      };
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    const csvButton = await screen.findByRole("button", { name: /CSV/i });
    await userEvent.click(csvButton);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });

    // The toast must be the destructive "capped" variant, mention the
    // exact rows written, and surface the matching-row total so admins
    // know how much they're missing.
    const call = toastSpy.mock.calls[0][0];
    expect(call.variant).toBe("destructive");
    expect(call.title).toMatch(/capped/i);
    expect(call.description).toMatch(/cut short/i);
    expect(call.description).toContain("5 rows");
    expect(call.description).toContain("100,000");
  });

  it("trusts the server's truncation trailer when present even if the row count is below the cap", async () => {
    // Some non-browser SDKs do surface trailers — when the server says
    // the export was truncated we honour that even if our local count
    // somehow drifted (defensive belt-and-braces).
    seedAuditLogResponse({ total: 50, exportCap: 1_000_000 });
    exportAuditLog.mockResolvedValue({
      blob: new Blob(["[]"], { type: "application/json" }),
      bytesReceived: 999,
      rowsReceived: 42,
      hardCap: 1_000_000,
      truncated: true,
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    const jsonButton = await screen.findByRole("button", { name: /JSON/i });
    await userEvent.click(jsonButton);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });

    const call = toastSpy.mock.calls[0][0];
    expect(call.variant).toBe("destructive");
    expect(call.description).toContain("42 rows");
  });

  it("does not warn about truncation when the matching count exactly equals the cap", async () => {
    // Edge case: matching set is exactly `cap` rows, so we hit the cap
    // but there is nothing past it. The toast must be the normal
    // "Export complete" success, not a destructive warning.
    seedAuditLogResponse({ total: 7, exportCap: 7 });
    exportAuditLog.mockResolvedValue({
      blob: new Blob(["id\n"], { type: "text/csv" }),
      bytesReceived: 100,
      rowsReceived: 7,
      hardCap: 7,
      truncated: null,
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    await userEvent.click(await screen.findByRole("button", { name: /CSV/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });

    const call = toastSpy.mock.calls[0][0];
    expect(call.variant).toBeUndefined();
    expect(call.title).toMatch(/Export complete/i);
    expect(call.description).toContain("7 rows");
  });

  it("uses the streamed row count as the authoritative number on a normal export", async () => {
    // Read endpoint says 100 matching rows, but the streamed count is
    // 99 (e.g. one row was deleted between the count fetch and the
    // export). The toast must report what was actually downloaded — not
    // the stale count from the read endpoint.
    seedAuditLogResponse({ total: 100, exportCap: 1_000_000 });
    exportAuditLog.mockResolvedValue({
      blob: new Blob(["x"], { type: "text/csv" }),
      bytesReceived: 1,
      rowsReceived: 99,
      hardCap: 1_000_000,
      truncated: null,
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    await userEvent.click(await screen.findByRole("button", { name: /CSV/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });

    const call = toastSpy.mock.calls[0][0];
    expect(call.variant).toBeUndefined();
    expect(call.description).toContain("99 rows");
  });

  it("falls back to a soft 'may have been capped' warning when hitting the cap with unknown matching count", async () => {
    // totalMatching is null (e.g. the user cursor-paginated and the
    // count was never re-fetched). We can't be sure rows were dropped,
    // but we hit the cap exactly — show a softer warning so admins
    // double-check before treating the file as authoritative.
    seedAuditLogResponse({ total: null, exportCap: 5 });
    exportAuditLog.mockResolvedValue({
      blob: new Blob(["x"], { type: "text/csv" }),
      bytesReceived: 1,
      rowsReceived: 5,
      hardCap: 5,
      truncated: null,
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    await userEvent.click(await screen.findByRole("button", { name: /CSV/i }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });

    const call = toastSpy.mock.calls[0][0];
    expect(call.variant).toBe("destructive");
    expect(call.title).toMatch(/may have been capped/i);
    expect(call.description).toContain("5 rows");
  });
});
