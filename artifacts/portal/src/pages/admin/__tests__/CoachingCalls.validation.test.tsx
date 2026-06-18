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
// Guards the client-side validation in handleSaveTemplate (CoachingCalls.tsx):
// the recurring-schedule dialog must block submission and show a destructive
// toast when a required field is missing, and must NOT call the create
// endpoint. A valid submission, by contrast, should clear validation and POST.
// Only the network boundary is faked.
// ---------------------------------------------------------------------------
let coaches: Array<{ id: number; name: string }>;
const createBodies: Array<Record<string, unknown>> = [];

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
    return Promise.resolve(jsonResponse({ coaches }));
  }

  if (path === "/api/admin/coaching/calls" && method === "GET") {
    return Promise.resolve(jsonResponse({ calls: [] }));
  }

  if (path === "/api/admin/coaching/calls/templates" && method === "GET") {
    return Promise.resolve(jsonResponse({ templates: [] }));
  }

  if (path === "/api/admin/coaching/calls/templates" && method === "POST") {
    const body = JSON.parse(String(options?.body ?? "{}"));
    createBodies.push(body);
    const created = {
      id: 100,
      title: body.title,
      description: body.description ?? "",
      callType: body.callType,
      coachId: body.coachId,
      coachName: coaches.find((c) => c.id === body.coachId)?.name ?? "Unknown",
      meetLink: body.meetLink ?? null,
      durationMinutes: body.durationMinutes ?? 60,
      requiredEntitlement: body.requiredEntitlement ?? "coaching:group",
      intervalDays: body.intervalDays ?? 7,
      occurrencesPerBatch: body.occurrencesPerBatch ?? 8,
      anchorAt: body.anchorAt,
      lastGeneratedAt: null,
      active: true,
    };
    return Promise.resolve(jsonResponse({ template: created, generated: 8 }));
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

async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the coaches query to settle so openNewTemplate can pre-fill the
  // coach (or leave it blank when there are none).
  await screen.findByText(/No recurring schedules yet/i);
  await user.click(screen.getByTestId("add-template"));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  coaches = [
    { id: 7, name: "Sasha Coach" },
    { id: 9, name: "Bruce Coach" },
  ];
  createBodies.length = 0;
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls recurring schedule validation", () => {
  it("blocks submit with a missing title and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    // Coach is pre-filled (coaches exist); leave the title blank.
    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Title is required", variant: "destructive" }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a missing coach and does not POST", async () => {
    // No coaches available, so openNewTemplate leaves coachId blank.
    coaches = [];
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");
    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Please pick a coach", variant: "destructive" }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a missing first-call date and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");
    // Coach is pre-filled; leave the first-call date empty.
    await user.clear(within(dialog).getByTestId("template-anchor-at"));
    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "First call date & time is required",
          variant: "destructive",
        }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a non-positive duration and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    // Pick a coach via the Radix Select.
    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    const duration = within(dialog).getByTestId("template-duration");
    await user.clear(duration);
    await user.type(duration, "0");

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Duration must be a positive number of minutes",
          variant: "destructive",
        }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a cleared (empty) duration and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    await user.clear(within(dialog).getByTestId("template-duration"));

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Duration must be a positive number of minutes",
          variant: "destructive",
        }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a non-positive weeks-to-generate and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    const batch = within(dialog).getByTestId("template-batch");
    await user.clear(batch);
    await user.type(batch, "0");

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weeks to Generate must be a positive number",
          variant: "destructive",
        }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("blocks submit with a cleared (empty) weeks-to-generate and does not POST", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    await user.clear(within(dialog).getByTestId("template-batch"));

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weeks to Generate must be a positive number",
          variant: "destructive",
        }),
      ),
    );
    expect(createBodies).toHaveLength(0);
  });

  it("submits the typed duration and weeks-to-generate values", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    const duration = within(dialog).getByTestId("template-duration");
    await user.clear(duration);
    await user.type(duration, "45");

    const batch = within(dialog).getByTestId("template-batch");
    await user.clear(batch);
    await user.type(batch, "12");

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({
      durationMinutes: 45,
      occurrencesPerBatch: 12,
    });
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("submits when all required fields are present", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openAddDialog(user);
    await user.type(within(dialog).getByTestId("template-title"), "Weekly Series");

    // Pick a coach via the Radix Select.
    await user.click(within(dialog).getByTestId("template-coach"));
    await user.click(await screen.findByRole("option", { name: "Bruce Coach" }));

    // First-call date & time (only present when creating).
    const anchorAt = within(dialog).getByTestId("template-anchor-at");
    await user.clear(anchorAt);
    await user.type(anchorAt, "2026-07-01T14:30");

    await user.click(within(dialog).getByTestId("save-template"));

    await waitFor(() => expect(createBodies).toHaveLength(1));
    expect(createBodies[0]).toMatchObject({
      title: "Weekly Series",
      coachId: 9,
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Recurring schedule created" }),
      ),
    );
    // No validation toast fired.
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
