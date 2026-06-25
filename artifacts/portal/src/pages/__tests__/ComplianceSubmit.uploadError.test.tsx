import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Compliance Review intake form (now its own page at /compliance/submit)
// uploads each selected file to object storage via a presigned URL before
// creating the ticket. When an upload fails it renders a per-file,
// screen-reader-accessible reason (data-testid "compliance-file-error-<i>",
// role="alert", with an sr-only "Upload failed: " prefix) AND distinguishes a
// network error from a storage rejection — the two wordings produced by
// uploadFileToStorage. This test pins that behaviour so a future refactor of the
// upload flow can't silently regress it.
//
// Mocking follows the portal page-test pattern (see
// TicketDetail.uploadStatus.test.tsx): stub AppLayout and drive the two-step
// upload (request-url POST + storage PUT) through a stubbed global `fetch` so a
// named file can fail in a specific way on demand.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

import ComplianceSubmit from "@/pages/ComplianceSubmit";

// The form page uses react-query (useQueryClient, to refresh the landing's
// submissions list after a successful submit), so every render needs a
// QueryClient. The upload flow under test runs through the stubbed global fetch
// below and never reaches a successful submit, so the client is only needed for
// the hook to resolve.
function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComplianceSubmit />
    </QueryClientProvider>,
  );
}

// File names whose request-url POST should throw (simulating "couldn't reach the
// server" — a network error before storage is even contacted).
const requestUrlNetworkError = new Set<string>();
// File names whose storage PUT should return a non-OK status (the server/object
// store rejected the file).
const putRejected = new Map<string, number>();

function zipFile(name: string) {
  return new File(["x".repeat(8)], name, { type: "application/zip" });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  return input as HTMLInputElement;
}

function selectFiles(files: File[]) {
  fireEvent.change(fileInput(), { target: { files } });
}

// Fill the guided required selections (affiliate network, traffic source, and a
// creative category) so the form's submit guard passes and the per-file upload
// path under test runs. The creative checkboxes only render once network +
// traffic are chosen.
function fillGuidedFields() {
  fireEvent.click(screen.getByTestId("chip-network-ClickBank"));
  fireEvent.click(screen.getByTestId("chip-traffic-Grasshopper"));
  fireEvent.click(screen.getByTestId("checkbox-creative-Banner Images"));
}

// Submit the form directly. Clicking the submit button is blocked by jsdom's
// HTML5 constraint validation (unfilled required text fields); the guided
// selections are filled first so the submit guard passes and the per-file upload
// path under test runs.
function submitForm() {
  fillGuidedFields();
  const form = document.querySelector("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

beforeEach(() => {
  requestUrlNetworkError.clear();
  putRejected.clear();

  global.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.includes("/storage/uploads/request-url")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { name: string };
      if (requestUrlNetworkError.has(body.name)) {
        // A thrown fetch is how the browser surfaces an unreachable server.
        throw new TypeError("Failed to fetch");
      }
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
      const status = putRejected.get(name);
      if (status !== undefined) {
        return { ok: false, status } as unknown as Response;
      }
      return { ok: true } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ComplianceSubmit — per-file upload error display", () => {
  it("renders an accessible, network-vs-storage-distinct inline error for each failed file", async () => {
    // File 0 fails before reaching storage (network), file 1 is rejected by
    // storage with a 500 — two distinct wordings from uploadFileToStorage.
    requestUrlNetworkError.add("network.zip");
    putRejected.set("storage.zip", 500);

    renderPage();
    selectFiles([zipFile("network.zip"), zipFile("storage.zip")]);

    submitForm();

    const networkError = await screen.findByTestId("compliance-file-error-0");
    const storageError = await screen.findByTestId("compliance-file-error-1");

    // Both are exposed to screen readers via role="alert" and carry the sr-only
    // "Upload failed: " prefix.
    expect(networkError).toHaveAttribute("role", "alert");
    expect(storageError).toHaveAttribute("role", "alert");
    expect(within(networkError).getByText("Upload failed:")).toHaveClass("sr-only");
    expect(within(storageError).getByText("Upload failed:")).toHaveClass("sr-only");

    // The two wordings are distinct: network error vs storage rejection.
    expect(networkError).toHaveTextContent(/network error.*couldn't reach the server/i);
    expect(networkError).not.toHaveTextContent(/storage rejected/i);
    expect(storageError).toHaveTextContent(/storage rejected the file \(error 500\)/i);
    expect(storageError).not.toHaveTextContent(/couldn't reach the server/i);
  });

  it("distinguishes a mid-upload network drop from a storage rejection", async () => {
    // The PUT itself throwing (connection dropped mid-upload) reads differently
    // from a non-OK PUT response (storage rejected the file).
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
        if (name === "drop.zip") throw new TypeError("Failed to fetch");
        return { ok: false, status: 403 } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage();
    selectFiles([zipFile("drop.zip"), zipFile("reject.zip")]);

    submitForm();

    const dropError = await screen.findByTestId("compliance-file-error-0");
    const rejectError = await screen.findByTestId("compliance-file-error-1");

    expect(dropError).toHaveTextContent(/network error during upload/i);
    expect(rejectError).toHaveTextContent(/storage rejected the file \(error 403\)/i);
  });

  it("clears the per-file errors when files are removed", async () => {
    requestUrlNetworkError.add("network.zip");

    renderPage();
    selectFiles([zipFile("network.zip")]);

    submitForm();
    expect(await screen.findByTestId("compliance-file-error-0")).toBeInTheDocument();

    // Removing the file drops the stale per-file error.
    fireEvent.click(screen.getByLabelText("Remove network.zip"));
    await waitFor(() =>
      expect(screen.queryByTestId("compliance-file-error-0")).not.toBeInTheDocument(),
    );
  });

  it("clears the per-file errors when files are reselected", async () => {
    requestUrlNetworkError.add("network.zip");

    renderPage();
    selectFiles([zipFile("network.zip")]);

    submitForm();
    expect(await screen.findByTestId("compliance-file-error-0")).toBeInTheDocument();

    // Reselecting a fresh set of files resets the per-file errors.
    selectFiles([zipFile("fresh.zip")]);
    await waitFor(() =>
      expect(screen.queryByTestId("compliance-file-error-0")).not.toBeInTheDocument(),
    );
  });
});
