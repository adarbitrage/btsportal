import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Guards the "likely no-show" recording shortcut on the COACH dashboard.
//
// A flagged likely-no-show row (past, still-booked, no recording found) must
// surface an inline "Add recording link" shortcut (button-add-recording-link)
// instead of the passive "No recording found" hint — and clicking it must open
// the manual RecordingLinksEditor so the coach can paste a link and clear the
// flag before marking an outcome. A non-flagged row with no recording must keep
// showing the plain hint with no shortcut. A future refactor that drops the
// shortcut or stops opening the editor would break this test loudly.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const useCoachPackSessions = vi.fn();
vi.mock("@/lib/coach-pack-api", () => ({
  useCoachPackSessions: (...args: unknown[]) => useCoachPackSessions(...args),
  useCoachPackMemberHistory: () => ({ data: undefined, isLoading: false }),
  useCoachSavePackNotes: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCoachSetRecording: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/session-coaching-admin-api", () => ({
  useAdminPackCoaches: () => ({ data: [] }),
}));

vi.mock("@/lib/coach-google-api", () => ({
  useCoachGoogleStatus: () => ({
    data: { configured: true, connected: false, email: null, status: null, connectedAt: null },
    isLoading: false,
  }),
  useCoachGoogleDisconnect: () => ({ mutateAsync: vi.fn(), isPending: false }),
  startGoogleConnect: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import PackCoachDashboard from "../PackCoachDashboard";

const likelyNoShowBooking = {
  id: 101,
  memberId: 1,
  memberName: "Likely Member",
  memberEmail: "likely@example.com",
  coachName: "Coach One",
  scheduledAt: "2026-01-01T10:00:00.000Z",
  status: "booked",
  recordingUrl: null,
  summaryUrl: null,
  transcriptUrl: null,
  recordingIngestStatus: "not_found",
  likelyNoShow: true,
  coachNotes: null,
  actionItems: [],
};

const plainBooking = {
  id: 202,
  memberId: 2,
  memberName: "Plain Member",
  memberEmail: "plain@example.com",
  coachName: "Coach Two",
  scheduledAt: "2026-01-02T10:00:00.000Z",
  status: "booked",
  recordingUrl: null,
  summaryUrl: null,
  transcriptUrl: null,
  recordingIngestStatus: "not_found",
  likelyNoShow: false,
  coachNotes: null,
  actionItems: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useCoachPackSessions.mockReturnValue({
    data: {
      bookings: [likelyNoShowBooking, plainBooking],
      stats: {},
      total: 2,
    },
    isLoading: false,
  });
});

describe("PackCoachDashboard — likely no-show recording shortcut", () => {
  it("renders the shortcut on a likely-no-show row and the plain hint on a normal row", () => {
    render(<PackCoachDashboard />);

    const likelyRow = screen.getByTestId(`session-row-${likelyNoShowBooking.id}`);
    const shortcut = within(likelyRow).getByTestId("button-add-recording-link");
    expect(shortcut).toHaveTextContent("Add recording link");
    // The flagged row uses the shortcut INSTEAD of the passive hint.
    expect(within(likelyRow).queryByText("No recording found")).toBeNull();

    const plainRow = screen.getByTestId(`session-row-${plainBooking.id}`);
    expect(within(plainRow).queryByTestId("button-add-recording-link")).toBeNull();
    expect(within(plainRow).getByText("No recording found")).toBeInTheDocument();
  });

  it("opens the RecordingLinksEditor when the shortcut is clicked", async () => {
    render(<PackCoachDashboard />);

    const likelyRow = screen.getByTestId(`session-row-${likelyNoShowBooking.id}`);
    await userEvent.click(within(likelyRow).getByTestId("button-add-recording-link"));

    // The editor's three URL inputs become visible in the recording dialog.
    await waitFor(() =>
      expect(screen.getByTestId("input-recordingUrl")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("input-summaryUrl")).toBeInTheDocument();
    expect(screen.getByTestId("input-transcriptUrl")).toBeInTheDocument();
  });
});
