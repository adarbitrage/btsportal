import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Concierge page surfaces the member's prior submissions (which are support
// tickets of category `concierge_task`) as two status sections above the intake
// form: "Current Submissions" (active tickets) and "Past Submissions"
// (resolved/closed). This mirrors the Compliance Review landing page. This test
// pins that split, the action-needed escalation on `awaiting_response`, the
// thread deep-link, and the View Details dialog that reveals the team's reply.
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

  it("splits active submissions into Current and resolved into Past Submissions", async () => {
    tickets = [
      conciergeTicket({ id: 1, ticketNumber: "CNC-001", status: "in_progress", subject: "Concierge Task — Alpha Offer" }),
      conciergeTicket({ id: 2, ticketNumber: "CNC-002", status: "resolved", subject: "Concierge Task — Beta Offer" }),
    ];

    renderPage();

    const active = await screen.findByTestId("concierge-active-1");
    expect(within(active).getByText("Alpha Offer")).toBeInTheDocument();
    // Default active CTA is the quiet "View Request" linking to the thread.
    const viewSubmission = within(active).getByTestId("concierge-view-submission-1");
    expect(viewSubmission).toHaveTextContent("View Request");
    expect(viewSubmission.closest("a")).toHaveAttribute("href", "/support/tickets/1");
    // No action-needed banner for a plain in_progress ticket.
    expect(screen.queryByTestId("concierge-action-needed-1")).not.toBeInTheDocument();

    const past = screen.getByTestId("concierge-past-2");
    expect(within(past).getByText("Beta Offer")).toBeInTheDocument();
    expect(within(past).getByText("Complete")).toBeInTheDocument();
  });

  it("escalates an awaiting_response submission with a banner and View & Reply CTA", async () => {
    tickets = [
      conciergeTicket({ id: 3, ticketNumber: "CNC-003", status: "awaiting_response", subject: "Concierge Task — Gamma Offer" }),
    ];

    renderPage();

    const banner = await screen.findByTestId("concierge-action-needed-3");
    expect(banner).toHaveTextContent(/action needed/i);
    const cta = screen.getByTestId("concierge-view-submission-3");
    expect(cta).toHaveTextContent("View & Reply");
    expect(cta.closest("a")).toHaveAttribute("href", "/support/tickets/3");
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

  it("shows the team's reply newest-first in the View Details dialog", async () => {
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
    fireEvent.click(within(past).getByTestId("concierge-view-details-4"));

    // The newest admin reply renders first and is labelled "Latest".
    const latest = await screen.findByTestId("concierge-detail-102");
    expect(latest).toHaveTextContent("All done");
    expect(within(latest).getByText("Latest")).toBeInTheDocument();

    expect(screen.getByTestId("concierge-detail-101")).toHaveTextContent("First update note");
    // The member's own message and the internal note are excluded.
    expect(screen.queryByTestId("concierge-detail-100")).not.toBeInTheDocument();
    expect(screen.queryByTestId("concierge-detail-103")).not.toBeInTheDocument();
  });

  it("shows a graceful fallback when a completed submission has no written reply", async () => {
    tickets = [
      conciergeTicket({ id: 5, ticketNumber: "CNC-005", status: "resolved", subject: "Concierge Task — Epsilon Offer" }),
    ];
    messagesByTicketId[5] = [
      { id: 200, senderType: "member", body: "My request", createdAt: "2026-06-01T00:00:00.000Z" },
    ];

    renderPage();

    const past = await screen.findByTestId("concierge-past-5");
    fireEvent.click(within(past).getByTestId("concierge-view-details-5"));

    const empty = await screen.findByTestId("concierge-details-empty");
    expect(empty).toHaveTextContent(/no written response/i);
  });
});
