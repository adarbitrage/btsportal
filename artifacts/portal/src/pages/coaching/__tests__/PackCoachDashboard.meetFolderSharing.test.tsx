import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The coach Google Drive connection card shows a one-time setup callout telling
// coaches to set their "Meet Recordings" Drive folder to "Anyone with the link"
// (Viewer). Without coaches following this, member-facing recording links hit a
// permission wall — so this guidance is essential. This test pins the callout to
// the connected state: it must render once the coach's Google account is
// connected, and must NOT render when the account is not connected. A future
// refactor that drops the callout would break it silently otherwise.
//
// We render GoogleDriveCard in isolation, mocking only the coach-google-api
// hooks (connected/not-connected status) and the toast hook it depends on.

const useCoachGoogleStatus = vi.fn();
const useCoachGoogleDisconnect = vi.fn(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
vi.mock("@/lib/coach-google-api", () => ({
  useCoachGoogleStatus: () => useCoachGoogleStatus(),
  useCoachGoogleDisconnect: () => useCoachGoogleDisconnect(),
  startGoogleConnect: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { GoogleDriveCard } from "../PackCoachDashboard";

beforeEach(() => {
  vi.clearAllMocks();
  useCoachGoogleDisconnect.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

describe("GoogleDriveCard Meet folder-sharing callout", () => {
  it("renders the callout when the coach's Google account is connected", () => {
    useCoachGoogleStatus.mockReturnValue({
      data: {
        configured: true,
        connected: true,
        email: "coach@example.com",
        status: "active",
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
      isLoading: false,
    });

    render(<GoogleDriveCard />);

    expect(
      screen.getByTestId("callout-meet-folder-sharing"),
    ).toBeInTheDocument();
  });

  it("does not render the callout when the account is not connected", () => {
    useCoachGoogleStatus.mockReturnValue({
      data: {
        configured: true,
        connected: false,
        email: null,
        status: null,
        connectedAt: null,
      },
      isLoading: false,
    });

    render(<GoogleDriveCard />);

    expect(
      screen.queryByTestId("callout-meet-folder-sharing"),
    ).toBeNull();
  });
});
