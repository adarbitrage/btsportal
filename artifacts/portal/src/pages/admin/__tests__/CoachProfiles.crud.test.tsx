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

import CoachProfiles from "@/pages/admin/CoachProfiles";

// ---------------------------------------------------------------------------
// In-memory fake of the admin coach-profiles API. The component uses the real
// React Query hooks + adminFetch, so wiring regressions in the edit dialog/form
// or the hooks surface here. Only the network boundary (fetch) is faked.
// ---------------------------------------------------------------------------
interface ServerCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
}

let coaches: ServerCoach[];

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

  if (path === "/api/admin/coaching/coaches" && method === "GET") {
    return Promise.resolve(jsonResponse({ coaches }));
  }

  const idMatch = path.match(/^\/api\/admin\/coaching\/coaches\/(\d+)$/);
  if (idMatch && method === "PATCH") {
    const id = Number(idMatch[1]);
    const body = JSON.parse(String(options?.body ?? "{}"));
    coaches = coaches.map((c) => (c.id === id ? { ...c, ...body } : c));
    return Promise.resolve(jsonResponse(coaches.find((c) => c.id === id)));
  }

  return Promise.resolve(jsonResponse({ error: `Unhandled ${method} ${path}` }, 500));
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <CoachProfiles />
    </QueryClientProvider>,
  );
  return { ...result, invalidateSpy };
}

beforeEach(() => {
  coaches = [
    {
      id: 42,
      name: "Sasha Coach",
      specialties: "Paid Traffic",
      bio: "Original bio.",
      photoUrl: null,
    },
  ];
  toast.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachProfiles admin editor", () => {
  it("edits a coach profile and the list reflects the saved values", async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    // Existing coach card renders.
    const card = await screen.findByTestId("coach-42");
    expect(within(card).getByText("Sasha Coach")).toBeInTheDocument();
    expect(within(card).getByText("Paid Traffic")).toBeInTheDocument();

    // Open the edit dialog and change every editable field.
    await user.click(screen.getByTestId("edit-coach-42"));
    const dialog = await screen.findByRole("dialog");

    const nameInput = within(dialog).getByTestId("coach-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Sasha Renamed");

    const specialtyInput = within(dialog).getByTestId("coach-specialty");
    await user.clear(specialtyInput);
    await user.type(specialtyInput, "Funnels & Email");

    const photoInput = within(dialog).getByTestId("coach-photo-url");
    await user.clear(photoInput);
    await user.type(photoInput, "https://example.test/sasha.png");

    const bioInput = within(dialog).getByTestId("coach-bio");
    await user.clear(bioInput);
    await user.type(bioInput, "Updated bio copy.");

    await user.click(within(dialog).getByTestId("save-coach"));

    // List reflects the saved values.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Coach updated" }),
      ),
    );
    const updatedCard = await screen.findByTestId("coach-42");
    expect(within(updatedCard).getByText("Sasha Renamed")).toBeInTheDocument();
    expect(within(updatedCard).getByText("Funnels & Email")).toBeInTheDocument();
    expect(within(updatedCard).getByText("Updated bio copy.")).toBeInTheDocument();
    expect(within(updatedCard).getByTestId("coach-photo-42")).toHaveAttribute(
      "src",
      "https://example.test/sasha.png",
    );

    // The member-facing "Your Coaches" grid query is invalidated so edits show
    // up there immediately (not just in the admin list).
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/coaches"],
    });
  });

  it("blocks saving when a required field is cleared", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("edit-coach-42"));
    const dialog = await screen.findByRole("dialog");

    await user.clear(within(dialog).getByTestId("coach-name"));
    await user.click(within(dialog).getByTestId("save-coach"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Name is required",
          variant: "destructive",
        }),
      ),
    );
    // No PATCH issued: the original name still shows.
    expect(within(await screen.findByTestId("coach-42")).getByText("Sasha Coach"))
      .toBeInTheDocument();
  });

  it("blocks saving when the specialty is cleared", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("edit-coach-42"));
    const dialog = await screen.findByRole("dialog");

    await user.clear(within(dialog).getByTestId("coach-specialty"));
    await user.click(within(dialog).getByTestId("save-coach"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Specialty is required",
          variant: "destructive",
        }),
      ),
    );
  });

  it("blocks saving when the bio is cleared", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("edit-coach-42"));
    const dialog = await screen.findByRole("dialog");

    await user.clear(within(dialog).getByTestId("coach-bio"));
    await user.click(within(dialog).getByTestId("save-coach"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Bio is required",
          variant: "destructive",
        }),
      ),
    );
  });

  it("blocks saving a non-http(s) photo URL", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId("edit-coach-42"));
    const dialog = await screen.findByRole("dialog");

    const photoInput = within(dialog).getByTestId("coach-photo-url");
    await user.clear(photoInput);
    await user.type(photoInput, "ftp://example.test/pic.png");
    await user.click(within(dialog).getByTestId("save-coach"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Photo URL must start with http:// or https://",
          variant: "destructive",
        }),
      ),
    );
  });
});
