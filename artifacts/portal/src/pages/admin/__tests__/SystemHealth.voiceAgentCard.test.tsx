import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useSearch: () => "",
  useLocation: () => ["/admin/system", () => {}],
}));

const getSystemHealth = vi.fn();
const getYsePendingGrants = vi.fn();
const getQueueFallbackEvents = vi.fn();
const getQueueFallbackAlertEvents = vi.fn();
const getQueueFallbackAlerterHealth = vi.fn();
const getOnCallDestinationsHistory = vi.fn();
const recheckVoiceAgentHealth = vi.fn();

vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getSystemHealth: (...args: unknown[]) => getSystemHealth(...args),
    getYsePendingGrants: (...args: unknown[]) => getYsePendingGrants(...args),
    getQueueFallbackEvents: (...args: unknown[]) =>
      getQueueFallbackEvents(...args),
    getQueueFallbackAlertEvents: (...args: unknown[]) =>
      getQueueFallbackAlertEvents(...args),
    getQueueFallbackAlerterHealth: (...args: unknown[]) =>
      getQueueFallbackAlerterHealth(...args),
    getOnCallDestinationsHistory: (...args: unknown[]) =>
      getOnCallDestinationsHistory(...args),
    recheckVoiceAgentHealth: (...args: unknown[]) =>
      recheckVoiceAgentHealth(...args),
  },
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import SystemHealth from "@/pages/admin/SystemHealth";

interface VoiceAgentOverrides {
  status?: "healthy" | "misconfigured" | "not_configured" | "unknown";
  needsAttention?: boolean;
  detail?: string;
  agentResponseEngineType?: string | null;
  requiresAgentIdUpdate?: boolean;
  newAgentId?: string | null;
  ranAt?: string | null;
}

function buildHealth(voice: VoiceAgentOverrides) {
  const voiceAgent = {
    status: voice.status ?? "healthy",
    needsAttention: voice.needsAttention ?? false,
    detail: voice.detail ?? "Agent is correctly wired to the KB engine.",
    agentResponseEngineType: voice.agentResponseEngineType ?? "retell-llm",
    requiresAgentIdUpdate: voice.requiresAgentIdUpdate ?? false,
    newAgentId: voice.newAgentId ?? null,
    ranAt: voice.ranAt ?? new Date().toISOString(),
  };
  return {
    status: voiceAgent.needsAttention ? "degraded" : "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      voiceAgent,
      missingCriticalSecrets: [],
    },
    webhooks: { last24h: 0, failed24h: 0 },
    auditLogs: { last24h: [] },
    serverTime: new Date().toISOString(),
  };
}

beforeEach(() => {
  getSystemHealth.mockReset();
  getYsePendingGrants.mockReset();
  getQueueFallbackEvents.mockReset();
  getQueueFallbackAlertEvents.mockReset();
  getQueueFallbackAlerterHealth.mockReset();
  getOnCallDestinationsHistory.mockReset();
  recheckVoiceAgentHealth.mockReset();
  toastSpy.mockReset();

  getYsePendingGrants.mockResolvedValue({ items: [] });
  getQueueFallbackEvents.mockResolvedValue({ events: [] });
  getQueueFallbackAlertEvents.mockResolvedValue({ events: [], stats: null });
  getQueueFallbackAlerterHealth.mockResolvedValue({
    channels: [],
    throttles: [],
    throttleSource: "memory",
    alertingSource: "memory",
  });
  getOnCallDestinationsHistory.mockResolvedValue({ events: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemHealth — Voice Assistant agent health banner + card", () => {
  it("renders the red banner and a needs-attention card when the agent is misconfigured", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "misconfigured",
        needsAttention: true,
        detail:
          'Agent is on "conversation_flow" engine with substantial Conversation Flow logic — manual review required.',
        agentResponseEngineType: "conversation_flow",
      }),
    );

    render(<SystemHealth />);

    const banner = await screen.findByTestId("voice-agent-banner");
    expect(banner).toHaveTextContent(/pointing at a broken agent/i);

    const card = await screen.findByTestId("card-voice-agent");
    expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
      /needs attention/i,
    );
    expect(within(card).getByTestId("voice-agent-warning")).toBeInTheDocument();
    expect(within(card).getByText("conversation_flow")).toBeInTheDocument();
  });

  it("surfaces the RETELL_AGENT_ID update instruction when a new agent was created", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "misconfigured",
        needsAttention: true,
        detail: "Retell API blocked in-place engine-type change — created new agent.",
        requiresAgentIdUpdate: true,
        newAgentId: "agent_new999",
      }),
    );

    render(<SystemHealth />);

    const banner = await screen.findByTestId("voice-agent-banner");
    expect(banner).toHaveTextContent("agent_new999");

    const card = await screen.findByTestId("card-voice-agent");
    expect(within(card).getByText("agent_new999")).toBeInTheDocument();
  });

  it("renders the card without the banner and a healthy badge when wired correctly", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({ status: "healthy", needsAttention: false }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-voice-agent");
    expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
      /healthy/i,
    );
    expect(
      within(card).queryByTestId("voice-agent-warning"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("voice-agent-banner")).not.toBeInTheDocument();
  });

  it("shows a not-configured badge and no banner when voice is intentionally off", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "not_configured",
        needsAttention: false,
        detail: "RETELL_API_KEY or RETELL_AGENT_ID not configured",
        agentResponseEngineType: null,
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-voice-agent");
    expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
      /not configured/i,
    );
    expect(screen.queryByTestId("voice-agent-banner")).not.toBeInTheDocument();
  });
});

