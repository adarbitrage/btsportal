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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AuditLog from "@/pages/admin/AuditLog";

function makeLog(overrides: Record<string, unknown>) {
  return {
    id: 1,
    actionType: "update",
    entityType: "ticket",
    entityId: "42",
    actorId: 5,
    actorEmail: "agent@example.test",
    description: "ticket updated",
    createdAt: "2026-04-22T11:55:00Z",
    metadata: null,
    changeDiff: null,
    ...overrides,
  };
}

beforeEach(() => {
  getAuditLog.mockReset();
  exportAuditLog.mockReset();
  window.history.replaceState({}, "", "/admin/audit-log");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditLog expanded-row entity jump link", () => {
  it("renders a 'View ticket' link for ticket rows with a numeric entityId", async () => {
    getAuditLog.mockResolvedValue({
      logs: [makeLog({ id: 7, entityType: "ticket", entityId: "1234" })],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-7");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    const link = await screen.findByTestId("audit-entity-link-7");
    expect(link).toHaveTextContent("View ticket");
    expect(link.getAttribute("href")).toBe("/admin/tickets/1234");
  });

  it("renders a 'View member' link for user rows with a numeric entityId", async () => {
    getAuditLog.mockResolvedValue({
      logs: [makeLog({ id: 8, entityType: "user", entityId: "55" })],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-8");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    const link = await screen.findByTestId("audit-entity-link-8");
    expect(link).toHaveTextContent("View member");
    expect(link.getAttribute("href")).toBe("/admin/members/55");
  });

  it("renders the link even when other PII metadata is missing/redacted", async () => {
    // Same shape the server returns for a viewer without `members:pii` —
    // the metadata blob is stripped of email but the entity id remains.
    getAuditLog.mockResolvedValue({
      logs: [
        makeLog({
          id: 9,
          entityType: "user",
          entityId: "77",
          actorEmail: null,
          metadata: null,
        }),
      ],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-9");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    const link = await screen.findByTestId("audit-entity-link-9");
    expect(link.getAttribute("href")).toBe("/admin/members/77");
  });

  it("does not render a link when entityId is non-numeric (e.g. template slug)", async () => {
    getAuditLog.mockResolvedValue({
      logs: [
        makeLog({
          id: 10,
          actionType: "template_update",
          entityType: "email_template",
          entityId: "welcome-email",
        }),
      ],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-10");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    await waitFor(() => {
      expect(row).toHaveTextContent("welcome-email");
    });
    expect(screen.queryByTestId("audit-entity-link-10")).toBeNull();
  });

  it("does not render a link for entity types without a detail page", async () => {
    getAuditLog.mockResolvedValue({
      logs: [
        makeLog({
          id: 11,
          actionType: "update_setting",
          entityType: "system_setting",
          entityId: "12",
        }),
      ],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-11");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    await waitFor(() => {
      expect(row).toHaveTextContent("Entity ID:");
    });
    expect(screen.queryByTestId("audit-entity-link-11")).toBeNull();
  });

  it("does not render a link when entityId is missing", async () => {
    getAuditLog.mockResolvedValue({
      logs: [makeLog({ id: 12, entityType: "ticket", entityId: null })],
      cursors: { next: null, prev: null },
      pagination: { total: 1 },
      exportCap: 10000,
    });

    render(<AuditLog />);

    const row = await screen.findByTestId("audit-row-12");
    fireEvent.click(row.querySelector(".cursor-pointer") as HTMLElement);

    await waitFor(() => {
      expect(row).toHaveTextContent("Entity ID:");
    });
    expect(screen.queryByTestId("audit-entity-link-12")).toBeNull();
  });
});
