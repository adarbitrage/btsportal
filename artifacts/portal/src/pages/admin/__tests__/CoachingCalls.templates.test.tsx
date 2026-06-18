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
// In-memory fake of the admin coaching-calls API, focused on the schedule-first
// recurring template create/edit/delete flow. The component drives the real
// React Query hooks + adminFetch, so a regression in the schedule form wiring
// (day-of-week + time -> anchorAt), the create/edit/delete mutations, or the
// list refresh surfaces here. Only the network boundary is faked.
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

const COACHES = [
  { id: 7, name: "Sasha Coach" },
  { id: 9, name: "Bruce Coach" },
];

let templates: ServerTemplate[];
let nextId: number;
const createBodies: Array<Record<string, unknown>> = [];
const patchBodies: Array<{ id: number; body: Record<string, unknown> }> = [];

// Flip these to make the matching endpoint reject with a 500 so the failure
// paths in handleSaveTemplate / handleDeleteTemplate run.
const failRoutes = { create: false, delete: false };

function makeTemplate(overrides: Partial<ServerTemplate> = {}): ServerTemplate {
  return {
    id: nextId++,
    title: "Weekly Coaching Series",
    description: "",
    callType: "weekly_qa",
    coachId: 7,
    coachName: findCoachName(7),
    meetLink: null,
    durationMinutes: 60,
    requiredEntitlement: "coaching:group",
    intervalDays: 7,
    occurrencesPerBatch: 8,
    anchorAt: "2026-07-01T14:30:00.000Z",
    lastGeneratedAt: null,
    active: true,
    ...overrides,
  };
}

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

  if (path === "/api/admin/coaching/calls" && method === "GET") {
    return Promise.resolve(jsonResponse({ calls: [] }));
  }

  if (path === "/api/admin/coaching/calls/templates" && method === "GET") {
    return Promise.resolve(jsonResponse({ templates }));
  }

  if (path === "/api/admin/coaching/calls/templates" && method === "POST") {
    if (failRoutes.create) {
      return Promise.resolve(jsonResponse({ error: "Boom" }, 500));
    }
    const body = JSON.parse(String(options?.body ?? "{}"));
    createBodies.push(body);
    const created: ServerTemplate = {
      id: nextId++,
      title: body.title,
      description: body.description ?? "",
      callType: body.callType,
      coachId: body.coachId,
      coachName: findCoachName(body.coachId),
      meetLink: body.meetLink ?? null,
      durationMinutes: body.durationMinutes ?? 60,
      requiredEntitlement: body.requiredEntitlement ?? "coaching:group",
      intervalDays: body.intervalDays ?? 7,
      occurrencesPerBatch: body.occurrencesPerBatch ?? 8,
      anchorAt: body.anchorAt,
      lastGeneratedAt: null,
      active: true,
    };
    templates = [...templates, created];
    return Promise.resolve(
      jsonResponse({ template: created, generated: created.occurrencesPerBatch }),
    );
  }

  const idMatch = path.match(/^\/api\/admin\/coaching\/calls\/templates\/(\d+)$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (method === "PATCH") {
      const body = JSON.parse(String(options?.body ?? "{}"));
      patchBodies.push({ id, body });
      templates = templates.map((t) =>
        t.id === id
          ? {
              ...t,
              ...body,
              coachName: body.coachId ? findCoachName(body.coachId) : t.coachName,
            }
          : t,
      );
      return Promise.resolve(jsonResponse(templates.find((t) => t.id === id)));
    }
    if (method === "DELETE") {
      if (failRoutes.delete) {
        return Promise.resolve(jsonResponse({ error: "Boom" }, 500));
      }
      templates = templates.filter((t) => t.id !== id);
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
  templates = [];
  nextId = 100;
  createBodies.length = 0;
  patchBodies.length = 0;
  failRoutes.create = false;
  failRoutes.delete = false;
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls schedule-first create/edit/delete", () => {
  it("creates a weekly schedule from day + time, edits it, then deletes it", async () => {
    const user = userEvent.setup();
    renderPage();

    // Starts at the schedule-first empty state.
    expect(
      await screen.findByText(/No weekly calls scheduled yet/i),
    ).toBeInTheDocument();

    // --- CREATE ----------------------------------------------------------
    await user.click(screen.getByTestId("add-weekly-call"));

    const createDialog = await screen.findByRole("dialog");
    await user.type(
      within(createDialog).getByTestId("template-title"),
      "Weekly Coaching Series",
    );

    // Pick a coach + type via the Radix Selects.
    await user.click(within(createDialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));
    await user.click(within(createDialog).getByTestId("template-type"));
    await user.click(await screen.findByRole("option", { name: "Strategy" }));

    // Day-of-week + time (replaces the old anchor datetime picker).
    await user.click(within(createDialog).getByTestId("template-day"));
    await user.click(await screen.findByRole("option", { name: "Wednesday" }));
    const time = within(createDialog).getByTestId("template-time");
    await user.clear(time);
    await user.type(time, "09:30");

    await user.type(
      within(createDialog).getByTestId("template-meet-link"),
      "https://meet.google.com/aaa-bbbb-ccc",
    );

    await user.click(within(createDialog).getByTestId("save-template"));

    // The new schedule card appears with the chosen coach (the simplified card
    // shows only the title + schedule summary + coach, not the call type).
    const createdCard = await screen.findByTestId("template-100");
    expect(within(createdCard).getByText("Weekly Coaching Series")).toBeInTheDocument();
    expect(within(createdCard).getByText(/Bruce Coach/)).toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Weekly call scheduled" }),
      ),
    );

    // The day + time were resolved into a future anchorAt on the chosen weekday.
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({
      title: "Weekly Coaching Series",
      callType: "strategy",
      coachId: 9,
      meetLink: "https://meet.google.com/aaa-bbbb-ccc",
      occurrencesPerBatch: 8,
    });
    const anchor = new Date(createBodies[0].anchorAt as string);
    expect(anchor.getDay()).toBe(3); // Wednesday (local)
    expect(anchor.getHours()).toBe(9);
    expect(anchor.getMinutes()).toBe(30);
    expect(anchor.getTime()).toBeGreaterThan(Date.now());

    // --- EDIT (rename the schedule) -------------------------------------
    await user.click(screen.getByTestId("edit-template-100"));
    const editDialog = await screen.findByRole("dialog");
    const titleInput = within(editDialog).getByTestId("template-title");
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed Coaching Series");
    await user.click(within(editDialog).getByTestId("save-template"));

    // List reflects the new title (old one is gone).
    await waitFor(() =>
      expect(screen.getByText("Renamed Coaching Series")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Weekly Coaching Series")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Schedule updated" }),
      ),
    );
    // The edit PATCH carries an anchorAt so the backend re-slots upcoming weeks.
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0].body).toHaveProperty("anchorAt");

    // --- DELETE ----------------------------------------------------------
    await user.click(screen.getByTestId("delete-template-100"));
    await user.click(await screen.findByTestId("confirm-delete-template"));

    // Back to the schedule-first empty state.
    await waitFor(() =>
      expect(screen.queryByTestId("template-100")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText(/No weekly calls scheduled yet/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Schedule removed" }),
      ),
    );
  });
});

