import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="pack-coaching-admin-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import CoachProfiles from "@/pages/admin/CoachProfiles";

// ---------------------------------------------------------------------------
// Focused coverage for the per-coach Connections panel. It must render THREE
// purpose-labeled rows (Booking calendar / GoHighLevel, Recording uploads /
// Google Drive, Availability sync / Google Calendar), each with its own status
// pill, and surface the Calendar "needs reconnect" state independently of the
// shared Google grant.
// ---------------------------------------------------------------------------
interface ServerCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  callTypes: string[];
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  ghlCalendarId: string | null;
  ghlLocationId: string | null;
  userId: number | null;
  googleConnection: {
    connected: boolean;
    email: string | null;
    status: string | null;
    connectedAt: string | null;
    needsCalendarReconnect: boolean;
  } | null;
  awayPeriods: never[];
}

let coaches: ServerCoach[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (path === "/api/admin/coaching/coaches") {
    return Promise.resolve(jsonResponse({ coaches }));
  }
  return Promise.resolve(jsonResponse({ error: `Unhandled ${path}` }, 500));
}

function baseCoach(overrides: Partial<ServerCoach>): ServerCoach {
  return {
    id: 1,
    name: "Coach",
    specialties: "Paid Traffic",
    bio: "Bio.",
    photoUrl: null,
    callTypes: ["Strategy Call"],
    doesGroupCalls: false,
    doesPrivateCoaching: true,
    ghlCalendarId: null,
    ghlLocationId: null,
    userId: null,
    googleConnection: null,
    awayPeriods: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachProfiles />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch as typeof fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachProfiles — per-coach Connections panel", () => {
  it("renders three purpose-labeled rows for a private coach with full connections", async () => {
    coaches = [
      baseCoach({
        id: 7,
        ghlCalendarId: "cal_123",
        userId: 99,
        googleConnection: {
          connected: true,
          email: "coach@example.com",
          status: "active",
          connectedAt: "2026-01-01T00:00:00.000Z",
          needsCalendarReconnect: false,
        },
      }),
    ];

    renderPage();

    const panel = await screen.findByTestId("coach-connections-7");

    // Three distinct purpose labels are present.
    expect(within(panel).getByText("Booking calendar")).toBeInTheDocument();
    expect(within(panel).getByText("Recording uploads")).toBeInTheDocument();
    expect(within(panel).getByText("Availability sync")).toBeInTheDocument();

    // Each capability has its own status pill, all connected.
    expect(within(panel).getByTestId("coach-conn-ghl-7")).toHaveTextContent(
      "Connected",
    );
    expect(within(panel).getByTestId("coach-conn-drive-7")).toHaveTextContent(
      "Connected",
    );
    expect(within(panel).getByTestId("coach-conn-calendar-7")).toHaveTextContent(
      "Connected",
    );
  });

  it("surfaces a Calendar 'Needs reconnect' state while Drive stays connected", async () => {
    coaches = [
      baseCoach({
        id: 8,
        ghlCalendarId: "cal_456",
        userId: 99,
        googleConnection: {
          connected: true,
          email: "coach@example.com",
          status: "active",
          connectedAt: "2026-01-01T00:00:00.000Z",
          needsCalendarReconnect: true,
        },
      }),
    ];

    renderPage();

    const panel = await screen.findByTestId("coach-connections-8");

    // Drive rides the same grant and is connected; Calendar flags the scope gap.
    expect(within(panel).getByTestId("coach-conn-drive-8")).toHaveTextContent(
      "Connected",
    );
    expect(within(panel).getByTestId("coach-conn-calendar-8")).toHaveTextContent(
      "Needs reconnect",
    );
  });

  it("shows 'No login linked' for Google rows and 'Not connected' for GHL when unlinked", async () => {
    coaches = [
      baseCoach({
        id: 9,
        ghlCalendarId: null,
        userId: null,
        googleConnection: null,
      }),
    ];

    renderPage();

    const panel = await screen.findByTestId("coach-connections-9");

    expect(within(panel).getByTestId("coach-conn-ghl-9")).toHaveTextContent(
      "Not connected",
    );
    expect(within(panel).getByTestId("coach-conn-drive-9")).toHaveTextContent(
      "No login linked",
    );
    expect(within(panel).getByTestId("coach-conn-calendar-9")).toHaveTextContent(
      "No login linked",
    );
  });

  it("hides the Connections panel for group-only coaches", async () => {
    coaches = [
      baseCoach({
        id: 10,
        doesGroupCalls: true,
        doesPrivateCoaching: false,
      }),
    ];

    renderPage();

    // The coach card renders, but no Connections panel for it.
    await screen.findByTestId("coach-10");
    expect(screen.queryByTestId("coach-connections-10")).not.toBeInTheDocument();
  });
});
