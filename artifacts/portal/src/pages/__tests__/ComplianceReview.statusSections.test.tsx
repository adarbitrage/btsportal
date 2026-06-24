import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Compliance Review page surfaces the member's prior submissions (which are
// support tickets of category `compliance_review`) as two status sections above
// the intake form: "Currently Under Review" (active tickets) and "Past
// Submissions" (resolved/closed). This test pins that split, the action-needed
// escalation on `awaiting_response`, the thread deep-link, and the View Results
// dialog that reveals the reviewer's reply.
//
// Mocking follows the portal page-test pattern: stub AppLayout, wrap in a
// QueryClient, and drive the ticket list + ticket detail through a stubbed
// global `fetch`.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

// wouter's <Link> renders an anchor; capture its href so we can assert the row
// deep-links to the existing ticket thread page without a real router.
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ComplianceReview from "@/pages/ComplianceReview";

type FakeTicket = {
  id: number;
  ticketNumber: string;
  category: string;
  status: string;
  subject: string;
  createdAt: string;
};

type FakeMessage = {
  id: number;
  senderType: "member" | "admin";
  body: string;
  createdAt: string;
  isInternal?: boolean;
};

let tickets: FakeTicket[] = [];
let messagesByTicketId: Record<number, FakeMessage[]> = {};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tickets = [];
  messagesByTicketId = {};

  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    // Ticket detail: /api/tickets/:id (check before the list match).
    const detailMatch = url.match(/\/api\/tickets\/(\d+)/);
    if (detailMatch) {
      const id = Number(detailMatch[1]);
      const ticket = tickets.find((t) => t.id === id);
      return jsonResponse({
        ...ticket,
        messages: messagesByTicketId[id] ?? [],
        attachments: [],
      });
    }
    if (url.includes("/api/tickets")) {
      return jsonResponse(tickets);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComplianceReview />
    </QueryClientProvider>,
  );
}

function complianceTicket(overrides: Partial<FakeTicket>): FakeTicket {
  return {
    id: 1,
    ticketNumber: "CMP-001",
    category: "compliance_review",
    status: "open",
    subject: "Compliance Review — Offer",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ComplianceReview — submission status sections", () => {
  it("always shows both sections with empty states and a Submit CTA when the member has no compliance submissions", async () => {
    tickets = [
      complianceTicket({ id: 9, category: "technical", status: "open", subject: "Help" }),
    ];

    renderPage();

    // The landing mirrors the Private Coaching page: sections are always
    // present. With no compliance tickets, both render their empty states and
    // the "Submit for Review" call to action is available.
    await screen.findByTestId("compliance-submissions");
    expect(await screen.findByTestId("compliance-active-empty")).toBeInTheDocument();
    expect(screen.getByTestId("compliance-past-empty")).toBeInTheDocument();
    expect(screen.getAllByTestId("compliance-submit-cta").length).toBeGreaterThan(0);
    // A non-compliance ticket is never surfaced here.
    expect(screen.queryByTestId("compliance-active-9")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compliance-past-9")).not.toBeInTheDocument();
  });

  it("splits active submissions into Under Review and resolved into Past Submissions", async () => {
    tickets = [
      complianceTicket({ id: 1, ticketNumber: "CMP-001", status: "in_progress", subject: "Compliance Review — Alpha Offer" }),
      complianceTicket({ id: 2, ticketNumber: "CMP-002", status: "resolved", subject: "Compliance Review — Beta Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("compliance-active-1");
    expect(within(active).getByText("Alpha Offer")).toBeInTheDocument();
    // Default active CTA is the quiet "View Submission" linking to the thread.
    const viewSubmission = within(active).getByTestId("compliance-view-submission-1");
    expect(viewSubmission).toHaveTextContent("View Submission");
    expect(viewSubmission.closest("a")).toHaveAttribute("href", "/support/tickets/1");
    // No action-needed banner for a plain in_progress ticket.
    expect(screen.queryByTestId("compliance-action-needed-1")).not.toBeInTheDocument();

    const past = screen.getByTestId("compliance-past-2");
    expect(within(past).getByText("Beta Offer")).toBeInTheDocument();
    expect(within(past).getByText("Complete")).toBeInTheDocument();
  });

  it("escalates an awaiting_response submission with a banner and View & Reply CTA", async () => {
    tickets = [
      complianceTicket({ id: 3, ticketNumber: "CMP-003", status: "awaiting_response", subject: "Compliance Review — Gamma Offer" }),
    ];

    renderPage();

    const banner = await screen.findByTestId("compliance-action-needed-3");
    expect(banner).toHaveTextContent(/action needed/i);
    const cta = screen.getByTestId("compliance-view-submission-3");
    expect(cta).toHaveTextContent("View & Reply");
    expect(cta.closest("a")).toHaveAttribute("href", "/support/tickets/3");
  });

  it("shows the reviewer's reply newest-first in the View Results dialog", async () => {
    tickets = [
      complianceTicket({ id: 4, ticketNumber: "CMP-004", status: "closed", subject: "Compliance Review — Delta Offer" }),
    ];
    messagesByTicketId[4] = [
      { id: 100, senderType: "member", body: "My submission", createdAt: "2026-06-01T00:00:00.000Z" },
      { id: 101, senderType: "admin", body: "First review note", createdAt: "2026-06-02T00:00:00.000Z" },
      { id: 102, senderType: "admin", body: "Final approval", createdAt: "2026-06-03T00:00:00.000Z" },
      // Internal admin notes must never surface to the member.
      { id: 103, senderType: "admin", body: "internal only", createdAt: "2026-06-04T00:00:00.000Z", isInternal: true },
    ];

    renderPage();

    const past = await screen.findByTestId("compliance-past-4");
    fireEvent.click(within(past).getByTestId("compliance-view-results-4"));

    // The newest admin reply renders first and is labelled "Latest".
    const latest = await screen.findByTestId("compliance-result-102");
    expect(latest).toHaveTextContent("Final approval");
    expect(within(latest).getByText("Latest")).toBeInTheDocument();

    expect(screen.getByTestId("compliance-result-101")).toHaveTextContent("First review note");
    // The member's own message and the internal note are excluded.
    expect(screen.queryByTestId("compliance-result-100")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compliance-result-103")).not.toBeInTheDocument();
  });

  it("shows a graceful fallback when a completed submission has no written reply", async () => {
    tickets = [
      complianceTicket({ id: 5, ticketNumber: "CMP-005", status: "resolved", subject: "Compliance Review — Epsilon Offer" }),
    ];
    messagesByTicketId[5] = [
      { id: 200, senderType: "member", body: "My submission", createdAt: "2026-06-01T00:00:00.000Z" },
    ];

    renderPage();

    const past = await screen.findByTestId("compliance-past-5");
    fireEvent.click(within(past).getByTestId("compliance-view-results-5"));

    const empty = await screen.findByTestId("compliance-results-empty");
    expect(empty).toHaveTextContent(/no written response/i);
  });
});
