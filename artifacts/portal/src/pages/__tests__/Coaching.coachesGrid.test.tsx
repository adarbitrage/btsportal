import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Coach } from "@workspace/api-client-react";

// Guards the member-facing "Your Coaches" grid on the Coaching page. The grid
// was switched from a hardcoded list of names to the backend coaches API
// (useListCoaches). A refactor could silently regress back to stale hardcoded
// names, or drop the empty-state guard — exactly the regression class this test
// exists to catch. We render the real Coaching page, mocking only the data
// hooks. The Upcoming Calls / weekly schedule are covered separately in
// Coaching.upcomingCalls.test.tsx; here we keep them empty.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/coaching", navigate],
}));

const useListCoachingCalls = vi.fn();
const useGetCurrentMember = vi.fn();
const useListCoaches = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
  useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
  useListCoaches: (...args: unknown[]) => useListCoaches(...args),
}));

import Coaching from "@/pages/Coaching";

function makeCoach(overrides: Partial<Coach>): Coach {
  return {
    id: 0,
    name: "Coach Name",
    bio: "",
    photoUrl: null,
    specialties: "",
    ...overrides,
  };
}

beforeEach(() => {
  navigate.mockReset();
  useListCoachingCalls.mockReset();
  useGetCurrentMember.mockReset();
  useListCoaches.mockReset();
  // The coaches grid is the focus here; keep the calls sections empty so they
  // don't render and clutter the assertions.
  useListCoachingCalls.mockReturnValue({ data: [] });
  useGetCurrentMember.mockReturnValue({ data: { entitlements: [] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — Your Coaches grid", () => {
  it("renders a card per coach returned by the API, with names and derived initials", () => {
    const coaches = [
      makeCoach({ id: 1, name: "Sarah Mitchell" }),
      makeCoach({ id: 2, name: "Bruce Cherrington" }),
      makeCoach({ id: 3, name: "Sasha" }),
    ];
    useListCoaches.mockReturnValue({ data: coaches });

    render(<Coaching />);

    expect(
      screen.getByRole("heading", { name: /your coaches/i }),
    ).toBeInTheDocument();

    // Each coach renders its own card showing the API-provided name and the
    // initials derived from that name.
    const sarah = screen.getByTestId("coach-1");
    expect(within(sarah).getByText("Sarah Mitchell")).toBeInTheDocument();
    expect(within(sarah).getByText("SM")).toBeInTheDocument();

    const bruce = screen.getByTestId("coach-2");
    expect(within(bruce).getByText("Bruce Cherrington")).toBeInTheDocument();
    expect(within(bruce).getByText("BC")).toBeInTheDocument();

    // A single-word name derives the first two letters, uppercased.
    const sasha = screen.getByTestId("coach-3");
    expect(within(sasha).getByText("Sasha")).toBeInTheDocument();
    expect(within(sasha).getByText("SA")).toBeInTheDocument();
  });

  it("derives initials from the first and last word when a coach has a middle name", () => {
    useListCoaches.mockReturnValue({
      data: [makeCoach({ id: 5, name: "Mary Jane Watson" })],
    });

    render(<Coaching />);

    const card = screen.getByTestId("coach-5");
    expect(within(card).getByText("Mary Jane Watson")).toBeInTheDocument();
    expect(within(card).getByText("MW")).toBeInTheDocument();
  });

  it("hides the Your Coaches section when the API returns no coaches", () => {
    useListCoaches.mockReturnValue({ data: [] });

    render(<Coaching />);

    expect(
      screen.queryByRole("heading", { name: /your coaches/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the Your Coaches section while the coaches are still loading", () => {
    useListCoaches.mockReturnValue({ data: undefined });

    render(<Coaching />);

    expect(
      screen.queryByRole("heading", { name: /your coaches/i }),
    ).not.toBeInTheDocument();
  });
});
