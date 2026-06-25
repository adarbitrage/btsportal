import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// After the Compliance Review page was split into a landing (/compliance) and a
// separate intake form (/compliance/submit), a successful submit must: surface
// the reference number as a toast (a destructive variant when the confirmation
// email failed), refresh the landing's submissions list, and navigate the
// member back to /compliance — where the new ticket then appears under
// "Currently Under Review". This test pins that post-submit flow.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/compliance/submit", navigate],
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import ComplianceSubmit from "@/pages/ComplianceSubmit";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let confirmationEmailSent = true;

beforeEach(() => {
  navigate.mockClear();
  toast.mockClear();
  confirmationEmailSent = true;

  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/tickets/compliance")) {
      return jsonResponse({ ticketNumber: "CMP-042", confirmationEmailSent });
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
      <ComplianceSubmit />
    </QueryClientProvider>,
  );
}

// Fill the guided required selections (affiliate network, traffic source, and a
// creative category) so the form's submit guard passes. The creative checkboxes
// only render once network + traffic are chosen.
function fillGuidedFields() {
  fireEvent.click(screen.getByTestId("chip-network-ClickBank"));
  fireEvent.click(screen.getByTestId("chip-traffic-Grasshopper"));
  fireEvent.click(screen.getByTestId("checkbox-creative-Banner Images"));
}

// Dispatch the submit event directly (jsdom blocks the button click on unfilled
// HTML5 required text fields); the guided selections are filled first so the
// submit guard passes and the post-submit flow under test runs.
function submitForm() {
  fillGuidedFields();
  const form = document.querySelector("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
}

describe("ComplianceSubmit — successful submit", () => {
  it("toasts the reference and navigates back to /compliance", async () => {
    renderPage();
    submitForm();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/compliance"));
    expect(toast).toHaveBeenCalledTimes(1);
    const arg = toast.mock.calls[0][0];
    expect(arg.variant).toBeUndefined();
    expect(`${arg.description ?? ""}`).toContain("CMP-042");
  });

  it("uses a destructive toast when the confirmation email failed but still navigates back", async () => {
    confirmationEmailSent = false;

    renderPage();
    submitForm();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/compliance"));
    const arg = toast.mock.calls[0][0];
    expect(arg.variant).toBe("destructive");
    expect(`${arg.title ?? ""}`).toContain("CMP-042");
  });

  it("keeps the member on the form and surfaces the error when the submit request fails", async () => {
    global.fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/tickets/compliance")) {
        return new Response(JSON.stringify({ error: "Server is down" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    renderPage();
    submitForm();

    expect(await screen.findByText("Server is down")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
