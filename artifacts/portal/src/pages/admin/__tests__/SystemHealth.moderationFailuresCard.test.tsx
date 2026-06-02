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

type PodFixture = {
  instanceId: string;
  totalCount: number;
  byKind: { engine: number; persist: number };
  lastAt: string | null;
};

function buildHealth(overrides: {
  alerting: boolean;
  windowTotal?: number;
  engine?: number;
  persist?: number;
  lastError?: string | null;
  lastKind?: "engine" | "persist" | null;
  source?: "redis" | "memory";
  pods?: PodFixture[];
  cumulativeTotal?: number;
  cumulativeEngine?: number;
  cumulativePersist?: number;
}) {
  const {
    alerting,
    windowTotal = 3,
    engine = 1,
    persist = 2,
    lastError = "RangeError: persist write failed for post 42",
    lastKind = "persist",
    source,
    pods,
    cumulativeTotal = 10,
    cumulativeEngine = 4,
    cumulativePersist = 6,
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
          ...(source ? { source } : {}),
          ...(pods ? { pods } : {}),
        },
        cumulative: {
          totalCount: cumulativeTotal,
          byKind: { engine: cumulativeEngine, persist: cumulativePersist },
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

  it("renders cumulative total and engine/persist counts from cumulative.byKind", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        cumulativeTotal: 42,
        cumulativeEngine: 17,
        cumulativePersist: 25,
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");
    expect(
      within(card).getByTestId("moderation-failures-cumulative-total"),
    ).toHaveTextContent("42");

    const enginePersistLabel = within(card).getByText("engine / persist");
    const enginePersistRow = enginePersistLabel.parentElement;
    expect(enginePersistRow).not.toBeNull();
    expect(enginePersistRow).toHaveTextContent(/17\s*\/\s*25/);
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

describe("SystemHealth — Background moderation failures per-pod breakdown", () => {
  it("renders the redis source badge and per-pod rows in totalCount-descending order", async () => {
    const pods: PodFixture[] = [
      {
        instanceId: "pod-alpha",
        totalCount: 2,
        byKind: { engine: 1, persist: 1 },
        lastAt: "2025-05-27T11:55:00.000Z",
      },
      {
        instanceId: "pod-bravo",
        totalCount: 5,
        byKind: { engine: 2, persist: 3 },
        lastAt: "2025-05-27T12:00:00.000Z",
      },
    ];
    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        windowTotal: 7,
        engine: 3,
        persist: 4,
        source: "redis",
        pods,
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");

    const sourceBadge = within(card).getByTestId("moderation-failures-source");
    expect(sourceBadge).toHaveTextContent(/2 pods reporting/i);

    const podsContainer = within(card).getByTestId("moderation-failures-pods");
    const podAlpha = within(podsContainer).getByTestId(
      "moderation-failures-pod-pod-alpha",
    );
    const podBravo = within(podsContainer).getByTestId(
      "moderation-failures-pod-pod-bravo",
    );
    expect(podAlpha).toBeInTheDocument();
    expect(podBravo).toBeInTheDocument();
    expect(podAlpha).toHaveTextContent("pod-alpha");
    expect(podBravo).toHaveTextContent("pod-bravo");

    const rows = within(podsContainer).getAllByTestId(
      /^moderation-failures-pod-/,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(podBravo);
    expect(rows[1]).toBe(podAlpha);
  });

  it("surfaces a pod whose last report is older than 2x the window with a stale indicator", async () => {
    const recentlyReporting: PodFixture = {
      instanceId: "pod-fresh",
      totalCount: 0,
      byKind: { engine: 0, persist: 0 },
      // Reported a minute ago — quiet but healthy, must NOT be flagged stale
      // and must NOT show in the breakdown (no in-window failures).
      lastAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const droppedOut: PodFixture = {
      instanceId: "pod-ghost",
      totalCount: 0,
      byKind: { engine: 0, persist: 0 },
      // Last reported well over a year ago — far past 2x the 15m window.
      lastAt: "2025-01-01T00:00:00.000Z",
    };
    const failing: PodFixture = {
      instanceId: "pod-busy",
      totalCount: 4,
      byKind: { engine: 1, persist: 3 },
      lastAt: new Date(Date.now() - 30_000).toISOString(),
    };

    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        windowTotal: 4,
        engine: 1,
        persist: 3,
        source: "redis",
        pods: [recentlyReporting, droppedOut, failing],
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");
    const podsContainer = within(card).getByTestId("moderation-failures-pods");

    // The stale pod is surfaced even with zero in-window failures...
    const ghostRow = within(podsContainer).getByTestId(
      "moderation-failures-pod-pod-ghost",
    );
    expect(ghostRow).toHaveAttribute("data-stale", "true");
    expect(
      within(ghostRow).getByTestId(
        "moderation-failures-pod-stale-pod-ghost",
      ),
    ).toHaveTextContent(/stale/i);

    // ...the busy pod is shown but not stale...
    const busyRow = within(podsContainer).getByTestId(
      "moderation-failures-pod-pod-busy",
    );
    expect(busyRow).toHaveAttribute("data-stale", "false");
    expect(
      within(busyRow).queryByTestId(
        "moderation-failures-pod-stale-pod-busy",
      ),
    ).not.toBeInTheDocument();

    // ...and the recently-reporting, zero-failure pod is omitted entirely.
    expect(
      within(podsContainer).queryByTestId(
        "moderation-failures-pod-pod-fresh",
      ),
    ).not.toBeInTheDocument();

    // Help text explaining what "stale" means is present.
    expect(
      within(card).getByTestId("moderation-failures-stale-help"),
    ).toHaveTextContent(/no report/i);
  });

  it("does not render stale help text when no pod is stale", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        windowTotal: 2,
        engine: 1,
        persist: 1,
        source: "redis",
        pods: [
          {
            instanceId: "pod-only",
            totalCount: 2,
            byKind: { engine: 1, persist: 1 },
            lastAt: new Date(Date.now() - 30_000).toISOString(),
          },
        ],
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");
    await within(card).findByTestId("moderation-failures-pods");
    expect(
      within(card).queryByTestId("moderation-failures-stale-help"),
    ).not.toBeInTheDocument();
  });

  it("renders the in-memory-only badge when source is memory", async () => {
    getSystemHealth.mockResolvedValue(
      buildHealth({
        alerting: false,
        source: "memory",
        pods: [
          {
            instanceId: "pod-solo",
            totalCount: 1,
            byKind: { engine: 1, persist: 0 },
            lastAt: "2025-05-27T12:00:00.000Z",
          },
        ],
      }),
    );

    render(<SystemHealth />);

    const card = await screen.findByTestId("card-moderation-failures");
    const sourceBadge = within(card).getByTestId("moderation-failures-source");
    expect(sourceBadge).toHaveTextContent(/in-memory only/i);
    expect(sourceBadge).not.toHaveTextContent(/reporting/i);
  });
});
