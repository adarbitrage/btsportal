import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

const assistantTableMessage = {
  id: 1,
  role: "assistant" as const,
  content: [
    "Here are the plans:",
    "",
    "| Plan | Price |",
    "| --- | --- |",
    "| Starter | $49 |",
    "| Pro | $99 |",
  ].join("\n"),
};

vi.mock("@/lib/chat-api", () => ({
  useChatSessions: () => ({ data: [] }),
  useChatMessages: () => ({ data: undefined }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
  useCreateTicketFromChat: () => ({ mutate: vi.fn(), isPending: false }),
  useChatStream: () => ({
    messages: [
      { id: 0, role: "user" as const, content: "What plans are there?" },
      assistantTableMessage,
    ],
    isStreaming: false,
    sessionId: 7,
    error: null,
    suggestTicket: false,
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    setSessionId: vi.fn(),
    clearError: vi.fn(),
    dismissTicketSuggestion: vi.fn(),
  }),
}));

import AiAssistant from "../AiAssistant";

describe("AiAssistant — Markdown table rendering (GFM)", () => {
  it("renders a Markdown table in an assistant message as a real <table> with header + data cells", () => {
    render(<AiAssistant />);

    // GFM pipes must become a real table element, not raw text.
    const table = document.querySelector("table");
    expect(table).not.toBeNull();

    expect(screen.getByRole("columnheader", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "$99" })).toBeInTheDocument();

    // No raw pipe rows should remain in the rendered output.
    expect(document.body.textContent).not.toContain("| Plan | Price |");

    // Table sits inside the horizontal-scroll wrapper for mobile overflow.
    const wrapper = screen.getByTestId("chat-markdown-table-wrapper");
    expect(wrapper.querySelector("table")).toBe(table);
    expect(wrapper.className).toContain("overflow-x-auto");
  });
});
