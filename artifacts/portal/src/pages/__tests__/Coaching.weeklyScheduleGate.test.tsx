import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { MemberProfile } from "@workspace/api-client-react";

// Guards the hardcoded weekly "Live Coaching Calls 6 Days/Week" schedule on the
// Coaching page. Each recurring row gates its "Join Call" link behind the
// `coaching:group` entitlement (Task #989). Members WITHOUT it must see an
// "Unlock" CTA that deep-links to /plans?highlight=3month, and the shared
// meet.google.com link must NOT appear anywhere in the markup — otherwise a
// future refactor could silently re-expose the shared Meet link. Members WITH
// the entitlement must see a working "Join Call" link to the shared Meet link.
// The API/entitlement plumbing is covered separately; this is frontend-only.

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
vi.mock("@workspace/api-client-react", () => ({
  useListCoachingCalls: (...args: unknown[]) => useListCoachingCalls(...args),
  useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
}));

import Coaching from "@/pages/Coaching";

const SHARED_MEET_LINK = "https://meet.google.com/adz-axqj-pjm";
const UPGRADE_URL = "/plans?highlight=3month";

// There are 9 hardcoded recurring rows in `liveSchedule`.
const WEEKLY_ROW_COUNT = 9;

function makeMember(entitlements: string[]): MemberProfile {
  return {
    entitlements,
  } as unknown as MemberProfile;
}

beforeEach(() => {
  navigate.mockReset();
  useListCoachingCalls.mockReset();
  useGetCurrentMember.mockReset();
  // The weekly schedule is independent of the dynamic Upcoming Calls list, so
  // keep that section empty for these cases.
  useListCoachingCalls.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Coaching — weekly schedule entitlement gate", () => {
  it("shows Unlock CTAs (no Meet link) for a member WITHOUT coaching:group", async () => {
    useGetCurrentMember.mockReturnValue({ data: makeMember([]) });

    render(<Coaching />);

    // The shared Meet link must not leak anywhere in the markup.
    expect(
      screen.queryByRole("link", { name: /join call/i }),
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("meet.google.com");

    // Every recurring row shows an Unlock control instead.
    const unlockButtons = screen.getAllByRole("button", { name: /unlock/i });
    expect(unlockButtons).toHaveLength(WEEKLY_ROW_COUNT);

    // Clicking one deep-links to the 3-month mentorship upsell.
    await userEvent.click(unlockButtons[0]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(UPGRADE_URL);
  });

  it("shows working Join Call links for a member WITH coaching:group", () => {
    useGetCurrentMember.mockReturnValue({
      data: makeMember(["coaching:group"]),
    });

    render(<Coaching />);

    // No Unlock CTAs remain on the weekly schedule.
    expect(
      screen.queryByRole("button", { name: /unlock/i }),
    ).not.toBeInTheDocument();

    // Every recurring row links to the shared Meet link.
    const joinLinks = screen.getAllByRole("link", { name: /join call/i });
    expect(joinLinks).toHaveLength(WEEKLY_ROW_COUNT);
    for (const link of joinLinks) {
      expect(link).toHaveAttribute("href", SHARED_MEET_LINK);
    }
  });

  it("treats a still-loading member (undefined) as un-entitled", () => {
    useGetCurrentMember.mockReturnValue({ data: undefined });

    render(<Coaching />);

    expect(
      screen.queryByRole("link", { name: /join call/i }),
    ).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("meet.google.com");
    expect(screen.getAllByRole("button", { name: /unlock/i })).toHaveLength(
      WEEKLY_ROW_COUNT,
    );
  });
});
