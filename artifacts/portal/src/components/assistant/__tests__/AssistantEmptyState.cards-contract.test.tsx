import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssistantCardGroup } from "@/lib/assistant-cards-api";

const mockUseAssistantCards = vi.fn();

vi.mock("@/hooks/use-assistant-cards", () => ({
  useAssistantCards: () => mockUseAssistantCards(),
}));

import { AssistantEmptyState } from "@/components/assistant/AssistantEmptyState";

const SERVER_FIXTURE: AssistantCardGroup[] = [
  {
    id: 1,
    name: "Marketing",
    description: "Marketing strategies and tools",
    icon: "📣",
    sortOrder: 1,
    cards: [
      {
        id: 101,
        groupId: 1,
        title: "Email Campaigns",
        description: "Best practices for email marketing",
        icon: "✉️",
        locked: false,
        upgradeProduct: null,
        questions: [
          { id: 1001, cardId: 101, body: "How do I write a great subject line?", sortOrder: 1 },
          { id: 1002, cardId: 101, body: "What is the best time to send emails?", sortOrder: 2 },
        ],
      },
      {
        id: 102,
        groupId: 1,
        title: "Advanced Funnels",
        description: "High-converting sales funnels",
        icon: "🔮",
        locked: true,
        upgradeProduct: {
          id: 5,
          name: "Reserve Income Pro",
          priceDisplay: "$97/mo",
        },
        questions: [],
      },
    ],
  },
  {
    id: 2,
    name: "Tools",
    description: "Platform tools",
    icon: "🛠️",
    sortOrder: 2,
    cards: [
      {
        id: 201,
        groupId: 2,
        title: "Automation",
        description: "Set up powerful automations",
        icon: "⚡",
        locked: false,
        upgradeProduct: null,
        questions: [
          { id: 2001, cardId: 201, body: "How do I create an automation?", sortOrder: 1 },
        ],
      },
    ],
  },
];

beforeEach(() => {
  mockUseAssistantCards.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AssistantEmptyState — server payload contract", () => {
  it("renders group headings from the real server shape (name, not group)", async () => {
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Marketing")).toBeInTheDocument();
      expect(screen.getByText("Tools")).toBeInTheDocument();
    });
  });

  it("renders card titles (title, not label)", async () => {
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Email Campaigns")).toBeInTheDocument();
      expect(screen.getByText("Advanced Funnels")).toBeInTheDocument();
      expect(screen.getByText("Automation")).toBeInTheDocument();
    });
  });

  it("clicking an unlocked card shows its question list using body field", async () => {
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    const cardButton = await screen.findByTestId("button-card-101");
    await user.click(cardButton);

    await waitFor(() => {
      expect(screen.getByText("How do I write a great subject line?")).toBeInTheDocument();
      expect(screen.getByText("What is the best time to send emails?")).toBeInTheDocument();
    });
  });

  it("clicking a question fires onSendMessage with the question body", async () => {
    const onSendMessage = vi.fn();
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    render(<AssistantEmptyState onSendMessage={onSendMessage} />);

    const cardButton = await screen.findByTestId("button-card-101");
    await user.click(cardButton);

    const questionButton = await screen.findByTestId("button-question-1001");
    await user.click(questionButton);

    expect(onSendMessage).toHaveBeenCalledWith("How do I write a great subject line?");
  });

  it("clicking a locked card opens the upgrade modal with product name and price", async () => {
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    const lockedCard = await screen.findByTestId("button-card-102");
    await user.click(lockedCard);

    await waitFor(() => {
      expect(screen.getAllByText(/Reserve Income Pro/).length).toBeGreaterThan(0);
      expect(screen.getByText("$97/mo")).toBeInTheDocument();
    });

    expect(screen.getByTestId("button-upgrade-102")).toBeDisabled();
  });

  it("upgrade modal close button dismisses the modal", async () => {
    mockUseAssistantCards.mockReturnValue({
      data: SERVER_FIXTURE,
      isLoading: false,
      isError: false,
    });

    const user = userEvent.setup();
    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    const lockedCard = await screen.findByTestId("button-card-102");
    await user.click(lockedCard);

    await screen.findByTestId("button-upgrade-modal-close");
    await user.click(screen.getByTestId("button-upgrade-modal-close"));

    await waitFor(() => {
      expect(screen.queryByTestId("button-upgrade-modal-close")).not.toBeInTheDocument();
    });
  });

  it("shows loading skeleton while data is loading", () => {
    mockUseAssistantCards.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    expect(screen.queryByText("Marketing")).not.toBeInTheDocument();
  });

  it("shows error fallback when the request fails", () => {
    mockUseAssistantCards.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<AssistantEmptyState onSendMessage={vi.fn()} />);

    expect(screen.getByText(/Suggestions unavailable/i)).toBeInTheDocument();
  });
});
