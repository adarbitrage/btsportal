import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getAdminTickets = vi.fn();
const getTicketAssignees = vi.fn();
const updateTicketStatus = vi.fn();
const updateTicketAssignee = vi.fn();
const retryTicketDelivery = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    updateTicketStatus: (...args: unknown[]) => updateTicketStatus(...args),
    updateTicketAssignee: (...args: unknown[]) => updateTicketAssignee(...args),
    retryTicketDelivery: (...args: unknown[]) => retryTicketDelivery(...args),
  },
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href} data-testid="ticket-link">
      {children}
    </a>
  ),
}));

import AdminTicketQueue from "@/pages/admin/AdminTicketQueue";

type Ticket = Awaited<ReturnType<typeof import("@/lib/admin-panel-api").adminPanelApi.getAdminTickets>>[number];

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    ticketNumber: "BTS-000001",
    userId: 100,
    category: "billing",
    priority: "normal",
    status: "open",
    subject: "Default subject",
    assignedTo: null,
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    deliveryStatus: "delivered",
    deliveryLastError: null,
    member: { id: 100, name: "Default Member", email: "default@example.test" },
    assignee: null,
    tier: null,
    slaStatus: null,
    ...overrides,
  };
}

const FAILED = makeTicket({ id: 21, ticketNumber: "BTS-000021", subject: "Failed delivery", deliveryStatus: "failed" });
const SKIPPED = makeTicket({ id: 22, ticketNumber: "BTS-000022", subject: "Skipped delivery", deliveryStatus: "skipped" });
const DELIVERED = makeTicket({ id: 23, ticketNumber: "BTS-000023", subject: "Delivered fine", deliveryStatus: "delivered" });
const TICKETS: Ticket[] = [FAILED, SKIPPED, DELIVERED];

beforeEach(() => {
  getAdminTickets.mockReset().mockResolvedValue(TICKETS);
  getTicketAssignees.mockReset().mockResolvedValue([]);
  updateTicketStatus.mockReset().mockResolvedValue({ success: true });
  updateTicketAssignee.mockReset().mockResolvedValue({ success: true });
  retryTicketDelivery.mockReset().mockResolvedValue({ success: true, deliveryStatus: "pending" });
  toast.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitForAllRows() {
  await waitFor(() => {
    expect(screen.getAllByTestId("ticket-link")).toHaveLength(TICKETS.length);
  });
}

describe("AdminTicketQueue — retry delivery", () => {
  it("shows a Retry action only on failed/skipped rows", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    expect(screen.getByTestId("queue-retry-delivery-21")).toBeInTheDocument();
    expect(screen.getByTestId("queue-retry-delivery-22")).toBeInTheDocument();
    expect(screen.queryByTestId("queue-retry-delivery-23")).not.toBeInTheDocument();
  });

  it("retries a single delivery and refetches the queue", async () => {
    const user = userEvent.setup();
    render(<AdminTicketQueue />);
    await waitForAllRows();
    expect(getAdminTickets).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("queue-retry-delivery-21"));

    await waitFor(() => {
      expect(retryTicketDelivery).toHaveBeenCalledWith(21);
    });
    await waitFor(() => {
      expect(getAdminTickets).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces an error toast when a retry fails", async () => {
    retryTicketDelivery.mockRejectedValueOnce(new Error("Delivery queue is unavailable"));
    const user = userEvent.setup();
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await user.click(screen.getByTestId("queue-retry-delivery-22"));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });

  it("bulk retry button only acts on selected undelivered tickets", async () => {
    const user = userEvent.setup();
    render(<AdminTicketQueue />);
    await waitForAllRows();

    // Select the failed and the delivered tickets.
    await user.click(screen.getByTestId("bulk-select-row-21"));
    await user.click(screen.getByTestId("bulk-select-row-23"));

    const bulkRetry = await screen.findByTestId("bulk-retry-delivery-button");
    // Only the one failed ticket is retryable.
    expect(within(bulkRetry).getByText(/Retry delivery \(1\)/)).toBeInTheDocument();

    await user.click(bulkRetry);

    await waitFor(() => {
      expect(retryTicketDelivery).toHaveBeenCalledTimes(1);
    });
    expect(retryTicketDelivery).toHaveBeenCalledWith(21);
  });

  it("hides the bulk retry button when no selected ticket is undelivered", async () => {
    const user = userEvent.setup();
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await user.click(screen.getByTestId("bulk-select-row-23"));

    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-retry-delivery-button")).not.toBeInTheDocument();
  });
});
