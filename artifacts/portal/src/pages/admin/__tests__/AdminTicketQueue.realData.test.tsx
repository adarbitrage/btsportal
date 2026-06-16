import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    updateTicketStatus: (...args: unknown[]) => updateTicketStatus(...args),
    updateTicketAssignee: (...args: unknown[]) => updateTicketAssignee(...args),
  },
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href} data-testid="ticket-link">
      {children}
    </a>
  ),
}));

import AdminTicketQueue from "@/pages/admin/AdminTicketQueue";

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
    member: { id: 100, name: "Default Member", email: "default@example.test" },
    assignee: null,
    tier: null,
    slaStatus: null,
    ...overrides,
  };
}

type Ticket = Awaited<ReturnType<typeof import("@/lib/admin-panel-api").adminPanelApi.getAdminTickets>>[number];

const TICKETS: Ticket[] = [
  makeTicket({
    id: 11,
    ticketNumber: "BTS-000011",
    subject: "Cannot log in",
    priority: "urgent",
    status: "open",
    category: "account",
    member: { id: 11, name: "Alice Apple", email: "alice@example.test" },
    assignee: { id: 901, name: "Riley Agent", email: "riley@example.test" },
    assignedTo: 901,
  }),
  makeTicket({
    id: 12,
    ticketNumber: "BTS-000012",
    subject: "Refund request",
    priority: "high",
    status: "in_progress",
    category: "billing",
    member: { id: 12, name: "Bob Banana", email: "bob@example.test" },
    assignee: null,
  }),
  makeTicket({
    id: 13,
    ticketNumber: "BTS-000013",
    subject: "Feature suggestion",
    priority: "low",
    status: "resolved",
    category: "feedback",
    member: { id: 13, name: "Carol Cherry", email: "carol@example.test" },
    assignee: { id: 902, name: "Sam Agent", email: "sam@example.test" },
    assignedTo: 902,
  }),
];

beforeEach(() => {
  getAdminTickets.mockReset().mockResolvedValue(TICKETS);
  getTicketAssignees.mockReset().mockResolvedValue([]);
  updateTicketStatus.mockReset().mockResolvedValue({ success: true });
  updateTicketAssignee.mockReset().mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitForAllRows() {
  await waitFor(() => {
    expect(screen.getAllByTestId("ticket-link")).toHaveLength(TICKETS.length);
  });
}

function visibleTicketNumbers(): string[] {
  return screen
    .getAllByTestId("ticket-link")
    .map((link) => within(link).getByText(/^BTS-\d+$/).textContent ?? "");
}

async function pickFromSelect(triggerName: RegExp, optionName: RegExp) {
  const user = userEvent.setup();
  const triggers = screen.getAllByRole("combobox");
  // Match the trigger by its current value text. The placeholder uses
  // `name="status"` etc on the SelectTrigger, but Radix exposes it as a
  // combobox; we filter by the visible text instead.
  const trigger = triggers.find((t) => triggerName.test(t.textContent ?? ""));
  if (!trigger) throw new Error(`No trigger matching ${triggerName}`);
  await user.click(trigger);
  const option = await screen.findByRole("option", { name: optionName });
  await user.click(option);
}

describe("AdminTicketQueue — real-data wiring", () => {
  it("source file does not import mockTickets from admin-mock-data", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "AdminTicketQueue.tsx"),
      "utf8",
    );
    // Guards against a silent revert to the demo data fixture.
    expect(src).not.toMatch(/admin-mock-data/);
    expect(src).not.toMatch(/mockTickets/);
  });

  it("renders one row per ticket from the API with number, subject, member, and assignee/Unassigned", async () => {
    render(<AdminTicketQueue />);

    await waitForAllRows();
    expect(getAdminTickets).toHaveBeenCalledTimes(1);

    const links = screen.getAllByTestId("ticket-link");
    // Sorted by priority: urgent (11), high (12), low (13).
    const expected = [TICKETS[0], TICKETS[1], TICKETS[2]];
    expected.forEach((ticket, idx) => {
      const row = links[idx];
      const scope = within(row);
      expect(scope.getByText(ticket.ticketNumber)).toBeInTheDocument();
      expect(scope.getByText(ticket.subject)).toBeInTheDocument();
      expect(scope.getByText(new RegExp(ticket.member!.name))).toBeInTheDocument();
      if (ticket.assignee) {
        expect(scope.getByText(ticket.assignee.name)).toBeInTheDocument();
      } else {
        expect(scope.getByText(/Unassigned/i)).toBeInTheDocument();
      }
    });
  });

  it("each row links to /admin/tickets/:id", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    const hrefs = screen
      .getAllByTestId("ticket-link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/admin/tickets/11",
      "/admin/tickets/12",
      "/admin/tickets/13",
    ]);
  });

  it("status filter narrows the visible rows", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await pickFromSelect(/Status/i, /^In Progress$/i);

    await waitFor(() => {
      expect(visibleTicketNumbers()).toEqual(["BTS-000012"]);
    });
  });

  it("priority filter narrows the visible rows", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await pickFromSelect(/Priorit/i, /^Urgent$/i);

    await waitFor(() => {
      expect(visibleTicketNumbers()).toEqual(["BTS-000011"]);
    });
  });

  it("category filter narrows the visible rows", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await pickFromSelect(/Categor/i, /^feedback$/i);

    await waitFor(() => {
      expect(visibleTicketNumbers()).toEqual(["BTS-000013"]);
    });
  });

  it("agent filter narrows to a specific assignee", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await pickFromSelect(/Agent/i, /^Sam Agent$/);

    await waitFor(() => {
      expect(visibleTicketNumbers()).toEqual(["BTS-000013"]);
    });
  });

  it("agent filter 'Unassigned' narrows to tickets with no assignee", async () => {
    render(<AdminTicketQueue />);
    await waitForAllRows();

    await pickFromSelect(/Agent/i, /^Unassigned$/);

    await waitFor(() => {
      expect(visibleTicketNumbers()).toEqual(["BTS-000012"]);
    });
  });
});
