import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Concierge page surfaces the member's prior submissions (which are support
// tickets of category `concierge_task`) as two status sections above the intake
// form: "Current Submissions" (active tickets) and "Past Submissions"
// (resolved/closed). This mirrors the Compliance Review landing page. This test
// pins that split, the per-item status badges ("In Progress" / "Action Needed" /
// "Completed"), the action-needed escalation on `awaiting_response` (solid "View
// & Respond" opening the conversation modal in respond mode), and the read-only
// "View Conversation" modal that shows the full thread (member + team, internal
// notes excluded).
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
// (e.g. the VA/task links), so stub it as a plain anchor without a real router.
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import Concierge from "@/pages/Concierge";

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

type FakeAttachment = { id: number; fileName: string };

let tickets: FakeTicket[] = [];
let messagesByTicketId: Record<number, FakeMessage[]> = {};
let attachmentsByTicketId: Record<number, FakeAttachment[]> = {};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  tickets = [];
  messagesByTicketId = {};
  attachmentsByTicketId = {};

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
        attachments: attachmentsByTicketId[id] ?? [],
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
      <Concierge />
    </QueryClientProvider>,
  );
}

function conciergeTicket(overrides: Partial<FakeTicket>): FakeTicket {
  return {
    id: 1,
    ticketNumber: "CNC-001",
    category: "concierge_task",
    status: "open",
    subject: "Concierge Task — Offer",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Concierge — submission status sections", () => {
  it("always shows both sections with empty states and a Submit CTA when the member has no concierge submissions", async () => {
    tickets = [
      conciergeTicket({ id: 9, category: "technical", status: "open", subject: "Help" }),
    ];

    renderPage();

    // The submissions view mirrors the Compliance landing page: sections are
    // always present. With no concierge tickets, both render their empty states
    // and the "Submit a Task" call to action is available.
    await screen.findByTestId("concierge-submissions");
    expect(await screen.findByTestId("concierge-active-empty")).toBeInTheDocument();
    expect(screen.getByTestId("concierge-past-empty")).toBeInTheDocument();
    const ctas = screen.getAllByTestId("concierge-submit-cta");
    expect(ctas.length).toBeGreaterThan(0);
    // The CTA routes to the dedicated intake page (mirroring Compliance), not an
    // in-page #task anchor.
    for (const cta of ctas) {
      expect(cta.closest("a")).toHaveAttribute("href", "/concierge/submit");
    }
    // A non-concierge ticket is never surfaced here.
    expect(screen.queryByTestId("concierge-active-9")).not.toBeInTheDocument();
    expect(screen.queryByTestId("concierge-past-9")).not.toBeInTheDocument();
  });

  it("splits active submissions into Current and resolved into Past Submissions with the right badges", async () => {
    tickets = [
      conciergeTicket({ id: 1, ticketNumber: "CNC-001", status: "in_progress", subject: "Concierge Task — Alpha Offer" }),
      conciergeTicket({ id: 2, ticketNumber: "CNC-002", status: "resolved", subject: "Concierge Task — Beta Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("concierge-active-1");
    expect(within(active).getByText("Alpha Offer")).toBeInTheDocument();
    // A plain active submission shows the calm "In Progress" badge...
    expect(within(active).getByText("In Progress")).toBeInTheDocument();
    // ...and the quiet "View Conversation" button (opens the modal, not a link).
    const viewConversation = within(active).getByTestId("concierge-view-conversation-1");
    expect(viewConversation).toHaveTextContent("View Conversation");
    expect(viewConversation.closest("a")).toBeNull();
    // No action-needed escalation for a plain in_progress ticket.
    expect(screen.queryByTestId("concierge-action-needed-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("concierge-respond-1")).not.toBeInTheDocument();

    const past = screen.getByTestId("concierge-past-2");
    expect(within(past).getByText("Beta Offer")).toBeInTheDocument();
    expect(within(past).getByText("Completed")).toBeInTheDocument();
    expect(within(past).getByTestId("concierge-view-conversation-2")).toHaveTextContent("View Conversation");
  });

  it("escalates an awaiting_response submission with an Action Needed badge and a View & Respond button that opens a text reply box", async () => {
    tickets = [
      conciergeTicket({ id: 3, ticketNumber: "CNC-003", status: "awaiting_response", subject: "Concierge Task — Gamma Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("concierge-active-3");
    expect(within(active).getByTestId("concierge-action-needed-3")).toHaveTextContent(/action needed/i);
    // Action needed → solid "View & Respond" button that opens the in-place
    // respond modal (a text-only reply popup), NOT a deep link to the full page.
    const cta = within(active).getByTestId("concierge-respond-3");
    expect(cta).toHaveTextContent("View & Respond");
    expect(cta.closest("a")).toBeNull();
    // The calm conversation modal button is not offered for action-needed rows.
    expect(within(active).queryByTestId("concierge-view-conversation-3")).not.toBeInTheDocument();

    // Clicking opens the conversation modal with a text-only reply box.
    fireEvent.click(cta);
    expect(await screen.findByTestId("conversation-reply-input")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-reply-send")).toBeInTheDocument();
  });

  it("shows each live row's at-a-glance summary: task(s) and file count", async () => {
    tickets = [
      conciergeTicket({ id: 6, ticketNumber: "CNC-006", status: "in_progress", subject: "Concierge Task — Zeta Offer" }),
      conciergeTicket({ id: 7, ticketNumber: "CNC-007", status: "resolved", subject: "Concierge Task — Eta Offer" }),
    ];
    // Active row: tasks parsed from the intake body; file count from the
    // structured attachment rows.
    messagesByTicketId[6] = [
      {
        id: 300,
        senderType: "member",
        body: [
          "Offer Name: Zeta Offer",
          "Selected Task(s): Create Jump Page Headlines (10 headlines max); Set Up Initial DIYTrax™ Campaign",
        ].join("\n"),
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ];
    attachmentsByTicketId[6] = [
      { id: 1, fileName: "a.png" },
      { id: 2, fileName: "b.png" },
      { id: 3, fileName: "c.png" },
    ];
    // Past row: no structured attachments, so the file count falls back to the
    // body's "Uploaded Files (N):" header.
    messagesByTicketId[7] = [
      {
        id: 301,
        senderType: "member",
        body: [
          "Offer Name: Eta Offer",
          "Selected Task(s): Optimize Campaign Banners (1 campaign max)",
          "",
          "Uploaded Files (2):",
          "  1. one.zip",
          "  2. two.zip",
        ].join("\n"),
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ];

    renderPage();

    const active = await screen.findByTestId("concierge-active-6");
    const activeTasks = await within(active).findAllByTestId("concierge-summary-task-6");
    expect(activeTasks.map((n) => n.textContent)).toEqual([
      "Create Jump Page Headlines (10 headlines max)",
      "Set Up Initial DIYTrax™ Campaign",
    ]);
    expect(within(active).getByTestId("concierge-summary-files-6")).toHaveTextContent("3 files");

    const past = await screen.findByTestId("concierge-past-7");
    const pastTasks = await within(past).findAllByTestId("concierge-summary-task-7");
    expect(pastTasks.map((n) => n.textContent)).toEqual([
      "Optimize Campaign Banners (1 campaign max)",
    ]);
    // Fallback to the body header; singular wording when exactly one file.
    expect(within(past).getByTestId("concierge-summary-files-7")).toHaveTextContent("2 files");
  });

  it("omits the summary when a submission has no tasks and no files", async () => {
    tickets = [
      conciergeTicket({ id: 8, ticketNumber: "CNC-008", status: "open", subject: "Concierge Task — Theta Offer" }),
    ];
    messagesByTicketId[8] = [
      {
        id: 302,
        senderType: "member",
        body: ["Offer Name: Theta Offer", "Selected Task(s): None selected"].join("\n"),
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ];

    renderPage();

    const active = await screen.findByTestId("concierge-active-8");
    // Give the lazy detail fetch a chance to resolve, then assert no summary.
    expect(within(active).getByText("Theta Offer")).toBeInTheDocument();
    expect(screen.queryByTestId("concierge-summary-8")).not.toBeInTheDocument();
  });

  it("shows the full conversation (member + team, internal excluded) in the read-only View Conversation modal", async () => {
    tickets = [
      conciergeTicket({ id: 4, ticketNumber: "CNC-004", status: "closed", subject: "Concierge Task — Delta Offer" }),
    ];
    messagesByTicketId[4] = [
      { id: 100, senderType: "member", body: "My request", createdAt: "2026-06-01T00:00:00.000Z" },
      { id: 101, senderType: "admin", body: "First update note", createdAt: "2026-06-02T00:00:00.000Z" },
      { id: 102, senderType: "admin", body: "All done", createdAt: "2026-06-03T00:00:00.000Z" },
      // Internal admin notes must never surface to the member.
      { id: 103, senderType: "admin", body: "internal only", createdAt: "2026-06-04T00:00:00.000Z", isInternal: true },
    ];

    renderPage();

    const past = await screen.findByTestId("concierge-past-4");
    fireEvent.click(within(past).getByTestId("concierge-view-conversation-4"));

    // The member's own message and every non-internal team reply are shown.
    expect(await screen.findByTestId("conversation-message-100")).toHaveTextContent("My request");
    expect(screen.getByTestId("conversation-message-101")).toHaveTextContent("First update note");
    expect(screen.getByTestId("conversation-message-102")).toHaveTextContent("All done");
    // The internal note is excluded.
    expect(screen.queryByTestId("conversation-message-103")).not.toBeInTheDocument();
  });

  it("shows a graceful empty state when a submission has no messages", async () => {
    tickets = [
      conciergeTicket({ id: 5, ticketNumber: "CNC-005", status: "resolved", subject: "Concierge Task — Epsilon Offer" }),
    ];
    messagesByTicketId[5] = [];

    renderPage();

    const past = await screen.findByTestId("concierge-past-5");
    fireEvent.click(within(past).getByTestId("concierge-view-conversation-5"));

    const empty = await screen.findByTestId("conversation-empty");
    expect(empty).toHaveTextContent(/no messages/i);
  });
});
