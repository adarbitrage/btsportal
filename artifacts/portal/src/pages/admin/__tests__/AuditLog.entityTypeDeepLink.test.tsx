import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AuditLog from "@/pages/admin/AuditLog";

const originalLocation = window.location;

function setLocationSearch(search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, search },
  });
}

beforeEach(() => {
  getAuditLog.mockReset();
  getAuditLog.mockResolvedValue({
    logs: [],
    cursors: { next: null, prev: null },
    pagination: { total: 0 },
    exportCap: 10000,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

describe("AuditLog deep-link initialization", () => {
  it("applies entityType=oncall_destinations from the URL on the very first fetch", async () => {
    setLocationSearch("?entityType=oncall_destinations");

    render(<AuditLog />);

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    // Every call made during initial mount should already carry the
    // deep-linked filter — we don't want a flash of an unfiltered request
    // before useEffect re-applies it.
    for (const call of getAuditLog.mock.calls) {
      expect(call[0]).toMatchObject({ entityType: "oncall_destinations" });
    }
  });

  it("falls back to an empty entityType when no filter is in the URL", async () => {
    setLocationSearch("");

    render(<AuditLog />);

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    expect(getAuditLog.mock.calls[0][0]).toMatchObject({ entityType: "" });
  });
});
