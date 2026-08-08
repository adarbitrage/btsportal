import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const useAdminPartners = vi.fn();
const useAdminKickoffCoaches = vi.fn();
const updateKickoffCoachMutateAsync = vi.fn();
const useUpdateKickoffCoach = vi.fn();

vi.mock("@/lib/partners-admin-api", () => ({
  useAdminPartners: (...args: unknown[]) => useAdminPartners(...args),
  useCreatePartner: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePartner: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMemberPartnerAssignments: () => ({ data: undefined, isLoading: false }),
  useReassignPartner: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEndPartnerAssignment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdminKickoffCoaches: (...args: unknown[]) => useAdminKickoffCoaches(...args),
  useUpdateKickoffCoach: (...args: unknown[]) => useUpdateKickoffCoach(...args),
}));

import Partners from "@/pages/admin/Partners";

const COACHES = [
  {
    id: 7,
    displayName: "Mark Rivera",
    bio: "Original bio",
    photoUrl: null,
    isActive: true,
    tier: "launchpad" as const,
    ghlCalendarId: null,
  },
  {
    id: 8,
    displayName: "Dana Cole",
    bio: "",
    photoUrl: "https://example.com/dana.jpg",
    isActive: false,
    tier: "full" as const,
    ghlCalendarId: "cal_123",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAdminPartners.mockReturnValue({ data: { partners: [] }, isLoading: false });
  useAdminKickoffCoaches.mockReturnValue({
    data: { coaches: COACHES },
    isLoading: false,
  });
  updateKickoffCoachMutateAsync.mockResolvedValue(COACHES[0]);
  useUpdateKickoffCoach.mockReturnValue({
    mutateAsync: updateKickoffCoachMutateAsync,
    isPending: false,
  });
});

describe("Partners page — Kickoff Coaches card", () => {
  it("renders the kickoff coach list with tier and status badges", () => {
    render(<Partners />);

    const row7 = screen.getByTestId("row-kickoff-coach-7");
    expect(row7).toHaveTextContent("Mark Rivera");
    expect(row7).toHaveTextContent("LaunchPad");
    expect(row7).toHaveTextContent("Original bio");

    const row8 = screen.getByTestId("row-kickoff-coach-8");
    expect(row8).toHaveTextContent("Dana Cole");
    expect(row8).toHaveTextContent("Full");
    expect(row8).toHaveTextContent("Inactive");
    expect(row8).toHaveTextContent("No bio set");
  });

  it("shows the empty state when there are no coaches", () => {
    useAdminKickoffCoaches.mockReturnValue({
      data: { coaches: [] },
      isLoading: false,
    });
    render(<Partners />);
    expect(screen.getByText("No kickoff coaches yet.")).toBeInTheDocument();
  });

  it("edits the bio in the dialog and sends the PATCH payload", async () => {
    render(<Partners />);

    fireEvent.click(screen.getByTestId("button-edit-kickoff-coach-7"));

    const dialog = await screen.findByTestId("dialog-kickoff-coach-form");
    expect(dialog).toHaveTextContent("Mark Rivera");

    const bioInput = screen.getByTestId("input-kickoff-coach-bio");
    expect(bioInput).toHaveValue("Original bio");

    fireEvent.change(bioInput, { target: { value: "Updated coach bio" } });
    fireEvent.click(screen.getByTestId("button-save-kickoff-coach"));

    await waitFor(() =>
      expect(updateKickoffCoachMutateAsync).toHaveBeenCalledWith({
        id: 7,
        input: {
          bio: "Updated coach bio",
          photoUrl: null,
          isActive: true,
        },
      }),
    );

    // Dialog closes after a successful save.
    await waitFor(() =>
      expect(
        screen.queryByTestId("dialog-kickoff-coach-form"),
      ).not.toBeInTheDocument(),
    );
  });

  it("passes photoUrl and isActive through the PATCH payload", async () => {
    render(<Partners />);

    fireEvent.click(screen.getByTestId("button-edit-kickoff-coach-8"));
    await screen.findByTestId("dialog-kickoff-coach-form");

    fireEvent.change(screen.getByTestId("input-kickoff-coach-bio"), {
      target: { value: "Dana's new bio" },
    });
    fireEvent.click(screen.getByTestId("switch-kickoff-coach-active"));
    fireEvent.click(screen.getByTestId("button-save-kickoff-coach"));

    await waitFor(() =>
      expect(updateKickoffCoachMutateAsync).toHaveBeenCalledWith({
        id: 8,
        input: {
          bio: "Dana's new bio",
          photoUrl: "https://example.com/dana.jpg",
          isActive: true,
        },
      }),
    );
  });

  it("keeps the dialog open when the save fails", async () => {
    updateKickoffCoachMutateAsync.mockRejectedValue(new Error("nope"));
    render(<Partners />);

    fireEvent.click(screen.getByTestId("button-edit-kickoff-coach-7"));
    await screen.findByTestId("dialog-kickoff-coach-form");
    fireEvent.click(screen.getByTestId("button-save-kickoff-coach"));

    await waitFor(() =>
      expect(updateKickoffCoachMutateAsync).toHaveBeenCalled(),
    );
    expect(
      screen.getByTestId("dialog-kickoff-coach-form"),
    ).toBeInTheDocument();
  });
});
