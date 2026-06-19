import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// The member /support list grew tab filters (All / Support / Concierge /
// Compliance), a search box, and distinct coloured badges for the two service
// categories (concierge_task / compliance_review). This suite locks in that
// behaviour so a future refactor can't silently break the filtering or the
// badge styling.

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
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const useListTickets = vi.fn();
vi.mock("@workspace/api-client-react", () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, data: unknown) {
      super("api error");
      this.status = status;
      this.data = data;
    }
  }
  return {
    useListTickets: () => useListTickets(),
    useCreateTicket: () => ({ mutate: vi.fn(), isPending: false }),
    useResolveTicket: () => ({ mutate: vi.fn() }),
    getListTicketsQueryKey: () => ["/tickets"],
    ApiError,
  };
});

import Support from "@/pages/Support";

const tickets = [
  {
    id: 1,
    ticketNumber: "TKT-001",
    subject: "Cannot log in to the dashboard",
    category: "technical",
    status: "open",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: 2,
    ticketNumber: "TKT-002",
    subject: "Invoice question",
    category: "billing",
    status: "open",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
  {
    id: 3,
    ticketNumber: "TKT-003",
    subject: "Please book my travel",
    category: "concierge_task",
    status: "open",
    updatedAt: "2026-06-03T00:00:00.000Z",
  },
  {
    id: 4,
    ticketNumber: "TKT-004",
    subject: "Review my disclosure copy",
    category: "compliance_review",
    status: "open",
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
];

function visibleTicketIds(): number[] {
  return tickets
    .map((t) => t.id)
    .filter((id) => screen.queryByTestId(`ticket-category-badge-${id}`) !== null);
}

beforeEach(() => {
  useListTickets.mockReset();
  useListTickets.mockReturnValue({ data: tickets, isLoading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Support — Concierge/Compliance filter tabs", () => {
  it("shows every ticket under the All tab by default", () => {
    render(<Support />);
    expect(visibleTicketIds()).toEqual([1, 2, 3, 4]);
  });

  it("Support tab collapses every non-service category (hides concierge/compliance)", () => {
    render(<Support />);
    fireEvent.click(screen.getByTestId("ticket-filter-support"));
    expect(visibleTicketIds()).toEqual([1, 2]);
  });

  it("Concierge tab shows only concierge_task tickets", () => {
    render(<Support />);
    fireEvent.click(screen.getByTestId("ticket-filter-concierge_task"));
    expect(visibleTicketIds()).toEqual([3]);
  });

  it("Compliance tab shows only compliance_review tickets", () => {
    render(<Support />);
    fireEvent.click(screen.getByTestId("ticket-filter-compliance_review"));
    expect(visibleTicketIds()).toEqual([4]);
  });
});

describe("Support — search box", () => {
  it("filters by subject text", () => {
    render(<Support />);
    fireEvent.change(screen.getByPlaceholderText(/search tickets/i), {
      target: { value: "invoice" },
    });
    expect(visibleTicketIds()).toEqual([2]);
  });

  it("filters by ticket number", () => {
    render(<Support />);
    fireEvent.change(screen.getByPlaceholderText(/search tickets/i), {
      target: { value: "TKT-003" },
    });
    expect(visibleTicketIds()).toEqual([3]);
  });

  it("filters by the human-readable category label", () => {
    render(<Support />);
    fireEvent.change(screen.getByPlaceholderText(/search tickets/i), {
      target: { value: "compliance review" },
    });
    expect(visibleTicketIds()).toEqual([4]);
  });

  it("combines the active filter tab with the search term", () => {
    render(<Support />);
    fireEvent.click(screen.getByTestId("ticket-filter-support"));
    fireEvent.change(screen.getByPlaceholderText(/search tickets/i), {
      target: { value: "invoice" },
    });
    // "Please book my travel" is concierge (filtered out by the Support tab),
    // so the only match is the billing invoice ticket.
    expect(visibleTicketIds()).toEqual([2]);
  });
});

describe("Support — service-category badge styling", () => {
  it("renders the distinct concierge badge (violet) with its category marker", () => {
    render(<Support />);
    const badge = screen.getByTestId("ticket-category-badge-3");
    expect(badge).toHaveAttribute("data-category", "concierge_task");
    expect(badge).toHaveTextContent(/concierge task/i);
    expect(badge.className).toMatch(/violet/);
  });

  it("renders the distinct compliance badge (amber) with its category marker", () => {
    render(<Support />);
    const badge = screen.getByTestId("ticket-category-badge-4");
    expect(badge).toHaveAttribute("data-category", "compliance_review");
    expect(badge).toHaveTextContent(/compliance review/i);
    expect(badge.className).toMatch(/amber/);
  });

  it("renders ordinary categories with the neutral badge (no service colour)", () => {
    render(<Support />);
    const badge = screen.getByTestId("ticket-category-badge-1");
    expect(badge).toHaveAttribute("data-category", "technical");
    expect(badge.className).not.toMatch(/violet|amber/);
    expect(badge.className).toMatch(/bg-muted/);
  });
});
