import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SessionBooking as SessionBookingType } from "@/lib/session-packs-api";

// Locks the member-facing recording controls on the 1-on-1 sessions page.
// The backend only surfaces recordingUrl/summaryUrl/transcriptUrl on COMPLETED
// sessions (and never coach-only notes); the portal renders "Watch Recording",
// "See Meeting Notes" and "Read Transcript" for those. A refactor of
// SessionBooking.tsx could silently hide them on completed sessions or show
// them on booked/cancelled ones — the regression class this test guards.
//
// We render the real SessionBooking page, mocking only the data hooks, auth,
// toast, AppLayout and wouter (the page-test pattern used elsewhere).

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, email: "member@example.com", role: "member" } }),
}));

const useSessionBalance = vi.fn();
const useMySessionBookings = vi.fn();
vi.mock("@/lib/session-packs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-packs-api")>();
  return {
    ...actual,
    useSessionBalance: () => useSessionBalance(),
    useMySessionBookings: () => useMySessionBookings(),
    useCancelSessionBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import SessionBooking from "@/pages/coaching/SessionBooking";

// A clearly-past date so booked sessions land in the "Past Sessions" list
// (booked + scheduledAt < now) rather than the upcoming card.
const PAST_AT = new Date("2025-01-15T17:00:00.000Z").toISOString();

// Recognizable coach-only fields that the member API must never return. We
// attach them to the fixture (cast away the type) to prove the page never
// renders them even if they somehow leak into the payload.
const COACH_NOTES_TEXT = "COACH ONLY: member seemed disengaged";
const ACTION_ITEMS_TEXT = "COACH ONLY: follow up about refund";

function makeBooking(overrides: Partial<SessionBookingType>): SessionBookingType {
  const base: SessionBookingType = {
    id: 0,
    coachId: 7,
    coachName: "Michael",
    coachPhotoUrl: null,
    scheduledAt: PAST_AT,
    endAt: PAST_AT,
    durationMinutes: 60,
    meetLink: null,
    status: "completed",
    title: "1-on-1 Coaching",
    discussionTopic: null,
    cancelledAt: null,
    createdAt: PAST_AT,
    recordingUrl: null,
    summaryUrl: null,
    transcriptUrl: null,
  };
  return {
    ...base,
    ...overrides,
    // Inject coach-only fields the member view must never surface.
    coachNotes: COACH_NOTES_TEXT,
    actionItems: ACTION_ITEMS_TEXT,
  } as SessionBookingType;
}

function bookingsResult(bookings: SessionBookingType[]) {
  return { data: bookings, isLoading: false };
}

beforeEach(() => {
  useSessionBalance.mockReturnValue({ data: { balance: 0 }, isLoading: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SessionBooking — member recording controls", () => {
  it("renders Watch Recording, Meeting Notes and Transcript for a completed session", () => {
    const completed = makeBooking({
      id: 101,
      status: "completed",
      recordingUrl: "https://drive.google.com/file/d/REC123/view",
      summaryUrl: "https://drive.google.com/file/d/SUM123/view",
      transcriptUrl: "https://drive.google.com/file/d/TRN123/view",
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    expect(screen.getByTestId("watch-recording-101")).toBeInTheDocument();
    expect(screen.getByTestId("meeting-notes-101")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-101")).toBeInTheDocument();
  });

  it("does NOT render the controls for a booked (past) session with no links", () => {
    // Backend strips the URLs on non-completed sessions; model that here.
    const booked = makeBooking({
      id: 202,
      status: "booked",
      recordingUrl: null,
      summaryUrl: null,
      transcriptUrl: null,
    });
    useMySessionBookings.mockReturnValue(bookingsResult([booked]));

    render(<SessionBooking />);

    expect(screen.queryByTestId("watch-recording-202")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-notes-202")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transcript-202")).not.toBeInTheDocument();
  });

  it("does NOT render the controls for a cancelled session with no links", () => {
    const cancelled = makeBooking({
      id: 303,
      status: "cancelled",
      cancelledAt: PAST_AT,
      recordingUrl: null,
      summaryUrl: null,
      transcriptUrl: null,
    });
    useMySessionBookings.mockReturnValue(bookingsResult([cancelled]));

    render(<SessionBooking />);

    expect(screen.queryByTestId("watch-recording-303")).not.toBeInTheDocument();
    expect(screen.queryByTestId("meeting-notes-303")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transcript-303")).not.toBeInTheDocument();
  });

  it("never surfaces coach-only notes in the member view", () => {
    const completed = makeBooking({
      id: 404,
      status: "completed",
      recordingUrl: "https://drive.google.com/file/d/REC404/view",
      summaryUrl: "https://drive.google.com/file/d/SUM404/view",
      transcriptUrl: "https://drive.google.com/file/d/TRN404/view",
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    // The controls are present...
    expect(screen.getByTestId("watch-recording-404")).toBeInTheDocument();
    // ...but coach-only content must never leak into the rendered page.
    expect(screen.queryByText(COACH_NOTES_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(ACTION_ITEMS_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(/coach only/i)).not.toBeInTheDocument();
  });
});
