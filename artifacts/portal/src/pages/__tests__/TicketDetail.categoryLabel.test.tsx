import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Companion to the formatTicketCategory unit test: this proves the ticket
// detail header actually pipes the raw enum through the formatter. A snake_case
// service category (`concierge_task` / `compliance_review`) must render as the
// human label in the header meta row, never the raw enum string.
//
// Mocking mirrors TicketDetail.deliveryBadge.test.tsx (AppLayout, wouter,
// @tanstack/react-query, @workspace/api-client-react).

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

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const useGetTicket = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: (...args: unknown[]) => useGetTicket(...args),
  useAddTicketMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveTicket: () => ({ mutate: vi.fn(), isPending: false }),
  getGetTicketQueryKey: (id: number) => ["/tickets", id],
  getListTicketsQueryKey: () => ["/tickets"],
}));

import TicketDetail from "@/pages/TicketDetail";

function makeTicket(category: string) {
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category,
    priority: "normal" as const,
    status: "open" as const,
    subject: "Help with my request",
    deliveryStatus: "delivered",
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    messages: [],
  };
}

beforeEach(() => {
  useGetTicket.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — category label", () => {
  it.each([
    ["concierge_task", "Concierge Task"],
    ["compliance_review", "Compliance Review"],
  ])(
    "renders the human label for %s, not the raw enum",
    (category, label) => {
      useGetTicket.mockReturnValue({
        data: makeTicket(category),
        isLoading: false,
      });

      render(<TicketDetail />);

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(category)).toBeNull();
    },
  );
});
