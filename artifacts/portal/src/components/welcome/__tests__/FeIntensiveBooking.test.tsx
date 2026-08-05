/**
 * FeIntensiveBooking component states:
 *   1. configured:false  → renders the parent-supplied pending node.
 *   2. configured, no booking → booking grid (calendar + slots after picking
 *      a day) with copy from the brand-substituted curriculum payload.
 *   3. configured, upcoming booking → booked-state card (member timezone).
 *   4. status fetch failure → friendly retry card, never a broken grid.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeIntensiveBooking, type FeBookingUiCopy } from "../FeIntensiveBooking";

const authFetchMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  useAuth: () => ({ user: { timezone: "America/New_York" } }),
}));

const copy: FeBookingUiCopy = {
  intro: "Pick a day and time — your BTS coach will meet you there.",
  timezoneNote: "All times shown in your timezone:",
  chooseDayHint: "Choose a highlighted day.",
  noSlotsForDay: "No open times on this day.",
  noSlotsAtAll: "No open times right now.",
  confirmCta: "Confirm booking",
  bookingInProgress: "Booking…",
  confirmationTitle: "You're booked!",
  confirmationBody: "Confirmed — see you soon.",
  bookedTitle: "Your coaching session is booked",
  bookedBody: "You're all set.",
  cancelCta: "Cancel session",
  rebookCta: "Pick a new time",
  cancelConfirmTitle: "Cancel this session?",
  cancelConfirmBody: "The time will be released.",
  keepCta: "Keep my session",
  supportLine: "Need a hand? Contact support any time from the Support page.",
  errorTitle: "We couldn't load the calendar",
  errorBody: "Give it another try.",
  retryCta: "Try again",
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FeIntensiveBooking
        copy={copy}
        pending={<div data-testid="pending-card">PENDING STATE</div>}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  authFetchMock.mockReset();
});

describe("FeIntensiveBooking", () => {
  it("renders the pending node when config is unset", async () => {
    authFetchMock.mockResolvedValue(jsonResponse({ configured: false, booking: null }));
    renderComponent();
    expect(await screen.findByTestId("pending-card")).toBeInTheDocument();
    expect(screen.queryByTestId("fe-booking-grid")).not.toBeInTheDocument();
  });

  it("renders the booking grid when configured with no booking", async () => {
    authFetchMock.mockImplementation((path: string) => {
      if (path === "/fe-intensive/status") {
        return Promise.resolve(jsonResponse({ configured: true, booking: null }));
      }
      if (path === "/fe-intensive/availability") {
        const slot = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        return Promise.resolve(
          jsonResponse({ configured: true, slots: [{ startTime: slot }], durationMinutes: 60 }),
        );
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });
    renderComponent();
    expect(await screen.findByTestId("fe-booking-grid")).toBeInTheDocument();
    expect(screen.getByText(copy.chooseDayHint)).toBeInTheDocument();
    expect(screen.queryByTestId("pending-card")).not.toBeInTheDocument();
  });

  it("renders the booked-state card in the member's timezone", async () => {
    const scheduledAt = "2026-09-10T15:00:00.000Z"; // 11:00 AM America/New_York
    authFetchMock.mockResolvedValue(
      jsonResponse({
        configured: true,
        booking: {
          id: 1,
          scheduledAt,
          endAt: "2026-09-10T16:00:00.000Z",
          durationMinutes: 60,
          status: "booked",
        },
      }),
    );
    renderComponent();
    expect(await screen.findByTestId("fe-booking-booked")).toBeInTheDocument();
    expect(screen.getByText(copy.bookedTitle)).toBeInTheDocument();
    expect(screen.getByTestId("fe-booking-booked-time").textContent).toMatch(/11:00/);
    expect(screen.getByTestId("fe-booking-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("fe-booking-rebook")).toBeInTheDocument();
  });

  it("shows a friendly retry card on status failure — never a broken grid", async () => {
    authFetchMock.mockResolvedValue(jsonResponse({}, false, 502));
    renderComponent();
    expect(await screen.findByTestId("fe-booking-status-error")).toBeInTheDocument();
    expect(screen.getByTestId("fe-booking-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("fe-booking-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pending-card")).not.toBeInTheDocument();
  });

  it("shows the retry card when availability fails", async () => {
    authFetchMock.mockImplementation((path: string) => {
      if (path === "/fe-intensive/status") {
        return Promise.resolve(jsonResponse({ configured: true, booking: null }));
      }
      return Promise.resolve(jsonResponse({}, false, 502));
    });
    renderComponent();
    expect(await screen.findByTestId("fe-booking-availability-error")).toBeInTheDocument();
  });

  it("shows the empty-calendar message when no slots exist at all", async () => {
    authFetchMock.mockImplementation((path: string) => {
      if (path === "/fe-intensive/status") {
        return Promise.resolve(jsonResponse({ configured: true, booking: null }));
      }
      return Promise.resolve(jsonResponse({ configured: true, slots: [], durationMinutes: 60 }));
    });
    renderComponent();
    expect(await screen.findByTestId("fe-booking-no-slots")).toBeInTheDocument();
  });
});
