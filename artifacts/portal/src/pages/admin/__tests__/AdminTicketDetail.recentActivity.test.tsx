import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getTicketAuditHistory = vi.fn();
const getAdminTicket = vi.fn();
const getAdminTicketSla = vi.fn();
const getTicketAssignees = vi.fn();
const getAdminTickets = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getTicketAuditHistory: (...args: unknown[]) => getTicketAuditHistory(...args),
    getAdminTicket: (...args: unknown[]) => getAdminTicket(...args),
    getAdminTicketSla: (...args: unknown[]) => getAdminTicketSla(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "1" }),
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AdminTicketDetail from "@/pages/admin/AdminTicketDetail";

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ticketNumber: "BTS-000001",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Recent activity test ticket",
    source: null,
    sourceReferenceId: null,
    assignedTo: null,
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    member: { id: 7, name: "Casey Member", email: "casey@example.test" },
    assignee: null,
    tier: "standard",
    messages: [],
    ...overrides,
  };
}

beforeEach(() => {
  getTicketAuditHistory.mockReset();
  getAdminTicket.mockReset().mockResolvedValue(makeTicket());
  getAdminTicketSla.mockReset().mockResolvedValue(null);
  getTicketAssignees.mockReset().mockResolvedValue([]);
  getAdminTickets.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminTicketDetail Recent Activity card", () => {
  it("renders audit rows as deep-links to /admin/audit-log?entityType=ticket&expand=<id>", async () => {
    getTicketAuditHistory.mockResolvedValue({
      auditHistory: [
        {
          id: 9001,
          actionType: "update",
          entityType: "ticket",
          entityId: "1",
          actorId: 5,
          actorEmail: "agent@example.test",
          description: "ticket merged",
          createdAt: new Date().toISOString(),
        },
        {
          id: 9002,
          actionType: "update",
          entityType: "ticket",
          entityId: "1",
          actorId: 5,
          actorEmail: null,
          description: "status changed",
          createdAt: new Date().toISOString(),
        },
      ],
      limit: 20,
    });

    render(<AdminTicketDetail />);

    // The page calls the ticket audit endpoint with the numeric ticket id from
    // the route param.
    await waitFor(() => {
      expect(getTicketAuditHistory).toHaveBeenCalledWith(1);
    });

    const card = await screen.findByTestId("ticket-recent-activity-card");
    const list = await within(card).findByTestId("ticket-recent-activity-list");

    const link1 = within(list).getByTestId("ticket-audit-link-9001");
    const link2 = within(list).getByTestId("ticket-audit-link-9002");
    expect(link1).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=ticket&expand=9001",
    );
    expect(link2).toHaveAttribute(
      "href",
      "/admin/audit-log?entityType=ticket&expand=9002",
    );

    expect(within(card).getByText("ticket merged")).toBeInTheDocument();
    expect(within(card).getByText("status changed")).toBeInTheDocument();
  });

  it("shows an empty state when there is no audit history for the ticket", async () => {
    getTicketAuditHistory.mockResolvedValue({ auditHistory: [], limit: 20 });

    render(<AdminTicketDetail />);

    const card = await screen.findByTestId("ticket-recent-activity-card");
    await waitFor(() => {
      expect(within(card).getByTestId("ticket-recent-activity-empty")).toBeInTheDocument();
    });
  });

  it("surfaces an error message when the audit history fetch fails", async () => {
    getTicketAuditHistory.mockRejectedValue(new Error("boom"));

    render(<AdminTicketDetail />);

    const card = await screen.findByTestId("ticket-recent-activity-card");
    await waitFor(() => {
      expect(within(card).getByTestId("ticket-recent-activity-error")).toHaveTextContent("boom");
    });
  });
});
