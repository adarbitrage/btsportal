import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/layout/PackCoachingAdminLayout", () => ({
  PackCoachingAdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="pack-coaching-admin-layout-stub">{children}</div>
  ),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import CoachingCalls from "@/pages/admin/CoachingCalls";

// ---------------------------------------------------------------------------
// In-memory fake of the admin coaching-calls API, focused on the quick
// "reassign this one call to another coach" affordance: it must send ONLY the
// coachId via PATCH (a partial update) and leave every other field untouched.
// ---------------------------------------------------------------------------
interface ServerCall {
  id: number;
  title: string;
  description: string;
  callType: string;
  coachId: number;
  coachName: string;
  meetLink: string | null;
  scheduledAt: string;
  durationMinutes: number;
  requiredEntitlement: string;
  recordingUrl: string | null;
  registeredCount: number;
  templateId: number | null;
}

const COACHES = [
  { id: 7, name: "Sasha Coach" },
  { id: 9, name: "Bruce Coach" },
];

let calls: ServerCall[];
const patchBodies: Array<Record<string, unknown>> = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function findCoachName(coachId: number): string {
  return COACHES.find((c) => c.id === coachId)?.name ?? "Unknown";
}

function fakeFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = (options?.method ?? "GET").toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, "");

  if (path === "/api/admin/coaching/calls/coaches" && method === "GET") {
    return Promise.resolve(jsonResponse({ coaches: COACHES }));
  }
  if (path === "/api/admin/coaching/calls/templates" && method === "GET") {
    return Promise.resolve(jsonResponse({ templates: [] }));
  }
  if (path === "/api/admin/coaching/calls" && method === "GET") {
    return Promise.resolve(jsonResponse({ calls }));
  }

  const idMatch = path.match(/^\/api\/admin\/coaching\/calls\/(\d+)$/);
  if (idMatch && method === "PATCH") {
    const id = Number(idMatch[1]);
    const body = JSON.parse(String(options?.body ?? "{}"));
    patchBodies.push(body);
    calls = calls.map((c) =>
      c.id === id
        ? {
            ...c,
            ...body,
            coachName: body.coachId ? findCoachName(body.coachId) : c.coachName,
          }
        : c,
    );
    return Promise.resolve(jsonResponse(calls.find((c) => c.id === id)));
  }

  return Promise.resolve(jsonResponse({ error: `Unhandled ${method} ${path}` }, 500));
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachingCalls />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [
    {
      id: 100,
      title: "Weekly Q&A Session",
      description: "",
      callType: "weekly_qa",
      coachId: 7,
      coachName: "Sasha Coach",
      meetLink: "https://meet.google.com/aaa-bbbb-ccc",
      scheduledAt: "2026-07-01T14:30:00.000Z",
      durationMinutes: 60,
      requiredEntitlement: "coaching:group",
      recordingUrl: null,
      registeredCount: 0,
      templateId: 5,
    },
  ];
  patchBodies.length = 0;
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls quick reassign", () => {
  it("moves a single call to another coach via a coachId-only PATCH", async () => {
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId("call-100");
    expect(within(card).getByText(/Sasha Coach/)).toBeInTheDocument();

    // Open the per-call reassign menu and pick a different coach.
    await user.click(screen.getByTestId("reassign-call-100"));
    await user.click(await screen.findByTestId("reassign-call-100-coach-9"));

    // The list reflects the new coach.
    await waitFor(() =>
      expect(within(screen.getByTestId("call-100")).getByText(/Bruce Coach/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Call reassigned" }),
      ),
    );

    // Only coachId was sent — no other fields disturbed.
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]).toEqual({ coachId: 9 });
  });

  it("does not PATCH when the call's current coach is chosen", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("call-100");
    await user.click(screen.getByTestId("reassign-call-100"));

    // The current coach is shown but disabled — clicking it is a no-op.
    const currentItem = await screen.findByTestId("reassign-call-100-coach-7");
    expect(currentItem).toHaveAttribute("aria-disabled", "true");

    await user.click(currentItem);
    expect(patchBodies).toHaveLength(0);
  });
});
