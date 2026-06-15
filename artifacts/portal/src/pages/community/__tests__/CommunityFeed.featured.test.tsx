import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CommunityPost } from "@/lib/community-api";

// Guards the member-facing "Featured" highlight added for the is_featured flag.
// A refactor of CommunityFeed.tsx or PostCard.tsx could silently drop the
// Featured strip or the Featured badge — the exact regression class this test
// is here to catch. We render the real CommunityFeed and real PostCard, mocking
// only the data hooks and the heavy presentational children of PostCard.

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
    author: { id: 1, name: "Author", avatarUrl: null, highestProductSlug: null } as CommunityPost["author"],
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

describe("CommunityFeed — featured highlight", () => {
  it("renders a featured post inside the Featured strip with the Featured badge", () => {
    const featured = makePost({ id: 101, title: "Featured post", isFeatured: true });
    useCommunityPosts.mockReturnValue(postsResult([featured]));

    render(<CommunityFeed />);

    const strip = screen.getByTestId("featured-strip");
    const badge = screen.getByTestId("badge-featured-post-101");

    // The badge must live inside the Featured strip, not somewhere else.
    expect(within(strip).getByTestId("badge-featured-post-101")).toBe(badge);
    expect(badge).toHaveTextContent(/featured/i);
  });

  it("does not duplicate a featured post into the pinned or regular lists", () => {
    // A post that is BOTH featured and pinned must appear exactly once (in the
    // Featured strip), never also in the pinned/regular sections.
    const featuredAndPinned = makePost({
      id: 202,
      title: "Featured and pinned",
      isFeatured: true,
      isPinned: true,
    });
    const regular = makePost({ id: 303, title: "Regular post" });
    useCommunityPosts.mockReturnValue(postsResult([featuredAndPinned, regular]));

    render(<CommunityFeed />);

    // Exactly one Featured badge for the featured post — no duplicate render.
    expect(screen.getAllByTestId("badge-featured-post-202")).toHaveLength(1);

    // The featured post lives inside the strip.
    const strip = screen.getByTestId("featured-strip");
    expect(within(strip).getByTestId("badge-featured-post-202")).toBeInTheDocument();

    // The regular post must never carry a Featured badge.
    expect(screen.queryByTestId("badge-featured-post-303")).not.toBeInTheDocument();
  });
});
