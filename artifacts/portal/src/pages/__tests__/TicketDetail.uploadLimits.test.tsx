import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// Task: lock in the ticket upload limits wiring. The shared validator
// (validateTicketAttachment in @workspace/support-config) has its own unit
// tests, but this pins the client-side guard in the reply composer: selecting
// an oversized or unsupported file must surface the error and must NOT add the
// file to the pending upload list (so it never reaches object storage). Without
// this, a refactor could silently drop the pre-upload filter while the
// validator's unit tests stayed green.
//
// Follows the page-test mocking pattern used across the portal (Plans.*,
// Account.*, TicketDetail.deliveryBadge): stub AppLayout, wouter,
// @tanstack/react-query, and the generated @workspace/api-client-react hooks.

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

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const useGetTicket = vi.fn();
const addMessageMutate = vi.fn();
const resolveTicketMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: (...args: unknown[]) => useGetTicket(...args),
  useAddTicketMessage: () => ({ mutate: addMessageMutate, isPending: false }),
  useResolveTicket: () => ({ mutate: resolveTicketMutate, isPending: false }),
  getGetTicketQueryKey: (id: number) => ["/tickets", id],
  getListTicketsQueryKey: () => ["/tickets"],
}));

import TicketDetail from "@/pages/TicketDetail";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@workspace/support-config";

function makeOpenTicket() {
  return {
    id: 42,
    ticketNumber: "BTS-000042",
    userId: 7,
    category: "other",
    priority: "normal" as const,
    status: "open" as const,
    subject: "Help with my account",
    deliveryStatus: "delivered",
    createdAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2026-05-01T12:00:00Z").toISOString(),
    resolvedAt: null,
    messages: [],
    attachments: [],
  };
}

// jsdom File reports the byte length of its content as `size`. To simulate a
// huge file without allocating 50MB, override `size` with a stubbed value.
function makeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function selectFiles(files: File[]) {
  const input = screen.getByTestId("reply-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  useGetTicket.mockReset();
  addMessageMutate.mockReset();
  invalidateQueries.mockReset();
  useGetTicket.mockReturnValue({ data: makeOpenTicket(), isLoading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — reply attachment upload limits", () => {
  it("rejects an oversized file: shows the error and does not stage it", () => {
    render(<TicketDetail />);

    selectFiles([
      makeFile("huge.png", "image/png", TICKET_ATTACHMENT_MAX_BYTES + 1),
    ]);

    const error = screen.getByTestId("reply-upload-error");
    expect(error).toHaveTextContent(/too large/i);
    // The oversized file never enters the pending upload list.
    expect(screen.queryByTestId("reply-files-list")).toBeNull();
  });

  it("rejects an unsupported content type: shows the error and does not stage it", () => {
    render(<TicketDetail />);

    selectFiles([makeFile("malware.exe", "application/x-msdownload", 1024)]);

    const error = screen.getByTestId("reply-upload-error");
    expect(error).toHaveTextContent(/can't be attached|allowed types/i);
    expect(screen.queryByTestId("reply-files-list")).toBeNull();
  });

  it("stages only the valid files when a batch mixes valid and invalid", () => {
    render(<TicketDetail />);

    selectFiles([
      makeFile("ok.pdf", "application/pdf", 2048),
      makeFile("bad.exe", "application/x-msdownload", 2048),
    ]);

    // The error names the rejected file...
    expect(screen.getByTestId("reply-upload-error")).toBeInTheDocument();
    // ...but the valid one is staged (exactly one pending row).
    const list = screen.getByTestId("reply-files-list");
    expect(list).toHaveTextContent("ok.pdf");
    expect(list).not.toHaveTextContent("bad.exe");
    expect(screen.getByTestId("reply-file-0")).toHaveTextContent("ok.pdf");
    expect(screen.queryByTestId("reply-file-1")).toBeNull();
  });

  it("stages a valid file with no error", () => {
    render(<TicketDetail />);

    selectFiles([makeFile("fine.pdf", "application/pdf", 2048)]);

    expect(screen.queryByTestId("reply-upload-error")).toBeNull();
    const list = screen.getByTestId("reply-files-list");
    expect(list).toHaveTextContent("fine.pdf");
  });
});
