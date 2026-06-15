import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CommunityPost } from "@/lib/community-api";

// Guards the member-facing "Pinned" highlight (Pinned badge + pinned posts
// sorted above the regular list). A refactor of CommunityFeed.tsx or
// PostCard.tsx could silently drop the Pinned badge or mis-sort pinned posts
// into the regular list — the exact regression class this test is here to
// catch. We render the real CommunityFeed and real PostCard, mocking only the
// data hooks and the heavy presentational children of PostCard.

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/community/post-composer", () => ({
  PostComposer: () => <div data-testid="post-composer-stub" />,
}));

vi.mock("@/components/community/CommentThread", () => ({
  CommentThread: () => <div data-testid="comment-thread-stub" />,
}));

vi.mock("@/components/community/ProfilePopover", () => ({
  ProfilePopover: ({ children }: { children: ReactNode }) => <>{children}</>,
  AuthorAvatar: () => <div data-testid="avatar-stub" />,
}));

vi.mock("@/components/community/TierBadge", () => ({
  TierBadge: () => <span data-testid="tier-badge-stub" />,
  EngagementBadge: () => <span data-testid="engagement-badge-stub" />,
}));

vi.mock("@/components/community/reaction-button", () => ({
  ReactionButton: () => <button type="button" data-testid="reaction-stub" />,
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

function makePost(overrides: Partial<CommunityPost>): CommunityPost {
  return {
    id: 0,
    author: { id: 1, name: "Author", avatarUrl: null, highestProductSlug: "free", badges: [] } as CommunityPost["author"],
    categoryId: 1,
    categorySlug: "general",
    categoryName: "General",
    title: "Title",
    body: "Body",
    imageUrl: null,
    isPinned: false,
    isFeatured: false,
    reactionCount: 0,
    hasReacted: false,
    commentCount: 0,
    isEdited: false,
    isDeleted: false,
    status: "active",
    createdAt: new Date(2026, 0, 1).toISOString(),
    updatedAt: new Date(2026, 0, 1).toISOString(),
    comments: [],
    ...overrides,
  };
}

function postsResult(posts: CommunityPost[]) {
  return {
    data: { pages: [{ posts, nextCursor: null }] },
    isLoading: false,
    error: null,
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

describe("CommunityFeed — pinned highlight", () => {
  it("renders the Pinned badge for a pinned (non-featured) post", () => {
    const pinned = makePost({ id: 101, title: "Pinned post", isPinned: true });
    useCommunityPosts.mockReturnValue(postsResult([pinned]));

    render(<CommunityFeed />);

    const badge = screen.getByTestId("badge-pinned-post-101");
    expect(badge).toHaveTextContent(/pinned/i);
  });

  it("sorts a pinned post above regular (non-pinned, non-featured) posts", () => {
    // Supply the regular post first to prove ordering is driven by the
    // pinned/regular split, not the incoming array order.
    const regular = makePost({ id: 303, title: "Regular post" });
    const pinned = makePost({ id: 101, title: "Pinned post", isPinned: true });
    useCommunityPosts.mockReturnValue(postsResult([regular, pinned]));

    render(<CommunityFeed />);

    const pinnedHeading = screen.getByText("Pinned post");
    const regularHeading = screen.getByText("Regular post");

    // The pinned post must appear before the regular post in the DOM.
    expect(
      pinnedHeading.compareDocumentPosition(regularHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not duplicate a pinned post into the regular list", () => {
    const pinned = makePost({ id: 101, title: "Pinned post", isPinned: true });
    const regular = makePost({ id: 303, title: "Regular post" });
    useCommunityPosts.mockReturnValue(postsResult([pinned, regular]));

    render(<CommunityFeed />);

    // Exactly one Pinned badge for the pinned post — no duplicate render.
    expect(screen.getAllByTestId("badge-pinned-post-101")).toHaveLength(1);

    // The regular post must never carry a Pinned badge.
    expect(screen.queryByTestId("badge-pinned-post-303")).not.toBeInTheDocument();
  });
});
