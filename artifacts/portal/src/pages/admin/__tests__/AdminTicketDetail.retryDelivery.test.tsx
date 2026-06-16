import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getAdminTicket = vi.fn();
const getAdminTicketSla = vi.fn();
const getTicketAuditHistory = vi.fn();
const getTicketAssignees = vi.fn();
const getAdminTickets = vi.fn();
const retryTicketDelivery = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAdminTicket: (...args: unknown[]) => getAdminTicket(...args),
    getAdminTicketSla: (...args: unknown[]) => getAdminTicketSla(...args),
    getTicketAuditHistory: (...args: unknown[]) => getTicketAuditHistory(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
    retryTicketDelivery: (...args: unknown[]) => retryTicketDelivery(...args),
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AdminTicketDetail from "@/pages/admin/AdminTicketDetail";

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Notification never arrived",
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
    deliveryStatus: "failed",
    deliveryLastError: "TicketDesk timed out",
    ...overrides,
  };
}

beforeEach(() => {
  getAdminTicket.mockReset();
  getAdminTicketSla.mockReset().mockResolvedValue(null);
  getTicketAuditHistory.mockReset().mockResolvedValue({ auditHistory: [], limit: 20 });
  getTicketAssignees.mockReset().mockResolvedValue([]);
  getAdminTickets.mockReset().mockResolvedValue([]);
  retryTicketDelivery.mockReset().mockResolvedValue({ success: true, deliveryStatus: "pending" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminTicketDetail — retry delivery", () => {
  it("shows a Retry delivery button for failed deliveries and re-fetches after a retry", async () => {
    getAdminTicket
      .mockResolvedValueOnce(makeTicket({ deliveryStatus: "failed" }))
      .mockResolvedValue(makeTicket({ deliveryStatus: "pending", deliveryLastError: null }));

    const user = userEvent.setup();
    render(<AdminTicketDetail />);

    const button = await screen.findByTestId("ticket-retry-delivery-button");
    await user.click(button);

    await waitFor(() => {
      expect(retryTicketDelivery).toHaveBeenCalledWith(42);
    });
    // The page re-loads the ticket so the badge reflects the new status.
    await waitFor(() => {
      expect(getAdminTicket).toHaveBeenCalledTimes(2);
    });
    // Once the status flips to pending, the retry affordance disappears.
    await waitFor(() => {
      expect(screen.queryByTestId("ticket-retry-delivery-button")).toBeNull();
    });
  });

  it("shows the button for skipped deliveries", async () => {
    getAdminTicket.mockResolvedValue(makeTicket({ deliveryStatus: "skipped" }));

    render(<AdminTicketDetail />);

    expect(await screen.findByTestId("ticket-retry-delivery-button")).toBeInTheDocument();
  });

  it("does NOT show the button when delivery already succeeded", async () => {
    getAdminTicket.mockResolvedValue(makeTicket({ deliveryStatus: "delivered", deliveryLastError: null }));

    render(<AdminTicketDetail />);

    await screen.findByTestId("ticket-detail-header");
    expect(screen.queryByTestId("ticket-retry-delivery-button")).toBeNull();
  });

  it("surfaces an error inline when the retry fails", async () => {
    getAdminTicket.mockResolvedValue(makeTicket({ deliveryStatus: "failed" }));
    retryTicketDelivery.mockRejectedValueOnce(new Error("Delivery queue is unavailable"));

    const user = userEvent.setup();
    render(<AdminTicketDetail />);

    const button = await screen.findByTestId("ticket-retry-delivery-button");
    await user.click(button);

    const err = await screen.findByTestId("ticket-save-error");
    expect(err.textContent).toMatch(/Delivery queue is unavailable/);
  });
});
