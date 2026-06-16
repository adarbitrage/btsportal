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
    deliveryLastError: null,
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
  retryTicketDelivery.mockReset().mockResolvedValue({ success: true });
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

  describe("bulk assign / close actions", () => {
    const ASSIGNEES = [
      { id: 901, name: "Riley Agent", email: "riley@example.test" },
      { id: 902, name: "Sam Agent", email: "sam@example.test" },
    ];

    async function selectRows(...ids: number[]) {
      const user = userEvent.setup();
      for (const id of ids) {
        await user.click(screen.getByTestId(`bulk-select-row-${id}`));
      }
      // The action bar only mounts once at least one row is selected.
      await screen.findByTestId("bulk-action-bar");
    }

    it("bulk-assigns the selected tickets to the chosen agent", async () => {
      getTicketAssignees.mockResolvedValue(ASSIGNEES);
      render(<AdminTicketQueue />);
      await waitForAllRows();

      await selectRows(11, 12);

      const user = userEvent.setup();
      await user.click(screen.getByTestId("bulk-assign-trigger"));
      await user.click(await screen.findByRole("option", { name: /^Riley Agent$/ }));

      await waitFor(() => {
        expect(updateTicketAssignee).toHaveBeenCalledTimes(2);
      });
      const assignedIds = updateTicketAssignee.mock.calls.map((c) => c[0]).sort();
      expect(assignedIds).toEqual([11, 12]);
      updateTicketAssignee.mock.calls.forEach((c) => {
        expect(c[1]).toBe(901);
      });
      // Close should not have been triggered by an assign.
      expect(updateTicketStatus).not.toHaveBeenCalled();
    });

    it("bulk-closes the selected tickets", async () => {
      render(<AdminTicketQueue />);
      await waitForAllRows();

      await selectRows(11, 13);

      const user = userEvent.setup();
      await user.click(screen.getByTestId("bulk-close-button"));

      await waitFor(() => {
        expect(updateTicketStatus).toHaveBeenCalledTimes(2);
      });
      const closeCalls = updateTicketStatus.mock.calls;
      expect(closeCalls.map((c) => c[0]).sort()).toEqual([11, 13]);
      closeCalls.forEach((c) => {
        expect(c[1]).toBe("closed");
      });
      expect(updateTicketAssignee).not.toHaveBeenCalled();
    });

    it("bulk-retries delivery only for the failed/skipped tickets in the selection", async () => {
      // Mix of delivered (11), failed (12), skipped (13). The retry button
      // should only fire for the two undelivered rows, never the delivered one.
      getAdminTickets.mockResolvedValue([
        makeTicket({ id: 11, ticketNumber: "BTS-000011", deliveryStatus: "delivered" }),
        makeTicket({ id: 12, ticketNumber: "BTS-000012", deliveryStatus: "failed" }),
        makeTicket({ id: 13, ticketNumber: "BTS-000013", deliveryStatus: "skipped" }),
      ]);
      render(<AdminTicketQueue />);
      await waitForAllRows();

      await selectRows(11, 12, 13);

      const user = userEvent.setup();
      const retryButton = screen.getByTestId("bulk-retry-delivery-button");
      // The button label reflects only the undelivered count.
      expect(retryButton).toHaveTextContent("(2)");
      await user.click(retryButton);

      await waitFor(() => {
        expect(retryTicketDelivery).toHaveBeenCalledTimes(2);
      });
      const retriedIds = retryTicketDelivery.mock.calls.map((c) => c[0]).sort();
      expect(retriedIds).toEqual([12, 13]);
      // The delivered ticket was never retried, and no status/assignee writes fired.
      expect(retriedIds).not.toContain(11);
      expect(updateTicketStatus).not.toHaveBeenCalled();
      expect(updateTicketAssignee).not.toHaveBeenCalled();
    });

    it("keeps only the failed id selected when one bulk close rejects", async () => {
      // Closing 11 succeeds, closing 13 rejects. The failed id must stay
      // selected so the admin can retry; the successful one is cleared.
      updateTicketStatus.mockImplementation((id: number) =>
        id === 13
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({ success: true }),
      );
      render(<AdminTicketQueue />);
      await waitForAllRows();

      await selectRows(11, 13);

      const user = userEvent.setup();
      await user.click(screen.getByTestId("bulk-close-button"));

      await waitFor(() => {
        expect(updateTicketStatus).toHaveBeenCalledTimes(2);
      });

      // The action bar still shows exactly the failed id (1 selected),
      // and the failed row's checkbox stays checked while the successful
      // one is cleared.
      const bar = await screen.findByTestId("bulk-action-bar");
      await waitFor(() => {
        expect(within(bar).getByText(/1 selected/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId("bulk-select-row-13")).toBeChecked();
      expect(screen.getByTestId("bulk-select-row-11")).not.toBeChecked();
    });
  });

  describe("SLA filter", () => {
    const SLA_TICKETS: Ticket[] = [
      makeTicket({ id: 31, ticketNumber: "BTS-000031", slaStatus: "breached" }),
      makeTicket({ id: 32, ticketNumber: "BTS-000032", slaStatus: "approaching" }),
      makeTicket({ id: 33, ticketNumber: "BTS-000033", slaStatus: "within" }),
      makeTicket({ id: 34, ticketNumber: "BTS-000034", slaStatus: null }),
    ];

    async function waitForSlaRows() {
      await waitFor(() => {
        expect(screen.getAllByTestId("ticket-link")).toHaveLength(
          SLA_TICKETS.length,
        );
      });
    }

    it.each([
      ["Breached", /^Breached$/, "BTS-000031"],
      ["Approaching", /^Approaching$/, "BTS-000032"],
      ["Within", /^Within$/, "BTS-000033"],
    ] as const)(
      "narrows the visible rows to slaStatus=%s",
      async (_label, optionName, expectedNumber) => {
        getAdminTickets.mockResolvedValue(SLA_TICKETS);
        render(<AdminTicketQueue />);
        await waitForSlaRows();

        await pickFromSelect(/SLA/i, optionName);

        await waitFor(() => {
          expect(visibleTicketNumbers()).toEqual([expectedNumber]);
        });
      },
    );

    it("'No SLA' narrows to tickets with slaStatus == null", async () => {
      getAdminTickets.mockResolvedValue(SLA_TICKETS);
      render(<AdminTicketQueue />);
      await waitForSlaRows();

      await pickFromSelect(/SLA/i, /^No SLA$/);

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000034"]);
      });
    });
  });

  describe("Tier filter", () => {
    const TIER_TICKETS: Ticket[] = [
      makeTicket({ id: 41, ticketNumber: "BTS-000041", tier: "lifetime" }),
      makeTicket({ id: 42, ticketNumber: "BTS-000042", tier: "free" }),
      makeTicket({ id: 43, ticketNumber: "BTS-000043", tier: null }),
    ];

    async function waitForTierRows() {
      await waitFor(() => {
        expect(screen.getAllByTestId("ticket-link")).toHaveLength(
          TIER_TICKETS.length,
        );
      });
    }

    it.each([
      ["Lifetime", /^Lifetime$/, "BTS-000041"],
      ["Free", /^Free$/, "BTS-000042"],
    ] as const)(
      "narrows the visible rows to tier=%s",
      async (_label, optionName, expectedNumber) => {
        getAdminTickets.mockResolvedValue(TIER_TICKETS);
        render(<AdminTicketQueue />);
        await waitForTierRows();

        await pickFromSelect(/Tier/i, optionName);

        await waitFor(() => {
          expect(visibleTicketNumbers()).toEqual([expectedNumber]);
        });
      },
    );

    it("'No tier' narrows to tickets with tier == null", async () => {
      getAdminTickets.mockResolvedValue(TIER_TICKETS);
      render(<AdminTicketQueue />);
      await waitForTierRows();

      await pickFromSelect(/Tier/i, /^No tier$/);

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000043"]);
      });
    });
  });

  describe("delivery-failure badge + filter", () => {
    const DELIVERY_TICKETS: Ticket[] = [
      makeTicket({ id: 21, ticketNumber: "BTS-000021", deliveryStatus: "failed" }),
      makeTicket({ id: 22, ticketNumber: "BTS-000022", deliveryStatus: "skipped" }),
      makeTicket({ id: 23, ticketNumber: "BTS-000023", deliveryStatus: "delivered" }),
      makeTicket({ id: 24, ticketNumber: "BTS-000024", deliveryStatus: "pending" }),
    ];

    async function waitForDeliveryRows() {
      await waitFor(() => {
        expect(screen.getAllByTestId("ticket-link")).toHaveLength(
          DELIVERY_TICKETS.length,
        );
      });
    }

    function rowByNumber(ticketNumber: string): HTMLElement {
      const row = screen
        .getAllByTestId("ticket-link")
        .find((link) => within(link).queryByText(ticketNumber));
      if (!row) throw new Error(`No row for ${ticketNumber}`);
      return row;
    }

    it("renders the badge only for failed/skipped, with the matching status", async () => {
      getAdminTickets.mockResolvedValue(DELIVERY_TICKETS);
      render(<AdminTicketQueue />);
      await waitForDeliveryRows();

      // Only the failed + skipped rows surface a badge.
      const badges = screen.getAllByTestId("queue-delivery-badge");
      expect(badges).toHaveLength(2);
      expect(
        badges.map((b) => b.getAttribute("data-delivery-status")).sort(),
      ).toEqual(["failed", "skipped"]);

      // …and each badge is attached to the correct row.
      expect(
        within(rowByNumber("BTS-000021")).getByTestId("queue-delivery-badge"),
      ).toHaveAttribute("data-delivery-status", "failed");
      expect(
        within(rowByNumber("BTS-000022")).getByTestId("queue-delivery-badge"),
      ).toHaveAttribute("data-delivery-status", "skipped");
      expect(
        within(rowByNumber("BTS-000023")).queryByTestId("queue-delivery-badge"),
      ).toBeNull();
      expect(
        within(rowByNumber("BTS-000024")).queryByTestId("queue-delivery-badge"),
      ).toBeNull();
    });

    it("the Delivery filter narrows the visible rows to the chosen status", async () => {
      getAdminTickets.mockResolvedValue(DELIVERY_TICKETS);
      render(<AdminTicketQueue />);
      await waitForDeliveryRows();

      const user = userEvent.setup();
      await user.click(screen.getByTestId("delivery-filter"));
      await user.click(await screen.findByRole("option", { name: /^Failed$/ }));

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000021"]);
      });

      // Switching the filter re-narrows to the other status.
      await user.click(screen.getByTestId("delivery-filter"));
      await user.click(await screen.findByRole("option", { name: /^Skipped$/ }));

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000022"]);
      });
    });
  });

  describe("free-text search box", () => {
    function searchInput(): HTMLElement {
      return screen.getByPlaceholderText("Search tickets...");
    }

    it("narrows rows by matching subject text", async () => {
      render(<AdminTicketQueue />);
      await waitForAllRows();

      const user = userEvent.setup();
      await user.type(searchInput(), "refund");

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000012"]);
      });
    });

    it("narrows rows by matching ticket number", async () => {
      render(<AdminTicketQueue />);
      await waitForAllRows();

      const user = userEvent.setup();
      await user.type(searchInput(), "BTS-000013");

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000013"]);
      });
    });

    it("narrows rows by matching member name", async () => {
      render(<AdminTicketQueue />);
      await waitForAllRows();

      const user = userEvent.setup();
      await user.type(searchInput(), "alice");

      await waitFor(() => {
        expect(visibleTicketNumbers()).toEqual(["BTS-000011"]);
      });
    });

    it("shows zero rows for a non-matching query", async () => {
      render(<AdminTicketQueue />);
      await waitForAllRows();

      const user = userEvent.setup();
      await user.type(searchInput(), "zzz-no-such-ticket");

      await waitFor(() => {
        expect(screen.queryAllByTestId("ticket-link")).toHaveLength(0);
      });
    });
  });
});
