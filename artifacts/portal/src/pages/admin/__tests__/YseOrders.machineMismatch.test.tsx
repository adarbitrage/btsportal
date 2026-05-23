import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getYseOrders = vi.fn();
const getYsePendingGrants = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getYseOrders: (...args: unknown[]) => getYseOrders(...args),
    getYsePendingGrants: (...args: unknown[]) => getYsePendingGrants(...args),
    exportYseOrders: vi.fn(),
    retryYseGrant: vi.fn(),
  },
  saveBlobAsFile: vi.fn(),
}));

vi.mock("@/lib/download-progress", () => ({
  formatDownloadProgress: () => "",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/admin/integrations/machine", () => {}],
}));

import YseOrders from "@/pages/admin/YseOrders";

const MISMATCH_ORDER_ID = "machine_order_mismatch_1";
const CLEAN_ORDER_ID = "machine_order_clean_1";

beforeEach(() => {
  getYseOrders.mockReset();
  getYsePendingGrants.mockReset();
  getYsePendingGrants.mockResolvedValue({
    items: [],
    status: {
      lastRanAt: null,
      lastSucceeded: 0,
      lastFailed: 0,
      lastError: null,
      intervalMs: 60_000,
      maxAttempts: 5,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("YseOrders — Machine key-mismatch summary banner & row badge", () => {
  it("renders 'N of M Machine orders…' banner copy and per-row Key-mismatch badge for a mismatching Machine order", async () => {
    getYseOrders.mockResolvedValue({
      orders: [
        {
          externalOrderId: MISMATCH_ORDER_ID,
          externalSource: "machine",
          userId: 101,
          userEmail: "mismatch@example.test",
          userName: "Mismatch Buyer",
          grantedAt: "2026-05-01T12:00:00Z",
          products: [{ name: "Front End", slug: "yse_front_end" }],
          productCount: 1,
          wasNewUser: false,
          btsRef: "bts_abc",
          funnelSlug: "yse-workshop",
          portalProductKeys: ["yse_front_end", "yse_cmo_bump"],
          mismatch: true,
        },
        {
          externalOrderId: CLEAN_ORDER_ID,
          externalSource: "machine",
          userId: 102,
          userEmail: "clean@example.test",
          userName: "Clean Buyer",
          grantedAt: "2026-05-02T12:00:00Z",
          products: [{ name: "Front End", slug: "yse_front_end" }],
          productCount: 1,
          wasNewUser: false,
          btsRef: "bts_def",
          funnelSlug: "yse-workshop",
          portalProductKeys: ["yse_front_end"],
          mismatch: false,
        },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      mismatchSummary: {
        machineOrdersInView: 2,
        machineOrdersWithMismatch: 1,
      },
    });

    render(<YseOrders />);

    // Banner appears once the orders have loaded.
    const banner = await screen.findByTestId("banner-yse-mismatch-summary");

    // The "N" and "M" pieces are rendered as separate spans so the test can
    // pin them independently of the surrounding copy.
    expect(
      within(banner).getByTestId("text-yse-mismatch-count"),
    ).toHaveTextContent("1");
    expect(
      within(banner).getByTestId("text-yse-machine-total"),
    ).toHaveTextContent("2");

    // And the full sentence reads as the staff-facing copy we promised.
    expect(banner.textContent).toMatch(
      /1\s+of\s+2\s+Machine\s+orders\s+in the current view\s+has\s+a key mismatch\./,
    );

    // The mismatching row gets the Key-mismatch badge…
    const mismatchRow = await screen.findByTestId(
      `row-yse-order-${MISMATCH_ORDER_ID}`,
    );
    const badge = within(mismatchRow).getByTestId(
      `badge-mismatch-${MISMATCH_ORDER_ID}`,
    );
    expect(badge).toHaveTextContent(/key mismatch/i);

    // …and the clean row does not.
    const cleanRow = await screen.findByTestId(
      `row-yse-order-${CLEAN_ORDER_ID}`,
    );
    expect(
      within(cleanRow).queryByTestId(`badge-mismatch-${CLEAN_ORDER_ID}`),
    ).not.toBeInTheDocument();
  });

  it("hides the summary banner entirely when there are no Machine orders in view", async () => {
    getYseOrders.mockResolvedValue({
      orders: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      mismatchSummary: {
        machineOrdersInView: 0,
        machineOrdersWithMismatch: 0,
      },
    });

    render(<YseOrders />);

    // Wait for the loading state to clear before asserting the banner is absent.
    await waitFor(() => {
      expect(screen.getByTestId("text-yse-empty")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("banner-yse-mismatch-summary"),
    ).not.toBeInTheDocument();
  });
});
