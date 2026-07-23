import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Compliance Review page surfaces the member's prior submissions (which are
// support tickets of category `compliance_review`) as two status sections above
// the intake form: "Current Submissions" (active tickets) and "Past
// Submissions" (resolved/closed). This test pins that split, the per-item
// status badges ("Submitted — in queue" / "In progress — the team is on it" /
// "Completed"), the soft "New reply — response may be needed" indicator (driven
// by the inferred `awaitingMemberReply` flag, with the legacy
// `awaiting_response` status still honored) whose rows get a solid "View &
// Respond" button opening the conversation modal in respond mode, and the
// read-only "View Conversation" modal that shows the full thread (member +
// team, internal notes excluded).
//
// Mocking follows the portal page-test pattern: stub AppLayout, wrap in a
// QueryClient, and drive the ticket list + ticket detail through a stubbed
// global `fetch`.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

// wouter's <Link> renders an anchor; the page still uses it for other links
// (e.g. the submit-for-review link), so stub it as a plain anchor without a real router.
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
  awaitingMemberReply: boolean;
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
    awaitingMemberReply: false,
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

  it("splits active submissions into Current and resolved into Past Submissions with the right badges", async () => {
    tickets = [
      complianceTicket({ id: 1, ticketNumber: "CMP-001", status: "in_progress", subject: "Compliance Review — Alpha Offer" }),
      complianceTicket({ id: 2, ticketNumber: "CMP-002", status: "resolved", subject: "Compliance Review — Beta Offer" }),
      complianceTicket({ id: 6, ticketNumber: "CMP-006", status: "open", subject: "Compliance Review — Zeta Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("compliance-active-1");
    expect(within(active).getByText("Alpha Offer")).toBeInTheDocument();
    // A plain in-progress submission shows the calm status badge...
    expect(within(active).getByText("In progress — the team is on it")).toBeInTheDocument();
    // ...and the quiet "View Conversation" button (opens the modal, not a link).
    const viewConversation = within(active).getByTestId("compliance-view-conversation-1");
    expect(viewConversation).toHaveTextContent("View Conversation");
    expect(viewConversation.closest("a")).toBeNull();
    // No reply-needed nudge for a plain in_progress ticket.
    expect(screen.queryByTestId("compliance-reply-needed-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("compliance-respond-1")).not.toBeInTheDocument();

    // A still-queued submission is distinguished from one being worked.
    const queued = screen.getByTestId("compliance-active-6");
    expect(within(queued).getByText("Submitted — in queue")).toBeInTheDocument();

    const past = screen.getByTestId("compliance-past-2");
    expect(within(past).getByText("Beta Offer")).toBeInTheDocument();
    expect(within(past).getByText("Completed")).toBeInTheDocument();
    expect(within(past).getByTestId("compliance-view-conversation-2")).toHaveTextContent("View Conversation");
  });

  it("shows the soft New reply indicator and a View & Respond button when awaitingMemberReply is set", async () => {
    tickets = [
      complianceTicket({ id: 3, ticketNumber: "CMP-003", status: "in_progress", awaitingMemberReply: true, subject: "Compliance Review — Gamma Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("compliance-active-3");
    expect(within(active).getByTestId("compliance-reply-needed-3")).toHaveTextContent(/new reply/i);
    // Reply needed → solid "View & Respond" button that opens the in-place
    // respond modal (a text-only reply popup), NOT a deep link to the full page.
    const cta = within(active).getByTestId("compliance-respond-3");
    expect(cta).toHaveTextContent("View & Respond");
    expect(cta.closest("a")).toBeNull();
    // The calm conversation modal button is not offered for reply-needed rows.
    expect(within(active).queryByTestId("compliance-view-conversation-3")).not.toBeInTheDocument();

    // Clicking opens the conversation modal with a text-only reply box.
    fireEvent.click(cta);
    expect(await screen.findByTestId("conversation-reply-input")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-reply-send")).toBeInTheDocument();
  });

  it("still honors the legacy awaiting_response status as reply-needed", async () => {
    tickets = [
      complianceTicket({ id: 7, ticketNumber: "CMP-007", status: "awaiting_response", subject: "Compliance Review — Eta Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("compliance-active-7");
    expect(within(active).getByTestId("compliance-reply-needed-7")).toHaveTextContent(/new reply/i);
    expect(within(active).getByTestId("compliance-respond-7")).toHaveTextContent("View & Respond");
  });

  it("shows the full conversation (member + team, internal excluded) in the read-only View Conversation modal", async () => {
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
    fireEvent.click(within(past).getByTestId("compliance-view-conversation-4"));

    // The member's own message and every non-internal team reply are shown.
    expect(await screen.findByTestId("conversation-message-100")).toHaveTextContent("My submission");
    expect(screen.getByTestId("conversation-message-101")).toHaveTextContent("First review note");
    expect(screen.getByTestId("conversation-message-102")).toHaveTextContent("Final approval");
    // The internal note is excluded.
    expect(screen.queryByTestId("conversation-message-103")).not.toBeInTheDocument();
  });

  it("shows a graceful empty state when a submission has no messages", async () => {
    tickets = [
      complianceTicket({ id: 5, ticketNumber: "CMP-005", status: "resolved", subject: "Compliance Review — Epsilon Offer" }),
    ];
    messagesByTicketId[5] = [];

    renderPage();

    const past = await screen.findByTestId("compliance-past-5");
    fireEvent.click(within(past).getByTestId("compliance-view-conversation-5"));

    const empty = await screen.findByTestId("conversation-empty");
    expect(empty).toHaveTextContent(/no messages/i);
  });
});