describe("CoachingCalls schedule-first failure handling", () => {
  it("shows a destructive toast and keeps the dialog open when creating fails", async () => {
    failRoutes.create = true;
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(/No weekly calls scheduled yet/i),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("add-weekly-call"));

    const createDialog = await screen.findByRole("dialog");
    await user.type(
      within(createDialog).getByTestId("template-title"),
      "Weekly Coaching Series",
    );

    await user.click(within(createDialog).getByTestId("save-template"));

    // The matching destructive toast surfaces the failure.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not save schedule",
          variant: "destructive",
        }),
      ),
    );
    // No success toast leaked through, and no schedule was added.
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Weekly call scheduled" }),
    );
    expect(screen.queryByTestId("template-100")).not.toBeInTheDocument();

    // The dialog stays open so the admin can retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("save-template")).toBeInTheDocument();
  });

  it("shows a destructive toast and keeps the confirm dialog open when deleting fails", async () => {
    templates = [makeTemplate({ id: 100 })];
    failRoutes.delete = true;
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId("template-100");
    await user.click(within(card).getByTestId("delete-template-100"));
    await user.click(await screen.findByTestId("confirm-delete-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not remove schedule",
          variant: "destructive",
        }),
      ),
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Schedule removed" }),
    );

    // The confirm dialog stays open (and the schedule is still listed) so the
    // admin can retry the removal.
    expect(screen.getByTestId("confirm-delete-template")).toBeInTheDocument();
    expect(screen.getByTestId("template-100")).toBeInTheDocument();
  });
});
