import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";

const navigateMock = vi.fn();
const useParamsMock = vi.fn<() => Record<string, string>>(() => ({}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateMock],
  useParams: () => useParamsMock(),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const authStateMock = vi.fn(() => ({
  user: {
    id: 1,
    role: "member",
    onboardingComplete: true,
    onboardingStep: 5,
  },
  loading: false,
  logout: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => authStateMock(),
}));

// DM hooks
vi.mock("@/hooks/use-dm", () => ({
  useThreads: () => ({ data: [], isLoading: false }),
  useMessages: () => ({ data: [], isLoading: false }),
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkRead: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

// Community hooks
vi.mock("@/hooks/use-community", () => ({
  useCommunityCategories: () => ({ data: [], isLoading: false }),
  useCommunityPosts: () => ({
    data: { pages: [{ posts: [] }], pageParams: [] },
    isLoading: false,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useCommunityPost: () => ({ data: null, isLoading: true, error: null }),
  useToggleReaction: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePost: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePost: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Heavy community/dm sub-components are not the subject of this smoke test —
// stub them out so we can verify the route page itself mounts without crashing.
vi.mock("@/components/dm/thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
}));
vi.mock("@/components/dm/new-conversation-modal", () => ({
  NewConversationModal: () => null,
}));
vi.mock("@/components/dm/message-list", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/dm/message-composer", () => ({
  MessageComposer: () => <div data-testid="message-composer" />,
}));
vi.mock("@/components/community/PostCard", () => ({
  PostCard: () => <div data-testid="post-card" />,
}));
vi.mock("@/components/community/post-composer", () => ({
  PostComposer: () => <div data-testid="post-composer" />,
}));

import CommunityFeed from "@/pages/community/CommunityFeed";
import PostDetail from "@/pages/community/PostDetail";
import DMInbox from "@/pages/dm/inbox";
import DMThread from "@/pages/dm/thread";

beforeEach(() => {
  navigateMock.mockReset();
  useParamsMock.mockReset();
  useParamsMock.mockImplementation(() => ({}));
  authStateMock.mockImplementation(() => ({
    user: {
      id: 1,
      role: "member",
      onboardingComplete: true,
      onboardingStep: 5,
    },
    loading: false,
    logout: vi.fn(),
  }));
});

describe("Community and DM route pages — render smoke", () => {
  it("/community: CommunityFeed mounts without crashing", () => {
    const { getByTestId } = render(<CommunityFeed />);
    expect(getByTestId("app-layout")).toBeInTheDocument();
  });

  it("/community/:postId: PostDetail mounts with a postId param without crashing", () => {
    useParamsMock.mockImplementation(() => ({ postId: "42" }));
    const { getByTestId } = render(<PostDetail />);
    expect(getByTestId("app-layout")).toBeInTheDocument();
  });

  it("/dm: DMInbox mounts without crashing", () => {
    const { getByTestId } = render(<DMInbox />);
    expect(getByTestId("app-layout")).toBeInTheDocument();
  });

  it("/dm/:threadId: DMThread mounts with a threadId param without crashing", () => {
    useParamsMock.mockImplementation(() => ({ threadId: "7" }));
    const { getByTestId } = render(<DMThread />);
    expect(getByTestId("app-layout")).toBeInTheDocument();
  });

  it("/dm: DMInbox renders null for coach role (and does not crash)", () => {
    authStateMock.mockImplementation(() => ({
      user: {
        id: 2,
        role: "coach",
        onboardingComplete: true,
        onboardingStep: 5,
      },
      loading: false,
      logout: vi.fn(),
    }));
    const { container, queryByTestId } = render(<DMInbox />);
    expect(queryByTestId("app-layout")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("/dm/:threadId: DMThread renders null for coach role (and does not crash)", () => {
    useParamsMock.mockImplementation(() => ({ threadId: "7" }));
    authStateMock.mockImplementation(() => ({
      user: {
        id: 2,
        role: "coach",
        onboardingComplete: true,
        onboardingStep: 5,
      },
      loading: false,
      logout: vi.fn(),
    }));
    const { container, queryByTestId } = render(<DMThread />);
    expect(queryByTestId("app-layout")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
