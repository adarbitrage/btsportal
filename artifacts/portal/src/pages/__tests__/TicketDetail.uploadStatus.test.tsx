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
// Determinism note: uploads start eagerly the moment a file is attached, so the
// transient "pending" state is batched away before React paints and is
// intentionally unobservable from a test (see the "pending is unobservable"
// case below). To observe every OTHER transition without racing the eager
// upload, TicketDetail accepts a `uploadFile` seam (defaulting to the real
// presigned-upload flow). We inject a controllable version whose per-file
// promise we resolve/reject on demand: that lets us pin the "uploading" state
// while the promise is in flight and then drive it to uploaded/failed exactly
// when we choose — no timing races, no `fetch` stubbing.
//
// Mocking otherwise follows the portal page-test pattern (see
// TicketDetail.deliveryBadge.test.tsx / TicketDetail.categoryLabel.test.tsx):
// stub AppLayout, wouter, @tanstack/react-query, and the generated
// @workspace/api-client-react hooks.

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

type AttachmentMeta = {
  objectPath: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

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

// A controllable upload seam. Each call records the file name (so we can prove a
// retry only re-uploads the failed file) and parks a deferred promise that the
// test settles explicitly — never on a timer. While a file's promise is
// unsettled its row sits in "uploading", which is exactly the state we want to
// be able to assert deterministically.
function createControllableUpload() {
  const calls: string[] = [];
  const pending: Array<{
    name: string;
    resolve: (meta: AttachmentMeta) => void;
    reject: (err: Error) => void;
  }> = [];

  const uploadFile = (file: File): Promise<AttachmentMeta> => {
    calls.push(file.name);
    return new Promise<AttachmentMeta>((resolve, reject) => {
      pending.push({ name: file.name, resolve, reject });
    });
  };

  const take = (name: string) => {
    const idx = pending.findIndex((p) => p.name === name);
    if (idx === -1) throw new Error(`no in-flight upload for ${name}`);
    return pending.splice(idx, 1)[0];
  };

  const succeed = (name: string) =>
    take(name).resolve({
      objectPath: `/objects/${name}`,
      fileName: name,
      fileSize: 8,
      contentType: "image/png",
    });

  const fail = (name: string) =>
    take(name).reject(new Error("Storage rejected the file (error 500). Retry in a moment."));

  return { uploadFile, calls, succeed, fail };
}

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
  useGetTicket.mockReset();
  addMessageMutate.mockReset();
  invalidateQueries.mockReset();
  useGetTicket.mockReturnValue({ data: makeTicket(), isLoading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetail — per-file upload status", () => {
  it("holds each file in 'uploading' until its own upload settles, then shows its own end state", async () => {
    const upload = createControllableUpload();
    render(<TicketDetail uploadFile={upload.uploadFile} />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    // Each file is staged as its OWN row carrying its OWN status. The eager
    // on-attach upload flips both rows straight to "uploading"; because our seam
    // returns an unsettled promise, that state is now stable and assertable
    // (the transient "pending" state is covered separately below).
    expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "uploading");
    expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploading");
    expect(upload.calls).toEqual(["good.png", "broken.png"]);

    // Settle each upload independently and watch the rows diverge.
    upload.succeed("good.png");
    upload.fail("broken.png");

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

    // The reply must NOT be sent while a file is failed: clicking Send re-tries
    // the failed file but holds the message back.
    fireEvent.click(screen.getByTestId("reply-send-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploading"),
    );
    upload.fail("broken.png");
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed"),
    );
    expect(addMessageMutate).not.toHaveBeenCalled();
  });

  it("retries only the failed file, leaving the already-uploaded one untouched", async () => {
    const upload = createControllableUpload();
    render(<TicketDetail uploadFile={upload.uploadFile} />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    // Eager on-attach upload PUT both files exactly once, in order.
    expect(upload.calls).toEqual(["good.png", "broken.png"]);
    upload.succeed("good.png");
    upload.fail("broken.png");
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed"),
    );

    // Retry only the failed row.
    upload.calls.length = 0;
    fireEvent.click(screen.getByTestId("reply-file-retry-1"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploading"),
    );
    upload.succeed("broken.png");
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploaded"),
    );

    // Retry re-uploaded ONLY the previously-failed file.
    expect(upload.calls).toEqual(["broken.png"]);
    // The good file was never re-uploaded and stays uploaded.
    expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "uploaded");
  });

  it("sends the reply with all attachments once every file is uploaded, without re-uploading", async () => {
    const upload = createControllableUpload();
    render(<TicketDetail uploadFile={upload.uploadFile} />);

    typeReply("Here are the files you asked for");
    stageFiles([pngFile("good.png"), pngFile("broken.png")]);

    upload.succeed("good.png");
    upload.fail("broken.png");
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "failed"),
    );
    expect(addMessageMutate).not.toHaveBeenCalled();

    // Fix + retry the failed file.
    upload.calls.length = 0;
    fireEvent.click(screen.getByTestId("reply-file-retry-1"));
    await waitFor(() =>
      expect(screen.getByTestId("reply-file-1")).toHaveAttribute("data-status", "uploading"),
    );
    upload.succeed("broken.png");
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
    expect(upload.calls).toEqual(["broken.png"]);
  });

  it("documents that the transient 'pending' state is intentionally unobservable", async () => {
    // Uploads start eagerly inside addFiles: the row is staged as "pending" and
    // startUpload synchronously flips it to "uploading" in the same React batch,
    // so "pending" never paints. We pin that contract here: even with a seam
    // that never settles, the freshly staged row is already "uploading", never
    // "pending". If a future refactor defers the upload start (making "pending"
    // observable), update this expectation and the note at the top of the file.
    const upload = createControllableUpload();
    render(<TicketDetail uploadFile={upload.uploadFile} />);

    typeReply("Here you go");
    stageFiles([pngFile("only.png")]);

    expect(screen.getByTestId("reply-file-0")).toHaveAttribute("data-status", "uploading");
    expect(screen.getByTestId("reply-file-0")).not.toHaveAttribute("data-status", "pending");
  });
});
