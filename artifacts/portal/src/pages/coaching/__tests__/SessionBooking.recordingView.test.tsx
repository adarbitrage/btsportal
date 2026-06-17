import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("links See Meeting Notes to the booking's summaryUrl in a new tab", () => {
    const summaryUrl = "https://drive.google.com/file/d/SUM707/view";
    const completed = makeBooking({
      id: 707,
      status: "completed",
      recordingUrl: "https://drive.google.com/file/d/REC707/view",
      summaryUrl,
      transcriptUrl: "https://drive.google.com/file/d/TRN707/view",
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    const notes = screen.getByTestId("meeting-notes-707");
    expect(notes.tagName).toBe("A");
    expect(notes).toHaveAttribute("href", summaryUrl);
    expect(notes).toHaveAttribute("target", "_blank");
    expect(notes).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links Read Transcript to the booking's transcriptUrl in a new tab", () => {
    const transcriptUrl = "https://drive.google.com/file/d/TRN808/view";
    const completed = makeBooking({
      id: 808,
      status: "completed",
      recordingUrl: "https://drive.google.com/file/d/REC808/view",
      summaryUrl: "https://drive.google.com/file/d/SUM808/view",
      transcriptUrl,
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    const transcript = screen.getByTestId("transcript-808");
    expect(transcript.tagName).toBe("A");
    expect(transcript).toHaveAttribute("href", transcriptUrl);
    expect(transcript).toHaveAttribute("target", "_blank");
    expect(transcript).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens the in-page recording dialog with the Drive /preview embed URL", async () => {
    const user = userEvent.setup();
    const completed = makeBooking({
      id: 505,
      status: "completed",
      recordingUrl: "https://drive.google.com/file/d/REC505/view",
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    // The dialog (and its iframe) must not exist until the button is clicked.
    expect(screen.queryByTitle("Session recording")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("watch-recording-505"));

    // Clicking opens the in-page dialog with an embedded iframe pointing at the
    // Drive .../preview URL (NOT the original .../view link, which can't embed).
    const iframe = await screen.findByTitle("Session recording");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute(
      "src",
      "https://drive.google.com/file/d/REC505/preview",
    );
  });

  it("opens a non-Drive recording link in a new tab instead of the dialog", async () => {
    const user = userEvent.setup();
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(null as unknown as Window);
    const nonDriveUrl = "https://example.com/recordings/session-606.mp4";
    const completed = makeBooking({
      id: 606,
      status: "completed",
      recordingUrl: nonDriveUrl,
    });
    useMySessionBookings.mockReturnValue(bookingsResult([completed]));

    render(<SessionBooking />);

    await user.click(screen.getByTestId("watch-recording-606"));

    // A non-Drive link can't be embedded, so it must open in a new tab and the
    // in-page recording dialog must NOT appear.
    expect(openSpy).toHaveBeenCalledWith(
      nonDriveUrl,
      "_blank",
      "noopener,noreferrer",
    );
    await waitFor(() => {
      expect(screen.queryByTitle("Session recording")).not.toBeInTheDocument();
    });

    openSpy.mockRestore();
  });
});
