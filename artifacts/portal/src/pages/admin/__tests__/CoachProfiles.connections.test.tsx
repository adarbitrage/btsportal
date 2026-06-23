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
// Focused coverage for the per-coach Connections panel. It must render the
// purpose-labeled rows (Booking calendar / GoHighLevel, Recording uploads /
// Google Drive), each with its own status pill. The availability-sync row was
// removed (GHL's native Google Calendar sync already reflects those events in
// its free-slot reads).
// ---------------------------------------------------------------------------
interface ServerCallCalendar {
  callType: "private_coaching" | "one_on_one_va";
  bookingCalendarId: string | null;
  bookingLocationId: string | null;
  conflictCalendarId: string | null;
  conflictLocationId: string | null;
}

interface ServerCoach {
  id: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string | null;
  type: "strategic_coach" | "va";
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  doesOneOnOneVaCalls: boolean;
  ghlCalendarId: string | null;
  ghlLocationId: string | null;
  conflictGhlCalendarId: string | null;
  callCalendars: ServerCallCalendar[];
  userId: number | null;
  googleConnection: {
    connected: boolean;
    email: string | null;
    status: string | null;
    connectedAt: string | null;
    needsCalendarReconnect: boolean;
  } | null;
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
    type: "strategic_coach",
    doesGroupCalls: false,
    doesPrivateCoaching: true,
    doesOneOnOneVaCalls: false,
    ghlCalendarId: null,
    ghlLocationId: null,
    conflictGhlCalendarId: null,
    callCalendars: [],
    userId: null,
    googleConnection: null,
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
  it("renders purpose-labeled rows for a private coach with full connections", async () => {
    coaches = [
      baseCoach({
        id: 7,
        callCalendars: [
          {
            callType: "private_coaching",
            bookingCalendarId: "cal_123",
            bookingLocationId: "loc_123",
            conflictCalendarId: "cal_conflict_456",
            conflictLocationId: "loc_conflict_456",
          },
        ],
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

    // Purpose labels are present.
    expect(within(panel).getByText("Booking calendar")).toBeInTheDocument();
    expect(within(panel).getByText("Conflict calendar")).toBeInTheDocument();
    expect(within(panel).getByText("Recording uploads")).toBeInTheDocument();
    // The availability-sync row is intentionally gone.
    expect(within(panel).queryByText("Availability sync")).not.toBeInTheDocument();
    expect(within(panel).queryByTestId("coach-conn-calendar-7")).not.toBeInTheDocument();

    // Each capability has its own status pill, all connected.
    expect(within(panel).getByTestId("coach-conn-ghl-7")).toHaveTextContent(
      "Connected",
    );
    expect(within(panel).getByTestId("coach-conn-conflict-ghl-7")).toHaveTextContent(
      "Connected",
    );
    expect(within(panel).getByTestId("coach-conn-drive-7")).toHaveTextContent(
      "Connected",
    );
  });

  it("shows 'No login linked' for the Drive row and 'Not connected' for GHL when unlinked", async () => {
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
    // Conflict calendar row always renders, even when unconfigured.
    expect(within(panel).getByText("Conflict calendar")).toBeInTheDocument();
    expect(
      within(panel).getByTestId("coach-conn-conflict-ghl-9"),
    ).toHaveTextContent("Not connected");
    expect(within(panel).getByTestId("coach-conn-drive-9")).toHaveTextContent(
      "No login linked",
    );
    expect(within(panel).queryByTestId("coach-conn-calendar-9")).not.toBeInTheDocument();
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
