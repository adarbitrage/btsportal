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

const startLog = {
  id: 201,
  actionType: "impersonate_start",
  entityType: "user",
  entityId: "55",
  actorId: 7,
  actorEmail: "ops@example.com",
  description: "Admin started impersonating member Jane (jane@example.com)",
  ipAddress: null,
  userAgent: null,
  createdAt: "2026-01-01T10:00:00.000Z",
  metadata: { memberName: "Jane Member", memberEmail: "jane@example.com" },
  impersonationDurationMs: 5 * 60 * 1000,
  impersonationStoppedAt: "2026-01-01T10:05:00.000Z",
};

beforeEach(() => {
  getAuditLog.mockReset();
  getAuditLog.mockResolvedValue({
    logs: [startLog],
    cursors: { next: null, prev: null },
    pagination: { total: 1 },
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

describe("AuditLog — impersonation expanded row", () => {
  it("renders admin, member, and paired duration when an impersonate_start row is expanded", async () => {
    // expand=201 in the URL auto-expands the row on mount.
    setLocationSearch("?actionType=impersonation&expand=201");

    render(<AuditLog />);

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    // Admin (actor) and member (entity from metadata) surface in the
    // structured impersonation summary.
    expect(await screen.findByTestId("impersonation-admin-201")).toHaveTextContent(
      "ops@example.com",
    );
    expect(screen.getByTestId("impersonation-member-201")).toHaveTextContent(
      "jane@example.com",
    );

    // Server-paired duration is formatted and the stop time is shown.
    const duration = screen.getByTestId("impersonation-duration-201");
    expect(duration).toHaveTextContent("5m");
    expect(duration).toHaveTextContent(/stopped/i);
  });

  it("shows 'ongoing / unknown' for a start row with no paired stop", async () => {
    getAuditLog.mockResolvedValue({
      logs: [
        {
          ...startLog,
          impersonationDurationMs: null,
          impersonationStoppedAt: null,
        },
      ],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });
    setLocationSearch("?actionType=impersonation&expand=201");

    render(<AuditLog />);

    await waitFor(() => {
      expect(getAuditLog).toHaveBeenCalled();
    });

    const duration = await screen.findByTestId("impersonation-duration-201");
    expect(duration).toHaveTextContent("ongoing / unknown");
  });
});
