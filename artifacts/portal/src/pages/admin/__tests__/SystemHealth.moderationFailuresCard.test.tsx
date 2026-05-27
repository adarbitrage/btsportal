import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

function buildHealth(overrides: {
  alerting: boolean;
  windowTotal?: number;
  engine?: number;
  persist?: number;
  lastError?: string | null;
  lastKind?: "engine" | "persist" | null;
}) {
  const {
    alerting,
    windowTotal = 3,
    engine = 1,
    persist = 2,
    lastError = "RangeError: persist write failed for post 42",
    lastKind = "persist",
  } = overrides;
  return {
    status: alerting ? "degraded" : "healthy",
    services: {
      api: { status: "up", uptime: 1 },
      database: { status: "up", totalUsers: 0, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, totalCount: 0 },
      },
      moderationFailures: {
        window: {
          totalCount: windowTotal,
          byKind: { engine, persist },
          lastAt: "2025-05-27T12:00:00.000Z",
          lastError,
          lastKind,
          windowMs: 15 * 60 * 1000,
        },
        cumulative: {
          totalCount: 10,
          byKind: { engine: 4, persist: 6 },
          lastAt: "2025-05-27T12:00:00.000Z",
        },
        alerter: {
          alerting,
          lastSeenWindowTotal: windowTotal,
          lastInWindowFailureAt: "2025-05-27T12:00:00.000Z",
        },
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

describe("SystemHealth — Background moderation failures card", () => {
  it("renders in-window total, per-kind counts, and last-error text", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        windowTotal: 5,
        engine: 2,
        persist: 3,
        lastError: "TypeError: cannot read property of undefined",
        lastKind: "engine",
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");
    expect(
      within(card).getByTestId("moderation-failures-window-total"),
    ).toHaveTextContent("5");
    expect(
      within(card).getByTestId("moderation-failures-window-engine"),
    ).toHaveTextContent("2");
    expect(
      within(card).getByTestId("moderation-failures-window-persist"),
    ).toHaveTextContent("3");
    expect(
      within(card).getByTestId("moderation-failures-last-error"),
    ).toHaveTextContent("TypeError: cannot read property of undefined");
    expect(
      within(card).getByTestId("moderation-failures-last-error"),
    ).toHaveTextContent(/engine/i);
  });

  it("reads 'alerting' on the badge and renders the banner when alerter.alerting is true", async () => {
    getSystemHealth.mockResolvedValue(buildHealth({ alerting: true }));

    render(<SystemHealth />);

    const badge = await screen.findByTestId(
      "moderation-failures-alerting-badge",
    );
    expect(badge).toHaveTextContent(/alerting/i);
    expect(badge).not.toHaveTextContent(/^ok$/i);

    expect(
      screen.getByTestId("moderation-failures-banner"),
    ).toBeInTheDocument();
  });

  it("reads 'ok' on the badge and hides the banner when alerter.alerting is false", async () => {
    getSystemHealth.mockResolvedValue(buildHealth({ alerting: false }));

    render(<SystemHealth />);

    const badge = await screen.findByTestId(
      "moderation-failures-alerting-badge",
    );
    await waitFor(() => {
      expect(badge).toHaveTextContent(/^ok$/i);
    });
    expect(badge).not.toHaveTextContent(/alerting/i);

    expect(
      screen.queryByTestId("moderation-failures-banner"),
    ).not.toBeInTheDocument();
  });
});
