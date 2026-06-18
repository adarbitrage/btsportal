import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Coach } from "@workspace/api-client-react";

// Guards the per-coach profile display in the "Your Coaches" grid: the photo
// (with an initials fallback when no photoUrl), the specialty, and the bio. A
// refactor of Coaching.tsx could silently drop any of these fields or break the
// photo/initials branch — exactly the regression class this test exists to
// catch. We render the real Coaching page, mocking only the data hooks. Names,
// initials derivation, and the empty-state are covered in
// Coaching.coachesGrid.test.tsx; here we keep the calls sections empty.

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

describe("Coaching — coach photo / specialty / bio display", () => {
  it("renders an <img> for a coach with a photoUrl (no initials fallback)", () => {
    useListCoaches.mockReturnValue({
      data: [
        makeCoach({
          id: 1,
          name: "Sarah Mitchell",
          photoUrl: "https://example.com/sarah.jpg",
        }),
      ],
    });

    render(<Coaching />);

    const card = screen.getByTestId("coach-1");
    const photo = within(card).getByTestId("coach-photo-1");
    expect(photo.tagName).toBe("IMG");
    expect(photo).toHaveAttribute("src", "https://example.com/sarah.jpg");
    expect(photo).toHaveAttribute("alt", "Sarah Mitchell");

    // With a photo present, the initials fallback must not render.
    expect(
      within(card).queryByTestId("coach-initials-1"),
    ).not.toBeInTheDocument();
  });

  it("renders the initials fallback for a coach without a photoUrl (no <img>)", () => {
    useListCoaches.mockReturnValue({
      data: [makeCoach({ id: 2, name: "Bruce Cherrington", photoUrl: null })],
    });

    render(<Coaching />);

    const card = screen.getByTestId("coach-2");
    const initials = within(card).getByTestId("coach-initials-2");
    expect(initials).toHaveTextContent("BC");

    // Without a photo, the <img> must not render.
    expect(within(card).queryByTestId("coach-photo-2")).not.toBeInTheDocument();
  });

  it("renders the specialty and bio when present", () => {
    useListCoaches.mockReturnValue({
      data: [
        makeCoach({
          id: 3,
          name: "Sasha",
          specialties: "Paid Traffic & Funnels",
          bio: "Ten years scaling DTC brands with paid acquisition.",
        }),
      ],
    });

    render(<Coaching />);

    const card = screen.getByTestId("coach-3");
    expect(within(card).getByTestId("coach-specialty-3")).toHaveTextContent(
      "Paid Traffic & Funnels",
    );
    expect(within(card).getByTestId("coach-bio-3")).toHaveTextContent(
      "Ten years scaling DTC brands with paid acquisition.",
    );
  });

  it("omits the specialty and bio when absent", () => {
    useListCoaches.mockReturnValue({
      data: [makeCoach({ id: 4, name: "Todd", specialties: "", bio: "" })],
    });

    render(<Coaching />);

    const card = screen.getByTestId("coach-4");
    expect(
      within(card).queryByTestId("coach-specialty-4"),
    ).not.toBeInTheDocument();
    expect(within(card).queryByTestId("coach-bio-4")).not.toBeInTheDocument();
  });
});
