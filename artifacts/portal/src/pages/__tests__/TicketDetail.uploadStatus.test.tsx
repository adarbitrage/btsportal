import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// The reply composer was changed so each staged attachment carries its OWN
// upload status (pending -> uploading -> uploaded/failed): a failed file can be
// retried or removed without re-uploading the ones that already succeeded, and
// the reply is held back while any file is still failed. This test pins that
// per-file flow so a future refactor (or a codegen regen) can't silently revert
// it to a single global error.
//
// Mocking follows the portal page-test pattern (see
// TicketDetail.deliveryBadge.test.tsx / TicketDetail.categoryLabel.test.tsx):
// stub AppLayout, wouter, @tanstack/react-query, and the generated
// @workspace/api-client-react hooks. The upload itself talks to object storage
// through the global `fetch` (presigned-URL request + PUT), so we stub `fetch`
// to make a single named file fail on demand and to record which files were
// actually PUT — that's how we prove a retry only re-uploads the failed file.

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
vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: (...args: unknown[]) => useGetTicket(...args),
  useAddTicketMessage: () => ({ mutate: addMessageMutate, isPending: false }),
  useResolveTicket: () => ({ mutate: vi.fn(), isPending: false }),
  getGetTicketQueryKey: (id: number) => ["/tickets", id],
  getListTicketsQueryKey: () => ["/tickets"],
}));

import TicketDetail from "@/pages/TicketDetail";

function makeTicket() {
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
  };
}

// Files whose object-storage PUT should fail. Mutable so a test can "fix" the
// upstream and prove a retry now succeeds.
const failingUploads = new Set<string>();
// Names of every file that was actually PUT to object storage, in call order.
const putUploads: string[] = [];

function pngFile(name: string) {
  return new File(["x".repeat(8)], name, { type: "image/png" });
}

function stageFiles(files: File[]) {
  fireEvent.change(screen.getByTestId("reply-file-input"), { target: { files } });
}

function typeReply(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Type your reply here..."), {
    target: { value: text },
  });
}

beforeEach(() => {
  failingUploads.clear();
  putUploads.length = 0;
  useGetTicket.mockReset();
  addMessageMutate.mockReset();
  invalidateQueries.mockReset();
  useGetTicket.mockReturnValue({ data: makeTicket(), isLoading: false });

  // Stub the two-step upload: request-url returns a presigned URL that encodes
  // the file name, then the PUT to that URL fails iff the name is in
  // `failingUploads`. Recording each PUT lets us assert per-file retry scope.
  global.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.includes("/storage/uploads/request-url")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { name: string };
      return {
        ok: true,
        json: async () => ({
          uploadURL: `https://storage.example/put?name=${encodeURIComponent(body.name)}`,
          objectPath: `/objects/${body.name}`,
        }),
      } as unknown as Response;
    }
    if (url.includes("storage.example/put")) {
      const name = decodeURIComponent(new URL(url).searchParams.get("name") ?? "");
      putUploads.push(name);
      return { ok: !failingUploads.has(name) } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — per-file upload status", () => {
  it("shows each staged file's own status and blocks the reply while one file is failed", async () => {
    failingUploads.add("broken.png");
    render(<TicketDetail />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    // Both files start out pending (their own status, not a global one).
    expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "pending");
    expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "pending");

    fireEvent.click(screen.getByTestId("reply-send-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "uploaded");
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed");
    });

    // The successful row reads "Uploaded"; the failed row reads "Failed" and
    // offers a retry — these are per-row, not a single global error.
    expect(screen.getByTestId("reply-file-status-0")).toHaveTextContent(/Uploaded/i);
    expect(screen.getByTestId("reply-file-status-1")).toHaveTextContent(/Failed/i);
    expect(screen.getByTestId("reply-file-retry-1")).toBeInTheDocument();
    expect(screen.getByTestId("reply-upload-failed")).toBeInTheDocument();

    // The failed row surfaces a concise, human-readable reason inline (not only
    // in a hover title) and exposes it to screen readers via role="alert".
    const reason = screen.getByTestId("reply-file-error-1");
    expect(reason).toBeInTheDocument();
    expect(reason).toHaveAttribute("role", "alert");
    expect(reason).toHaveTextContent(/storage rejected the file/i);
    // The successful row has no inline error.
    expect(screen.queryByTestId("reply-file-error-0")).not.toBeInTheDocument();

    // The reply must NOT be sent while a file is failed.
    expect(addMessageMutate).not.toHaveBeenCalled();
  });

  it("retries only the failed file, leaving the already-uploaded one untouched", async () => {
    failingUploads.add("broken.png");
    render(<TicketDetail />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    fireEvent.click(screen.getByTestId("reply-send-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed"),
    );

    // First send attempt PUT both files exactly once.
    expect(putUploads).toContain("good.png");
    expect(putUploads).toContain("broken.png");

    // Fix the upstream and retry only the failed row.
    failingUploads.clear();
    putUploads.length = 0;
    fireEvent.click(screen.getByTestId("reply-file-retry-1"));

    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploaded"),
    );

    // Retry re-uploaded ONLY the previously-failed file.
    expect(putUploads).toEqual(["broken.png"]);
    // The good file was never re-uploaded and stays uploaded.
    expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "uploaded");
  });

  it("sends the reply with all attachments once every file is uploaded, without re-uploading", async () => {
    failingUploads.add("broken.png");
    render(<TicketDetail />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    fireEvent.click(screen.getByTestId("reply-send-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed"),
    );
    expect(addMessageMutate).not.toHaveBeenCalled();

    // Fix + retry the failed file.
    failingUploads.clear();
    putUploads.length = 0;
    fireEvent.click(screen.getByTestId("reply-file-retry-1"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploaded"),
    );

    // Now every file is uploaded — sending must succeed and carry BOTH
    // attachments, and it must NOT re-upload anything already in storage.
    fireEvent.click(screen.getByTestId("reply-send-btn"));
    await waitFor(() => expect(addMessageMutate).toHaveBeenCalledTimes(1));

    const [payload] = addMessageMutate.mock.calls[0] as [
      { id: number; data: { body: string; attachments: Array<{ fileName: string }> } },
    ];
    expect(payload.id).toBe(42);
    expect(payload.data.body).toBe("Here are the files you asked for");
    expect(payload.data.attachments).toHaveLength(2);
    expect(payload.data.attachments.map((a) => a.fileName).sort()).toEqual([
      "broken.png",
      "good.png",
    ]);

    // Send re-uploaded nothing — the only PUT since the retry was the retry.
    expect(putUploads).toEqual(["broken.png"]);
  });
});