describe("SystemHealth — Voice Assistant re-check button", () => {
  it("calls the recheck endpoint and patches the badge + detail in place", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "misconfigured",
        needsAttention: true,
        detail:
          'Agent is on "conversation_flow" engine — manual review required.',
        agentResponseEngineType: "conversation_flow",
      }),
    );
    recheckVoiceAgentHealth.mockResolvedValue({
      voiceAgent: {
        status: "healthy",
        needsAttention: false,
        detail: "Live check passed — agent is correctly wired.",
        agentResponseEngineType: "retell-llm",
        requiresAgentIdUpdate: false,
        newAgentId: null,
        ranAt: new Date().toISOString(),
      },
    });

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-voice-agent");
    expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
      /needs attention/i,
    );

    await userEvent.click(
      within(card).getByTestId("button-recheck-voice-agent"),
    );

    expect(recheckVoiceAgentHealth).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
        /healthy/i,
      );
    });
    expect(within(card).getByTestId("voice-agent-detail")).toHaveTextContent(
      /Live check passed/i,
    );
    expect(
      within(card).queryByTestId("voice-agent-warning"),
    ).not.toBeInTheDocument();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Voice Assistant re-checked" }),
    );
  });

  it("disables the button and shows an in-flight label while the re-check is pending", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({ status: "healthy", needsAttention: false }),
    );
    let resolveRecheck: (value: unknown) => void = () => {};
    recheckVoiceAgentHealth.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecheck = resolve;
        }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-voice-agent");
    const button = within(card).getByTestId("button-recheck-voice-agent");
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(/Re-check now/i);

    await userEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveTextContent(/Re-checking/i);

    resolveRecheck({
      voiceAgent: {
        status: "healthy",
        needsAttention: false,
        detail: "Live check passed.",
        agentResponseEngineType: "retell-llm",
        requiresAgentIdUpdate: false,
        newAgentId: null,
        ranAt: new Date().toISOString(),
      },
    });

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
    expect(button).toHaveTextContent(/Re-check now/i);
  });

  it("shows an error toast and leaves the verdict unchanged when the re-check fails", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        status: "healthy",
        needsAttention: false,
        detail: "Agent is correctly wired to the KB engine.",
      }),
    );
    recheckVoiceAgentHealth.mockRejectedValue(new Error("Retell API timed out"));

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-voice-agent");
    const button = within(card).getByTestId("button-recheck-voice-agent");

    await userEvent.click(button);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Error",
          description: "Retell API timed out",
          variant: "destructive",
        }),
      );
    });

    expect(within(card).getByTestId("voice-agent-status")).toHaveTextContent(
      /healthy/i,
    );
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
