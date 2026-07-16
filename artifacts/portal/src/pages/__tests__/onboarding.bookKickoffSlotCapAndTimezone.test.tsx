import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// Task #1691: kickoff booking grid caps visible slots at 8 with a "Show more
// times" expander, and the timezone line uses the friendly label helper
// (falling back to the raw IANA id for zones outside the curated US list).

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding/book-kickoff", navigate],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Test Member", timezone: "America/New_York", onboardingStep: 3, onboardingVariant: "full" },
    refreshAuth: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/coaches-admin-api", () => ({
  resolveCoachPhotoUrl: () => null,
}));

// Date-flake fix: fixed day-of-month values (15..19) fall in the past once the
// real date passes them, disabling the calendar day. Use today+offset clamped
// to the current month (the booking calendar renders only the current month).
function futureDateStrInMonth(offset: number) {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const day = Math.min(today.getDate() + offset, lastDay);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildSlots(count: number, dateStr: string) {
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(`${dateStr}T${String(9 + i).padStart(2, "0")}:00:00.000Z`).toISOString(),
    coachId: 1,
    durationMinutes: 30,
  }));
}

const useKickoffAvailability = vi.fn();
vi.mock("@/lib/call-bookings-api", () => ({
  useKickoffAvailability: () => useKickoffAvailability(),
  useMyKickoffBooking: () => ({ data: { booking: null }, isLoading: false }),
  useBookKickoffCall: () => ({ mutateAsync: vi.fn() }),
}));

import OnboardingBookKickoff from "@/pages/onboarding/BookKickoff";

beforeEach(() => {
  navigate.mockReset();
  useKickoffAvailability.mockReset();
});

function selectFirstAvailableDay() {
  const dayButtons = screen.getAllByRole("button").filter((btn) => !btn.hasAttribute("disabled"));
  const dayButton = dayButtons.find((btn) => /^\d{1,2}$/.test(btn.textContent?.trim() || ""));
  if (!dayButton) throw new Error("No enabled calendar day found");
  fireEvent.click(dayButton);
}

describe("kickoff slot cap + expander", () => {
  it("shows only the first 8 slots by default with a Show more times expander for a day with 12 slots", () => {
    const dateStr = futureDateStrInMonth(0);
    useKickoffAvailability.mockReturnValue({
      data: { slots: buildSlots(12, dateStr), coaches: [{ id: 1, displayName: "Coach A", photoUrl: null, bio: null }] },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<OnboardingBookKickoff />);
    selectFirstAvailableDay();

    const slotButtons = screen.getAllByTestId(/^kickoff-slot-/);
    expect(slotButtons.length).toBe(8);
    expect(screen.getByTestId("show-more-times")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("show-more-times"));
    expect(screen.getAllByTestId(/^kickoff-slot-/).length).toBe(12);
    expect(screen.queryByTestId("show-more-times")).not.toBeInTheDocument();
  });

  it("does not show the expander when a day has 8 or fewer slots", () => {
    const dateStr = futureDateStrInMonth(1);
    useKickoffAvailability.mockReturnValue({
      data: { slots: buildSlots(5, dateStr), coaches: [{ id: 1, displayName: "Coach A", photoUrl: null, bio: null }] },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<OnboardingBookKickoff />);
    selectFirstAvailableDay();

    expect(screen.getAllByTestId(/^kickoff-slot-/).length).toBe(5);
    expect(screen.queryByTestId("show-more-times")).not.toBeInTheDocument();
  });

  it("shows the friendly timezone label instead of the raw IANA id", () => {
    const dateStr = futureDateStrInMonth(2);
    useKickoffAvailability.mockReturnValue({
      data: { slots: buildSlots(1, dateStr), coaches: [{ id: 1, displayName: "Coach A", photoUrl: null, bio: null }] },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<OnboardingBookKickoff />);
    selectFirstAvailableDay();

    expect(screen.getByText(/Eastern Time \(ET\)/)).toBeInTheDocument();
    expect(screen.queryByText(/America\/New_York/)).not.toBeInTheDocument();
  });
});

// Task #1695: the kickoff coach selection card renders the coach's bio,
// matching the accountability partner card's treatment (own line, only when
// the bio is non-null — no empty block or gap for null-bio coaches).
describe("kickoff coach card bio", () => {
  it("shows the selected coach's bio once a slot is selected", () => {
    const dateStr = futureDateStrInMonth(3);
    useKickoffAvailability.mockReturnValue({
      data: {
        slots: buildSlots(1, dateStr),
        coaches: [{ id: 1, displayName: "Coach A", photoUrl: null, bio: "I've helped dozens of members hit their goals." }],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<OnboardingBookKickoff />);
    selectFirstAvailableDay();
    fireEvent.click(screen.getByTestId(/^kickoff-slot-/));

    expect(screen.getByText("I've helped dozens of members hit their goals.")).toBeInTheDocument();
  });

  it("renders no empty bio block when the selected coach's bio is null", () => {
    const dateStr = futureDateStrInMonth(4);
    useKickoffAvailability.mockReturnValue({
      data: {
        slots: buildSlots(1, dateStr),
        coaches: [{ id: 1, displayName: "Neil", photoUrl: null, bio: null }],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    const { container } = render(<OnboardingBookKickoff />);
    selectFirstAvailableDay();
    fireEvent.click(screen.getByTestId(/^kickoff-slot-/));

    expect(screen.getAllByText("Neil").length).toBeGreaterThan(0);
    expect(container.querySelector("p.leading-relaxed")).not.toBeInTheDocument();
  });
});
