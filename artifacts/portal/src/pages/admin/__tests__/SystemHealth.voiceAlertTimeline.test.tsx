import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import SystemHealth from "@/pages/admin/SystemHealth";

function buildHealth() {
  return {
    status: "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      voiceAgent: {
        status: "healthy",
        needsAttention: false,
        detail: "Agent is correctly wired to the KB engine.",
        agentResponseEngineType: "retell-llm",
        requiresAgentIdUpdate: false,
        newAgentId: null,
        ranAt: new Date().toISOString(),
      },
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

  getSystemHealth.mockResolvedValue(buildHealth());
  getYsePendingGrants.mockResolvedValue({ items: [] });
  getQueueFallbackEvents.mockResolvedValue({ events: [] });
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

describe("SystemHealth — voice-assistant alert timeline row", () => {
  it("labels the source 'Voice assistant' and links the row to the Voice Assistant panel", async () => {
    const voiceEvent = {
      id: 90210,
      createdAt: new Date().toISOString(),
      actionType: "retell_agent_alert",
      queueChannel: null,
      deliveryChannel: "pagerduty",
      kind: "fire",
      outcome: "failed",
      reason: "Agent pointing at a broken conversation_flow engine",
      description: "Voice assistant alert fired",
      metadata: {},
    };
    getQueueFallbackAlertEvents.mockResolvedValue({
      events: [voiceEvent],
      stats: null,
    });

    render(<SystemHealth />);

    const row = await screen.findByTestId(`alert-event-row-${voiceEvent.id}`);

    // Source column labels the alerter "Voice assistant" (no queueChannel, so
    // it falls back to the actionType-derived source label).
    expect(
      within(row).getByTestId(`alert-event-source-${voiceEvent.id}`),
    ).toHaveTextContent("Voice assistant");

    // The per-row detail link deep-links to the Voice Assistant panel on this
    // same page via the in-page #voice-agent hash.
    const link = within(row).getByTestId(`link-alert-audit-${voiceEvent.id}`);
    expect(link).toHaveAttribute("href", "#voice-agent");
    expect(link).toHaveTextContent("Voice panel");
  });
});
