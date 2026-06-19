import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Guards the inline image-attachment preview on the admin ticket detail page.
// An image attachment (contentType image/*) must render a clickable thumbnail
// that opens the larger preview dialog; a non-image attachment must render the
// download link only (no thumbnail). Mirrors the member-side
// TicketDetail.attachmentPreview test so a refactor can't silently revert
// either surface back to download-only links.
//
// Mocking mirrors AdminTicketDetail.sourceBadge.test.tsx (AdminLayout, wouter,
// admin-panel-api), plus a getTicketAttachments mock to feed the list.

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
const getTicketAttachments = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getAdminTicket: (...args: unknown[]) => getAdminTicket(...args),
    getAdminTicketSla: (...args: unknown[]) => getAdminTicketSla(...args),
    getTicketAuditHistory: (...args: unknown[]) => getTicketAuditHistory(...args),
    getTicketAssignees: (...args: unknown[]) => getTicketAssignees(...args),
    getAdminTickets: (...args: unknown[]) => getAdminTickets(...args),
    getTicketAttachments: (...args: unknown[]) => getTicketAttachments(...args),
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
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Question with an attachment",
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
  getAdminTicket.mockReset().mockResolvedValue(makeTicket());
  getAdminTicketSla.mockReset().mockResolvedValue(null);
  getTicketAuditHistory.mockReset().mockResolvedValue({ auditHistory: [], limit: 20 });
  getTicketAssignees.mockReset().mockResolvedValue([]);
  getAdminTickets.mockReset().mockResolvedValue([]);
  getTicketAttachments.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminTicketDetail — image attachment preview", () => {
  it("renders a clickable thumbnail for an image attachment", async () => {
    getTicketAttachments.mockResolvedValue([
      { id: 101, objectPath: "/objects/screenshot.png", fileName: "screenshot.png", fileSize: 2048, contentType: "image/png" },
    ]);

    render(<AdminTicketDetail />);

    expect(await screen.findByTestId("attachment-thumbnail-101")).toBeInTheDocument();
  });

  it("opens the preview dialog when the thumbnail is clicked", async () => {
    const user = userEvent.setup();
    getTicketAttachments.mockResolvedValue([
      { id: 101, objectPath: "/objects/screenshot.png", fileName: "screenshot.png", fileSize: 2048, contentType: "image/png" },
    ]);

    render(<AdminTicketDetail />);

    const thumbnail = await screen.findByTestId("attachment-thumbnail-101");
    // Dialog is closed until the thumbnail is clicked.
    expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull();

    await user.click(thumbnail);

    expect(await screen.findByTestId("attachment-preview-dialog")).toBeInTheDocument();
  });

  it("renders only a download link (no thumbnail) for a non-image attachment", async () => {
    getTicketAttachments.mockResolvedValue([
      { id: 202, objectPath: "/objects/report.pdf", fileName: "report.pdf", fileSize: 4096, contentType: "application/pdf" },
    ]);

    render(<AdminTicketDetail />);

    expect(await screen.findByTestId("attachment-download-202")).toBeInTheDocument();
    expect(screen.queryByTestId("attachment-thumbnail-202")).toBeNull();
  });
});
