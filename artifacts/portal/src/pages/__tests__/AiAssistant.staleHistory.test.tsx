import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { renderHook, waitFor } from "@testing-library/react";
import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/assistant/AssistantEmptyState", () => ({
  AssistantEmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Test Member", role: "member" },
    hasPermission: () => false,
  }),
}));

// Controllable knobs for the mocked chat-api hooks.
let mockLoadedMessages: any[] | undefined;
let mockIsStreaming = false;
let mockInitialMessages: any[] = [];
let lastStreamState: { messages: any[] } = { messages: [] };

vi.mock("@/lib/chat-api", async () => {
  const actual = await vi.importActual<any>("@/lib/chat-api");
  return {
    ...actual,
    useChatSessions: () => ({ data: [] }),
    useChatMessages: () => ({ data: mockLoadedMessages }),
    useDeleteSession: () => ({ mutate: vi.fn() }),
    useChatStream: () => {
      const [messages, setMessagesState] = useState<any[]>(mockInitialMessages);
      lastStreamState.messages = messages;
      const setMessages = useCallback(
        (updater: any) =>
          setMessagesState((prev) => (typeof updater === "function" ? updater(prev) : updater)),
        [],
      );
      return {
        messages,
        isStreaming: mockIsStreaming,
        sessionId: 7,
        error: null,
        sendMessage: vi.fn(),
        setMessages,
        setSessionId: vi.fn(),
        clearError: vi.fn(),
      };
    },
  };
});

import AiAssistant from "../AiAssistant";
import { useChatStream } from "@/lib/chat-api";

const msg = (id: number, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
  createdAt: new Date(2026, 0, id).toISOString(),
});

describe("AiAssistant — stale history re-hydration", () => {
  beforeEach(() => {
    mockLoadedMessages = undefined;
    mockIsStreaming = false;
    mockInitialMessages = [];
  });

  it("shows the stale cached copy first, then re-hydrates when the background refetch returns newer data", () => {
    // First paint: React Query hands back the stale cached history (2 msgs).
    mockLoadedMessages = [msg(1, "user", "old question"), msg(2, "assistant", "old answer")];
    const { rerender } = render(<AiAssistant />);
    expect(screen.getByText("old answer")).toBeInTheDocument();
    expect(screen.queryByText("new answer")).not.toBeInTheDocument();

    // Background refetch resolves with the full, current history (4 msgs).
    mockLoadedMessages = [
      msg(1, "user", "old question"),
      msg(2, "assistant", "old answer"),
      msg(3, "user", "new question"),
      msg(4, "assistant", "new answer"),
    ];
    rerender(<AiAssistant />);

    // The one-time hydration guard used to freeze on the stale copy; the
    // visible messages must now update to the fresh history.
    expect(screen.getByText("new answer")).toBeInTheDocument();
    expect(screen.getByText("new question")).toBeInTheDocument();
  });

  it("does not clobber an in-progress stream with a late-arriving history fetch", () => {
    mockIsStreaming = true;
    mockInitialMessages = [
      msg(1, "user", "streamed question"),
      { role: "assistant", content: "partial streamed rep" },
    ];
    // A late history fetch arrives mid-stream with MORE rows (e.g. another
    // device) — it must still not replace the live stream.
    mockLoadedMessages = [
      msg(1, "user", "a"),
      msg(2, "assistant", "b"),
      msg(3, "user", "c"),
    ];
    render(<AiAssistant />);

    expect(screen.getByText("partial streamed rep")).toBeInTheDocument();
    expect(lastStreamState.messages).toHaveLength(2);
  });

  it("never shrinks: keeps local messages when the fetched history has fewer (local is newer)", () => {
    mockInitialMessages = [
      msg(1, "user", "q1"),
      msg(2, "assistant", "a1"),
      msg(3, "user", "q2"),
      msg(4, "assistant", "a2 just streamed"),
    ];
    // Fetch predates the just-streamed exchange.
    mockLoadedMessages = [msg(1, "user", "q1"), msg(2, "assistant", "a1")];
    render(<AiAssistant />);

    expect(screen.getByText("a2 just streamed")).toBeInTheDocument();
    expect(lastStreamState.messages).toHaveLength(4);
  });
});

describe("useChatStream — cache sync after a streamed exchange", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function sseResponse(lines: string[]) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(lines.map((l) => `data: ${l}\n`).join("")));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  it("invalidates the conversation's messages cache when the stream completes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    global.fetch = vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({ sessionId: 42 }),
        JSON.stringify({ content: "hello there" }),
        JSON.stringify({ done: true }),
      ]),
    );

    const actual = await vi.importActual<typeof import("@/lib/chat-api")>("@/lib/chat-api");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => actual.useChatStream(), { wrapper });

    await act(async () => {
      await result.current.sendMessage("hi", null);
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["chat", "messages", 42]);
    // The streamed reply landed in local state too.
    expect(result.current.messages.at(-1)?.content).toBe("hello there");
  });
});
