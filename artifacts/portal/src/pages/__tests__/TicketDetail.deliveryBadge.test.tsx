import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Task #885 added a member-facing delivery badge + failure notice to the ticket
// detail page. This test pins that behaviour so a future change (or a codegen
// regen that drops `deliveryStatus` from the ticket type) can't silently break
// the "Delivered to support team" badge or the failure reassurance notice.
//
// We follow the page-test mocking pattern used across the portal (Plans.*,
// Account.*): stub AppLayout, wouter, @tanstack/react-query, and the generated
// @workspace/api-client-react hooks. `useGetTicket` is the only data source the
// header reads, so each case just feeds it a ticket with the relevant
// deliveryStatus.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const useGetTicket = vi.fn();
const addMessageMutate = vi.fn();
const resolveTicketMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: (...args: unknown[]) => useGetTicket(...args),
  useAddTicketMessage: () => ({ mutate: addMessageMutate, isPending: false }),
  useResolveTicket: () => ({ mutate: resolveTicketMutate, isPending: false }),
  getGetTicketQueryKey: (id: number) => ["/tickets", id],
}));

import TicketDetail from "@/pages/TicketDetail";

function makeTicket(deliveryStatus: string | null) {
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Help with my account",
    deliveryStatus,
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    messages: [],
  };
}

beforeEach(() => {
  useGetTicket.mockReset();
  addMessageMutate.mockReset();
  invalidateQueries.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — member delivery badge", () => {
  it("shows the green 'Delivered to support team' badge when delivery_status = 'delivered'", () => {
    useGetTicket.mockReturnValue({
      data: makeTicket("delivered"),
      isLoading: false,
    });

    render(<TicketDetail />);

    const badge = screen.getByTestId("ticket-delivery-badge");
    expect(badge).toHaveTextContent(/Delivered to support team/i);
    expect(badge.querySelector(".border-green-500")).not.toBeNull();

    // No failure reassurance notice for a successfully delivered ticket.
    expect(screen.queryByTestId("ticket-delivery-failed-notice")).toBeNull();
  });

  it("shows the amber failure notice and badge when delivery_status = 'failed'", () => {
    useGetTicket.mockReturnValue({
      data: makeTicket("failed"),
      isLoading: false,
    });

    render(<TicketDetail />);

    const badge = screen.getByTestId("ticket-delivery-badge");
    expect(badge).toHaveTextContent(/Team notified by email/i);

    const notice = screen.getByTestId("ticket-delivery-failed-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/notified by email/i);
    expect(notice).toHaveTextContent(/no need to resubmit/i);
  });

  it.each(["pending", "skipped"])(
    "shows the neutral 'Delivering to support team' badge when delivery_status = '%s'",
    (status) => {
      useGetTicket.mockReturnValue({
        data: makeTicket(status),
        isLoading: false,
      });

      render(<TicketDetail />);

      const badge = screen.getByTestId("ticket-delivery-badge");
      expect(badge).toHaveTextContent(/Delivering to support team/i);

      // In-progress states are reassuring, not alarming — no failure notice.
      expect(screen.queryByTestId("ticket-delivery-failed-notice")).toBeNull();
    },
  );
});
