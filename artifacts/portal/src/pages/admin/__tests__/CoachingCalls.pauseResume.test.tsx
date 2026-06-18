import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="pack-coaching-admin-layout-stub">{children}</div>
  ),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import CoachingCalls from "@/pages/admin/CoachingCalls";

// ---------------------------------------------------------------------------
// In-memory fake of the admin coaching-calls API, focused on recurring
// schedules and their pause/resume toggle. The component drives the real React
// Query hooks + adminFetch, so a regression where the Switch stops sending the
// right `active` value or the Paused badge disappears surfaces here. Only fetch
// is faked.
// ---------------------------------------------------------------------------
interface ServerTemplate {
  id: number;
  title: string;
  description: string;
  callType: string;
  coachId: number;
  coachName: string;
  meetLink: string | null;
  durationMinutes: number;
  requiredEntitlement: string;
  intervalDays: number;
  occurrencesPerBatch: number;
  anchorAt: string;
  lastGeneratedAt: string | null;
  active: boolean;
}

let templates: ServerTemplate[];
const patchBodies: Array<{ id: number; body: Record<string, unknown> }> = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(input: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = (options?.method ?? "GET").toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, "");

  if (path === "/api/admin/coaching/calls/coaches" && method === "GET") {
    return Promise.resolve(jsonResponse({ coaches: [{ id: 7, name: "Sasha Coach" }] }));
  }

  if (path === "/api/admin/coaching/calls" && method === "GET") {
    return Promise.resolve(jsonResponse({ calls: [] }));
  }

  if (path === "/api/admin/coaching/calls/templates" && method === "GET") {
    return Promise.resolve(jsonResponse({ templates }));
  }

  const idMatch = path.match(/^\/api\/admin\/coaching\/calls\/templates\/(\d+)$/);
  if (idMatch && method === "PATCH") {
    const id = Number(idMatch[1]);
    const body = JSON.parse(String(options?.body ?? "{}"));
    patchBodies.push({ id, body });
    templates = templates.map((t) => (t.id === id ? { ...t, ...body } : t));
    return Promise.resolve(jsonResponse(templates.find((t) => t.id === id)));
  }

  return Promise.resolve(jsonResponse({ error: `Unhandled ${method} ${path}` }, 500));
}

function makeTemplate(overrides: Partial<ServerTemplate>): ServerTemplate {
  return {
    id: 1,
    title: "Active Template",
    description: "",
    callType: "weekly_qa",
    coachId: 7,
    coachName: "Sasha Coach",
    meetLink: "https://meet.google.com/aaa-bbbb-ccc",
    durationMinutes: 60,
    requiredEntitlement: "coaching:group",
    intervalDays: 7,
    occurrencesPerBatch: 8,
    anchorAt: "2026-07-01T14:30:00.000Z",
    lastGeneratedAt: "2026-08-26T14:30:00.000Z",
    active: true,
    ...overrides,
  };
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
  templates = [
    makeTemplate({ id: 1, title: "Active Template", active: true }),
    makeTemplate({ id: 2, title: "Paused Template", active: false }),
  ];
  patchBodies.length = 0;
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls schedule pause/resume toggle", () => {
  it("shows the paused badge and toggle state only on the paused card", async () => {
    renderPage();

    const activeCard = await screen.findByTestId("template-1");
    const pausedCard = await screen.findByTestId("template-2");

    // Paused badge only on the paused schedule.
    expect(within(pausedCard).getByTestId("template-paused-badge-2")).toBeInTheDocument();
    expect(within(activeCard).queryByTestId("template-paused-badge-1")).not.toBeInTheDocument();

    // The toggle reflects each schedule's active state.
    expect(within(activeCard).getByTestId("toggle-template-1")).toBeChecked();
    expect(within(pausedCard).getByTestId("toggle-template-2")).not.toBeChecked();
  });

  it("pausing an active schedule PATCHes active:false", async () => {
    const user = userEvent.setup();
    renderPage();

    const activeCard = await screen.findByTestId("template-1");
    await user.click(within(activeCard).getByTestId("toggle-template-1"));

    await waitFor(() =>
      expect(patchBodies).toContainEqual({ id: 1, body: { active: false } }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Schedule paused" }),
      ),
    );

    // After refetch the card reflects the new paused state.
    await waitFor(() =>
      expect(screen.getByTestId("template-paused-badge-1")).toBeInTheDocument(),
    );
  });

  it("resuming a paused schedule PATCHes active:true", async () => {
    const user = userEvent.setup();
    renderPage();

    const pausedCard = await screen.findByTestId("template-2");
    await user.click(within(pausedCard).getByTestId("toggle-template-2"));

    await waitFor(() =>
      expect(patchBodies).toContainEqual({ id: 2, body: { active: true } }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Schedule resumed" }),
      ),
    );

    // After refetch the paused badge is gone.
    await waitFor(() =>
      expect(screen.queryByTestId("template-paused-badge-2")).not.toBeInTheDocument(),
    );
  });
});
