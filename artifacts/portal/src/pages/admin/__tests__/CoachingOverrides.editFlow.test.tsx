import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/components/layout/CoachingAdminLayout", () => ({
  CoachingAdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="coaching-admin-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const createOverride = vi.fn();
const updateOverride = vi.fn();
const deleteOverride = vi.fn();
const useCoachingCoaches = vi.fn();
const useCoachingCoach = vi.fn();

vi.mock("@/lib/coaching-admin-api", () => ({
  coachingAdminApi: {
    createOverride: (...args: unknown[]) => createOverride(...args),
    updateOverride: (...args: unknown[]) => updateOverride(...args),
    deleteOverride: (...args: unknown[]) => deleteOverride(...args),
  },
  useCoachingCoaches: () => useCoachingCoaches(),
  useCoachingCoach: (id: number) => useCoachingCoach(id),
}));

import CoachingOverrides from "@/pages/admin/CoachingOverrides";

const COACH_ID = 3;
const OVERRIDE_ID = 7;

const existingOverride = {
  id: OVERRIDE_ID,
  coachId: COACH_ID,
  overrideDate: "2026-07-01",
  overrideType: "extra",
  startTime: "09:00",
  endTime: "12:00",
  sessionDurationMinutes: 45,
  bufferMinutes: 10,
  reason: "Extra hours",
};

const coachDetail = {
  id: COACH_ID,
  name: "Coach Jane",
  bio: "",
  photoUrl: null,
  specialties: "",
  callTypes: [],
  oneOnOneEnabled: true,
  meetLink: null,
  timezone: "UTC",
  maxDailySessions: 5,
  availability: [],
  overrides: [existingOverride],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CoachingOverrides />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createOverride.mockReset();
  updateOverride.mockReset();
  deleteOverride.mockReset();
  useCoachingCoaches.mockReset();
  useCoachingCoach.mockReset();

  updateOverride.mockResolvedValue({ ...existingOverride, bufferMinutes: 25 });
  useCoachingCoaches.mockReturnValue({
    data: [
      { id: COACH_ID, name: "Coach Jane", oneOnOneEnabled: true },
    ],
  });
  useCoachingCoach.mockImplementation((id: number) => ({
    data: id > 0 ? coachDetail : undefined,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function selectCoach() {
  // Only the coach picker is rendered at this point (the dialog is closed),
  // so the single combobox is the coach <Select> trigger.
  const trigger = await screen.findByRole("combobox");
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByText("Coach Jane"));
}

describe("CoachingOverrides — edit existing override", () => {
  it("opens the dialog pre-filled and in edit mode", async () => {
    renderPage();
    await selectCoach();

    await userEvent.click(
      await screen.findByTestId(`button-edit-override-${OVERRIDE_ID}`),
    );

    const dialog = await screen.findByRole("dialog");
    // Title and primary button switch to edit-mode copy.
    expect(within(dialog).getByText("Edit Override")).toBeInTheDocument();
    expect(within(dialog).getByText("Save Changes")).toBeInTheDocument();
    expect(within(dialog).queryByText("Add Override")).not.toBeInTheDocument();

    // Dialog is pre-filled with the override's current values.
    expect(within(dialog).getByDisplayValue("2026-07-01")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Extra hours")).toBeInTheDocument();
    const numberInputs = within(dialog).getAllByRole("spinbutton");
    // [session length, buffer]
    expect(numberInputs[0]).toHaveValue(45);
    expect(numberInputs[1]).toHaveValue(10);
  });

  it("Save calls updateOverride(id, ...) with the changed buffer and never createOverride", async () => {
    renderPage();
    await selectCoach();

    await userEvent.click(
      await screen.findByTestId(`button-edit-override-${OVERRIDE_ID}`),
    );

    const dialog = await screen.findByRole("dialog");
    const bufferInput = within(dialog).getAllByRole("spinbutton")[1];
    await userEvent.clear(bufferInput);
    await userEvent.type(bufferInput, "25");

    await userEvent.click(within(dialog).getByText("Save Changes"));

    await waitFor(() => {
      expect(updateOverride).toHaveBeenCalledTimes(1);
    });
    expect(updateOverride).toHaveBeenCalledWith(
      OVERRIDE_ID,
      expect.objectContaining({ id: OVERRIDE_ID, bufferMinutes: 25 }),
    );
    expect(createOverride).not.toHaveBeenCalled();
  });
});
