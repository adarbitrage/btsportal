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
// In-memory fake of the admin coaching-calls API. Covers the one-off call
// section (calls with no recurring schedule) — create / edit / delete. The
// component uses the real React Query hooks + adminFetch, so wiring regressions
// in the dialog/form or the hooks surface here. Only the network boundary
// (fetch) is faked.
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
let nextId: number;

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

  if (path === "/api/admin/coaching/calls" && method === "POST") {
    const body = JSON.parse(String(options?.body ?? "{}"));
    const created: ServerCall = {
      id: nextId++,
      title: body.title,
      description: body.description ?? "",
      callType: body.callType,
      coachId: body.coachId,
      coachName: findCoachName(body.coachId),
      meetLink: body.meetLink ?? null,
      scheduledAt: body.scheduledAt,
      durationMinutes: body.durationMinutes,
      requiredEntitlement: body.requiredEntitlement ?? "coaching:group",
      recordingUrl: body.recordingUrl ?? null,
      registeredCount: 0,
      templateId: null,
    };
    calls = [...calls, created];
    return Promise.resolve(jsonResponse(created));
  }

  const idMatch = path.match(/^\/api\/admin\/coaching\/calls\/(\d+)$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (method === "PATCH") {
      const body = JSON.parse(String(options?.body ?? "{}"));
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
    if (method === "DELETE") {
      calls = calls.filter((c) => c.id !== id);
      return Promise.resolve(jsonResponse({ ok: true }));
    }
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
  calls = [];
  nextId = 100;
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls one-off call editor (CRUD)", () => {
  it("creates a one-off call, edits its Meet link, then deletes it — list updates each time", async () => {
    const user = userEvent.setup();
    renderPage();

    // Starts with no one-off calls.
    expect(await screen.findByText(/No one-off calls/i)).toBeInTheDocument();

    // --- CREATE ----------------------------------------------------------
    await user.click(screen.getByTestId("add-call"));

    const createDialog = await screen.findByRole("dialog");
    await user.type(within(createDialog).getByTestId("call-title"), "Strategy Session");

    // Pick a coach via the Radix Select.
    await user.click(within(createDialog).getByTestId("call-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    // Pick a call type.
    await user.click(within(createDialog).getByTestId("call-type"));
    await user.click(await screen.findByRole("option", { name: "Strategy" }));

    // Date & time (datetime-local) + Meet link.
    const scheduledAt = within(createDialog).getByTestId("call-scheduled-at");
    await user.clear(scheduledAt);
    await user.type(scheduledAt, "2026-07-01T14:30");
    await user.type(
      within(createDialog).getByTestId("call-meet-link"),
      "https://meet.google.com/aaa-bbbb-ccc",
    );

    await user.click(within(createDialog).getByTestId("save-call"));

    // Card appears in the list with the chosen coach + meet link.
    const createdCard = await screen.findByTestId("call-100");
    expect(within(createdCard).getByText("Strategy Session")).toBeInTheDocument();
    expect(within(createdCard).getByText(/Bruce Coach/)).toBeInTheDocument();
    expect(within(createdCard).getByText("Strategy")).toBeInTheDocument();
    expect(
      within(createdCard).getByText("https://meet.google.com/aaa-bbbb-ccc"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Call added" })),
    );

    // --- EDIT (change Meet link) ----------------------------------------
    await user.click(screen.getByTestId("edit-call-100"));
    const editDialog = await screen.findByRole("dialog");
    const meetInput = within(editDialog).getByTestId("call-meet-link");
    await user.clear(meetInput);
    await user.type(meetInput, "https://meet.google.com/zzz-yyyy-xxx");
    await user.click(within(editDialog).getByTestId("save-call"));

    // List reflects the new link (and the old one is gone).
    await waitFor(() =>
      expect(
        screen.getByText("https://meet.google.com/zzz-yyyy-xxx"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("https://meet.google.com/aaa-bbbb-ccc"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Call updated" })),
    );

    // --- DELETE ----------------------------------------------------------
    await user.click(screen.getByTestId("delete-call-100"));
    await user.click(await screen.findByTestId("confirm-delete-call"));

    // Back to the empty one-off state.
    await waitFor(() =>
      expect(screen.queryByTestId("call-100")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/No one-off calls/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Call deleted" })),
    );
  });
});
