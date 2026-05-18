import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getAdminTicket = vi.fn();
const getAdminTicketSla = vi.fn();
const getTicketAuditHistory = vi.fn();
const getTicketAssignees = vi.fn();
const getAdminTickets = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAdminTicket: (...args: unknown[]) => getAdminTicket(...args),
    getAdminTicketSla: (...args: unknown[]) => getAdminTicketSla(...args),
    getTicketAuditHistory: (...args: unknown[]) => getTicketAuditHistory(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
  },
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AdminTicketDetail from "@/pages/admin/AdminTicketDetail";

function makeTicket(overrides: Record<string, unknown> = {}) {
  // Minimum shape consumed by the page header. Anything the SLA / audit /
  // merge cards need is supplied by their own mocks below.
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Question about cancelled email change",
    source: null,
    sourceReferenceId: null,
    assignedTo: null,
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    member: { id: 7, name: "Casey Member", email: "casey@example.test" },
    assignee: null,
    tier: "standard",
    messages: [],
    ...overrides,
  };
}

beforeEach(() => {
  getAdminTicket.mockReset();
  getAdminTicketSla.mockReset().mockResolvedValue(null);
  getTicketAuditHistory.mockReset().mockResolvedValue({ auditHistory: [], limit: 20 });
  getTicketAssignees.mockReset().mockResolvedValue([]);
  getAdminTickets.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminTicketDetail — cancelled-email source badge", () => {
  it("renders the badge and a deep-link to the member when source is email_admin_cancelled_banner", async () => {
    getAdminTicket.mockResolvedValue(
      makeTicket({
        source: "email_admin_cancelled_banner",
        sourceReferenceId: 4242,
      }),
    );

    render(<AdminTicketDetail />);

    // Badge proves the tag survived the API round-trip and got rendered;
    // the link is what lets support jump straight to the member's account
    // page to see the cancelled email-change attempt that triggered the
    // ticket.
    const badge = await screen.findByTestId("ticket-source-badge");
    expect(badge.textContent).toMatch(/cancelled-email banner/i);

    const link = screen.getByTestId("ticket-source-link");
    expect(link).toHaveAttribute("href", "/admin/members/7");
    expect(link.textContent).toMatch(/attempt #4242/);
  });

  it("does NOT render the source banner for tickets opened through the generic support form", async () => {
    getAdminTicket.mockResolvedValue(makeTicket({ source: null, sourceReferenceId: null }));

    render(<AdminTicketDetail />);

    await waitFor(() => {
      expect(getAdminTicket).toHaveBeenCalled();
    });
    // Wait for the header to render so we know the page settled before we
    // assert the negative — otherwise the badge could simply be "not
    // rendered yet" rather than "intentionally absent".
    await screen.findByTestId("ticket-detail-header");
    expect(screen.queryByTestId("ticket-source-badge")).toBeNull();
    expect(screen.queryByTestId("ticket-source-link")).toBeNull();
  });
});
