import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
});
