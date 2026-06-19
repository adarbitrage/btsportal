import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Guards the inline image-attachment preview on the member ticket detail page.
// An image attachment (contentType image/*) must render a clickable thumbnail
// that opens the larger preview dialog; a non-image attachment must render the
// download link only (no thumbnail). Without this a refactor could silently
// revert the feature back to download-only links.
//
// Mocking mirrors TicketDetail.categoryLabel.test.tsx (AppLayout, wouter,
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

function makeTicket(attachments: Array<Record<string, unknown>>) {
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Help with my request",
    deliveryStatus: "delivered",
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    messages: [],
    attachments,
  };
}

beforeEach(() => {
  useGetTicket.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — image attachment preview", () => {
  it("renders a clickable thumbnail for an image attachment", () => {
    useGetTicket.mockReturnValue({
      data: makeTicket([
        { id: 101, fileName: "screenshot.png", fileSize: 2048, contentType: "image/png" },
      ]),
      isLoading: false,
    });

    render(<TicketDetail />);

    expect(screen.getByTestId("attachment-thumbnail-101")).toBeInTheDocument();
  });

  it("opens the preview dialog when the thumbnail is clicked", async () => {
    const user = userEvent.setup();
    useGetTicket.mockReturnValue({
      data: makeTicket([
        { id: 101, fileName: "screenshot.png", fileSize: 2048, contentType: "image/png" },
      ]),
      isLoading: false,
    });

    render(<TicketDetail />);

    // Dialog is closed until the thumbnail is clicked.
    expect(screen.queryByTestId("attachment-preview-dialog")).toBeNull();

    await user.click(screen.getByTestId("attachment-thumbnail-101"));

    expect(await screen.findByTestId("attachment-preview-dialog")).toBeInTheDocument();
  });

  it("renders only a download link (no thumbnail) for a non-image attachment", () => {
    useGetTicket.mockReturnValue({
      data: makeTicket([
        { id: 202, fileName: "report.pdf", fileSize: 4096, contentType: "application/pdf" },
      ]),
      isLoading: false,
    });

    render(<TicketDetail />);

    expect(screen.queryByTestId("attachment-thumbnail-202")).toBeNull();
    expect(screen.getByTestId("attachment-download-202")).toBeInTheDocument();
  });
});
