import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CommunityApiError } from "@/lib/community-api";

// Guards the member-facing upgrade gate. When the posts request returns 403
// (the member's plan doesn't include community access), CommunityFeed must show
// the "Community Access Required" PaywallCard with a "View Plans & Upgrade" link
// to /plans — never the feed itself. A refactor of the error handling could
// silently expose the feed to members who shouldn't see it, or break the
// upgrade prompt; this test is here to catch exactly that regression class.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/community/post-composer", () => ({
  PostComposer: () => <div data-testid="post-composer-stub" />,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 999, role: "member" } }),
}));

const useCommunityCategories = vi.fn();
const useCommunityPosts = vi.fn();
const noopMutation = { mutate: vi.fn(), isPending: false };
vi.mock("@/hooks/use-community", () => ({
  useCommunityCategories: () => useCommunityCategories(),
  useCommunityPosts: () => useCommunityPosts(),
  useToggleReaction: () => noopMutation,
  useUpdatePost: () => noopMutation,
  useDeletePost: () => noopMutation,
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CommunityFeed from "@/pages/community/CommunityFeed";

function errorResult(error: unknown) {
  return {
    data: undefined,
    isLoading: false,
    error,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  };
}

beforeEach(() => {
  useCommunityCategories.mockReturnValue({ data: [], isLoading: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommunityFeed — community-access paywall", () => {
  it("renders the upgrade PaywallCard when posts return a 403 CommunityApiError", () => {
    useCommunityPosts.mockReturnValue(
      errorResult(new CommunityApiError("Community access requires an upgrade", 403)),
    );

    render(<CommunityFeed />);

    // The paywall heading and upgrade copy must show.
    expect(screen.getByText("Community Access Required")).toBeInTheDocument();

    // The upgrade CTA links to the plans page.
    const upgradeLink = screen.getByRole("link", { name: /view plans & upgrade/i });
    expect(upgradeLink).toHaveAttribute("href", "/plans");

    // The feed itself must NOT render for a gated member.
    expect(screen.queryByTestId("post-composer-stub")).not.toBeInTheDocument();
  });

  it("does not show the paywall for a non-403 error (e.g. 500)", () => {
    useCommunityPosts.mockReturnValue(
      errorResult(new CommunityApiError("Server error", 500)),
    );

    render(<CommunityFeed />);

    // A generic server error is not an access problem — the upgrade gate
    // must stay hidden and the normal feed UI (composer) renders.
    expect(screen.queryByText("Community Access Required")).not.toBeInTheDocument();
    expect(screen.getByTestId("post-composer-stub")).toBeInTheDocument();
  });
});
