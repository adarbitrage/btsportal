import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// The pure label mapper `formatTicketCategory` is unit-tested in
// support-topics.test.ts, but that does not prove the member-facing ticket
// list actually routes the raw enum through it. This test renders the real
// Support page with snake_case service categories (`concierge_task`,
// `compliance_review`) and asserts the human labels surface — never the raw
// enum string — so a component regression that prints `ticket.category`
// directly is caught.
//
// Follows the page-test mocking pattern used across the portal
// (TicketDetail.deliveryBadge, Plans.*, Account.*): stub AppLayout, wouter,
// @tanstack/react-query, and the generated @workspace/api-client-react hooks.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
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
  useLocation: () => ["/support", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const useListTickets = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListTickets: (...args: unknown[]) => useListTickets(...args),
  useCreateTicket: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveTicket: () => ({ mutate: vi.fn(), isPending: false }),
  getListTicketsQueryKey: () => ["/tickets"],
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, data: unknown) {
      super("ApiError");
      this.status = status;
      this.data = data;
    }
  },
}));

import Support from "@/pages/Support";

function makeTicket(id: number, category: string) {
  return {
    id,
    ticketNumber: `BTS-0000${id}`,
    userId: 7,
    category,
    priority: "normal" as const,
    status: "open" as const,
    subject: `Ticket ${id}`,
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
  };
}

beforeEach(() => {
  useListTickets.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Support list — ticket category labels", () => {
  it("renders the human label for snake_case service categories, not the raw enum", () => {
    useListTickets.mockReturnValue({
      data: [makeTicket(1, "concierge_task"), makeTicket(2, "compliance_review")],
      isLoading: false,
    });

    render(<Support />);

    const conciergeBadge = screen.getByTestId("ticket-category-badge-1");
    expect(conciergeBadge).toHaveTextContent("Concierge Task");
    expect(conciergeBadge).not.toHaveTextContent("concierge_task");

    const complianceBadge = screen.getByTestId("ticket-category-badge-2");
    expect(complianceBadge).toHaveTextContent("Compliance Review");
    expect(complianceBadge).not.toHaveTextContent("compliance_review");
  });

  it("renders the title-cased label for ordinary support categories", () => {
    useListTickets.mockReturnValue({
      data: [makeTicket(3, "billing")],
      isLoading: false,
    });

    render(<Support />);

    const badge = screen.getByTestId("ticket-category-badge-3");
    expect(badge).toHaveTextContent("Billing");
  });
});
