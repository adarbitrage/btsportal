import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CoachingCallTemplate } from "@/lib/coaching-calls-admin-api";

vi.mock("@/components/layout/PackCoachingAdminLayout", () => ({
  PackCoachingAdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="pack-coaching-admin-layout-stub">{children}</div>
  ),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The page pulls templates + calls + coaches through these hooks. Only the
// templates list matters for the filter; everything else is stubbed empty.
const useCoachingCallTemplates = vi.fn();
const noopMutation = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock("@/lib/coaching-calls-admin-api", () => ({
  useAdminCoachingCalls: () => ({ data: { calls: [] }, isLoading: false }),
  useCoachingCallCoaches: () => ({ data: { coaches: [] } }),
  useCreateCoachingCall: () => noopMutation(),
  useUpdateCoachingCall: () => noopMutation(),
  useDeleteCoachingCall: () => noopMutation(),
  useCoachingCallTemplates: () => useCoachingCallTemplates(),
  useCreateCoachingCallTemplate: () => noopMutation(),
  useUpdateCoachingCallTemplate: () => noopMutation(),
  useDeleteCoachingCallTemplate: () => noopMutation(),
  useSetCoachingCallTemplateActive: () => noopMutation(),
}));

import CoachingCalls from "@/pages/admin/CoachingCalls";

function makeTemplate(
  overrides: Partial<CoachingCallTemplate> & { id: number },
): CoachingCallTemplate {
  return {
    title: `Template ${overrides.id}`,
    description: "",
    callType: "weekly_qa",
    coachId: 1,
    coachName: "Coach One",
    meetLink: null,
    durationMinutes: 60,
    requiredEntitlement: "coaching:group",
    intervalDays: 7,
    occurrencesPerBatch: 8,
    anchorAt: new Date(2026, 5, 22, 12, 0, 0).toISOString(),
    lastGeneratedAt: null,
    active: true,
    ...overrides,
  };
}

// Two active + one paused so each filter has a distinct, checkable result set.
const activeA = makeTemplate({ id: 1, title: "Monday Q&A", active: true });
const activeB = makeTemplate({ id: 2, title: "Wednesday Q&A", active: true });
const pausedC = makeTemplate({ id: 3, title: "Friday Q&A", active: false });

beforeEach(() => {
  useCoachingCallTemplates.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CoachingCalls — recurring schedule All/Active/Paused filter", () => {
  it("renders the filter control with correct All/Active/Paused counts", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [activeA, activeB, pausedC] },
    });

    render(<CoachingCalls />);

    const filter = screen.getByTestId("template-filter");
    expect(within(filter).getByTestId("template-filter-all")).toHaveTextContent(
      "All (3)",
    );
    expect(
      within(filter).getByTestId("template-filter-active"),
    ).toHaveTextContent("Active (2)");
    expect(
      within(filter).getByTestId("template-filter-paused"),
    ).toHaveTextContent("Paused (1)");
  });

  it("defaults to All — every template is visible", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [activeA, activeB, pausedC] },
    });

    render(<CoachingCalls />);

    expect(screen.getByTestId("template-1")).toBeInTheDocument();
    expect(screen.getByTestId("template-2")).toBeInTheDocument();
    expect(screen.getByTestId("template-3")).toBeInTheDocument();
    expect(
      screen.queryByTestId("template-filter-empty"),
    ).not.toBeInTheDocument();
  });

  it("shows only paused templates when Paused is selected", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [activeA, activeB, pausedC] },
    });

    render(<CoachingCalls />);

    fireEvent.click(screen.getByTestId("template-filter-paused"));

    expect(screen.getByTestId("template-3")).toBeInTheDocument();
    expect(
      screen.getByTestId("template-paused-badge-3"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("template-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("template-2")).not.toBeInTheDocument();
  });

  it("shows only active templates when Active is selected", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [activeA, activeB, pausedC] },
    });

    render(<CoachingCalls />);

    fireEvent.click(screen.getByTestId("template-filter-active"));

    expect(screen.getByTestId("template-1")).toBeInTheDocument();
    expect(screen.getByTestId("template-2")).toBeInTheDocument();
    expect(screen.queryByTestId("template-3")).not.toBeInTheDocument();
  });

  it("shows the contextual empty state when Paused matches nothing", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [activeA, activeB] },
    });

    render(<CoachingCalls />);

    fireEvent.click(screen.getByTestId("template-filter-paused"));

    const empty = screen.getByTestId("template-filter-empty");
    expect(empty).toHaveTextContent(/no paused schedules/i);
    expect(screen.queryByTestId("template-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("template-2")).not.toBeInTheDocument();
  });

  it("shows the contextual empty state when Active matches nothing", () => {
    useCoachingCallTemplates.mockReturnValue({
      data: { templates: [pausedC] },
    });

    render(<CoachingCalls />);

    fireEvent.click(screen.getByTestId("template-filter-active"));

    const empty = screen.getByTestId("template-filter-empty");
    expect(empty).toHaveTextContent(/no active schedules/i);
    expect(screen.queryByTestId("template-3")).not.toBeInTheDocument();
  });
});
