import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CommunityApiError } from "@/lib/community-api";

// Guards the member-facing upgrade gate on the Members directory. The directory
// reuses the same community API as the main feed, so when the members request
// returns 403 (the member's plan doesn't include community access),
// MemberDirectory must show the "Community Access Required" PaywallCard with a
// "View Plans & Upgrade" link to /plans — never the member list itself. This
// test mirrors CommunityFeed.paywall.test.tsx to catch the same regression
// class on the sibling page.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/community/MemberCard", () => ({
  MemberCard: () => <div data-testid="member-card-stub" />,
}));

const useCommunityMembers = vi.fn();
vi.mock("@/hooks/use-community", () => ({
  useCommunityMembers: (params: unknown) => useCommunityMembers(params),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import MemberDirectory from "@/pages/community/MemberDirectory";

function membersResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: undefined,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("MemberDirectory — community-access paywall", () => {
  it("renders the upgrade PaywallCard when members return a 403 CommunityApiError", () => {
    useCommunityMembers.mockReturnValue(
      membersResult({
        error: new CommunityApiError("Community access requires an upgrade", 403),
      }),
    );

    render(<MemberDirectory />);

    // The paywall heading and upgrade copy must show.
    expect(screen.getByText("Community Access Required")).toBeInTheDocument();

    // The upgrade CTA links to the plans page.
    const upgradeLink = screen.getByRole("link", { name: /view plans & upgrade/i });
    expect(upgradeLink).toHaveAttribute("href", "/plans");

    // The member list must NOT render for a gated member.
    expect(screen.queryByTestId("member-card-stub")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search members...")).not.toBeInTheDocument();
  });

  it("does not show the paywall for a non-403 error (e.g. 500)", () => {
    useCommunityMembers.mockReturnValue(
      membersResult({ error: new CommunityApiError("Server error", 500) }),
    );

    render(<MemberDirectory />);

    // A generic server error is not an access problem — the upgrade gate
    // must stay hidden and the normal directory UI (search box) renders.
    expect(screen.queryByText("Community Access Required")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search members...")).toBeInTheDocument();
  });
});
