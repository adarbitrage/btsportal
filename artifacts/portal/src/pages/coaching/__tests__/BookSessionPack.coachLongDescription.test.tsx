import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SessionCoach } from "@/lib/session-packs-api";

// Locks the bio split on the private-coaching booking page: the coach picker
// must render each coach's LONG description (`longBio`), never the short
// group-card `bio`. Coaches without a long description simply omit the
// paragraph (null-coalescing behavior).

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
  useLocation: () => ["/coaching/book-session/new", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const useSessionCoaches = vi.fn();
vi.mock("@/lib/session-packs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session-packs-api")>();
  return {
    ...actual,
    useSessionBalance: () => ({ data: { balance: 2 } }),
    useSessionCoaches: () => useSessionCoaches(),
    useSessionCoachSlots: () => ({ data: undefined, isLoading: false }),
    useSessionCoachBusy: () => ({ data: undefined }),
    useMySessionBookings: () => ({ data: [] }),
    useBookSessionPack: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRescheduleSessionBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

import BookSessionPack from "@/pages/coaching/BookSessionPack";

function makeCoach(overrides: Partial<SessionCoach>): SessionCoach {
  return {
    id: 1,
    name: "Michael",
    bio: "Short group-card blurb.",
    longBio: "A long, detailed private-coaching description of Michael.",
    photoUrl: null,
    sortOrder: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useSessionCoaches.mockReturnValue({ data: [], isLoading: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BookSessionPack — coach picker long description", () => {
  it("renders the LONG description on the coach card, not the short bio", () => {
    useSessionCoaches.mockReturnValue({
      data: [
        makeCoach({
          id: 7,
          name: "Michael",
          bio: "Short group blurb.",
          longBio: "Michael has spent a decade coaching private clients 1-on-1.",
        }),
      ],
      isLoading: false,
    });
    render(<BookSessionPack />);

    const card = screen.getByTestId("coach-card-7");
    expect(within(card).getByTestId("coach-long-bio-7")).toHaveTextContent(
      "Michael has spent a decade coaching private clients 1-on-1.",
    );
    expect(within(card).queryByText("Short group blurb.")).not.toBeInTheDocument();
  });

  it("omits the description paragraph when a coach has no long description", () => {
    useSessionCoaches.mockReturnValue({
      data: [makeCoach({ id: 8, name: "Bruce", longBio: null })],
      isLoading: false,
    });
    render(<BookSessionPack />);

    const card = screen.getByTestId("coach-card-8");
    expect(within(card).getByText("Bruce")).toBeInTheDocument();
    expect(within(card).queryByTestId("coach-long-bio-8")).not.toBeInTheDocument();
  });

  it("collapses long multi-sentence bios to two sentences with a Read more toggle", () => {
    const longBio =
      "Michael has coached for a decade. He specializes in paid traffic.\n\n" +
      "Before coaching, he ran his own agency for years and managed millions in ad spend across many client accounts.";
    useSessionCoaches.mockReturnValue({
      data: [makeCoach({ id: 9, longBio })],
      isLoading: false,
    });
    render(<BookSessionPack />);

    const bioEl = screen.getByTestId("coach-long-bio-9");
    expect(bioEl.textContent).toBe(
      "Michael has coached for a decade. He specializes in paid traffic....",
    );

    const toggle = screen.getByTestId("coach-bio-toggle-9");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("coach-long-bio-9").textContent).toBe(longBio);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Read less");
  });

  it("collapses long punctuation-free bios at a word boundary", () => {
    const longBio = Array(80).fill("word").join(" "); // 399 chars, no punctuation
    useSessionCoaches.mockReturnValue({
      data: [makeCoach({ id: 10, longBio })],
      isLoading: false,
    });
    render(<BookSessionPack />);

    const text = screen.getByTestId("coach-long-bio-10").textContent ?? "";
    expect(text.endsWith("...")).toBe(true);
    expect(text.length).toBeLessThan(longBio.length);
    expect(screen.getByTestId("coach-bio-toggle-10")).toBeInTheDocument();
  });

  it("shows short bios in full with no toggle", () => {
    useSessionCoaches.mockReturnValue({
      data: [makeCoach({ id: 11, longBio: "One short sentence." })],
      isLoading: false,
    });
    render(<BookSessionPack />);

    expect(screen.getByTestId("coach-long-bio-11").textContent).toBe(
      "One short sentence.",
    );
    expect(screen.queryByTestId("coach-bio-toggle-11")).not.toBeInTheDocument();
  });

  it("clicking Read more does not select the coach card", () => {
    const longBio =
      "Sentence one is here. Sentence two is here. Sentence three keeps going for a while longer.";
    useSessionCoaches.mockReturnValue({
      data: [makeCoach({ id: 12, longBio })],
      isLoading: false,
    });
    render(<BookSessionPack />);

    fireEvent.click(screen.getByTestId("coach-bio-toggle-12"));
    // Selecting a coach advances to step 2 ("Select Date & Time") — the
    // coach picker heading must still be present after toggling the bio.
    expect(screen.getByText("Choose Your Coach")).toBeInTheDocument();
    expect(screen.getByTestId("coach-card-12")).not.toHaveClass("ring-2");
  });
});
