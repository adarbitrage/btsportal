import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import type { E2EFixture } from "./global-setup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(): E2EFixture {
  try {
    const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
    return JSON.parse(raw) as E2EFixture;
  } catch {
    throw new Error(
      "E2E fixture file is missing. The Playwright globalSetup must run first to seed an isolated admin + member.",
    );
  }
}

async function loginAsAdmin(
  page: Page,
  request: APIRequestContext,
  fixture: E2EFixture,
): Promise<void> {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: fixture.adminEmail, password: fixture.adminPassword },
  });
  expect(
    loginRes.ok(),
    `Login API call failed (${loginRes.status()} ${loginRes.statusText()})`,
  ).toBe(true);

  const setCookieHeader = loginRes.headers()["set-cookie"];
  expect(setCookieHeader, "Login should return an access_token cookie").toBeTruthy();

  const cookies = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
    .flatMap((header) => header.split(/,(?=[^;]+=)/g))
    .map((raw) => {
      const [pair] = raw.split(";");
      const [name, ...valueParts] = pair.split("=");
      const value = valueParts.join("=");
      return name && value ? { name: name.trim(), value: value.trim() } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);

  const baseUrlObj = new URL(process.env.E2E_BASE_URL ?? "http://localhost:25265");
  await page.context().addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: baseUrlObj.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

// Build a minimal but realistic system-health payload. The SystemHealth page
// only renders the upgrade-prompt-events-cleanup card when `services
// .upgradePromptEventsCleanup` is present, so this fixture mirrors the exact
// shape returned by `getUpgradePromptEventsCleanupStatus()` plus enough of
// the surrounding envelope for the page itself to render without crashing.
function buildHealthPayload(overrides: {
  retentionDays: number;
  lastDeletedCount: number;
  lastRanAt: string | null;
}) {
  return {
    status: "healthy" as const,
    services: {
      api: { status: "up", uptime: 1234 },
      database: { status: "up", totalUsers: 1, totalTickets: 0 },
      redis: {
        status: "up",
        queueFallbacks: { alerting: false, total: 0, last24h: 0 },
      },
      signupChallenge: { enforced: true },
      abuseRateLimitCleanup: {
        intervalMs: 60 * 60 * 1000,
        lastRanAt: null,
        lastDeletedCount: null,
        lastError: null,
        retentionDays: 30,
        stale: false,
      },
      upgradePromptEventsCleanup: {
        intervalMs: 60 * 60 * 1000,
        lastRanAt: overrides.lastRanAt,
        lastDeletedCount: overrides.lastDeletedCount,
        lastError: null,
        retentionDays: overrides.retentionDays,
        stale: false,
      },
      auditLogRetention: { policies: [] },
      rateLimitAuditFailures: { totalCount: 0, last24h: 0, lastFailureAt: null },
      missingCriticalSecrets: [],
    },
    webhooks: { last24h: 0, failed24h: 0 },
    auditLogs: { last24h: [] },
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
  };
}

test.describe("Admin System Health — upgrade-prompt analytics retention card", () => {
  test("renders the card with status, retention window, run interval, and rows-deleted populated, and reflects retention changes", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);

    // First load: 90-day retention, 12 rows deleted on the last sweep.
    let payload = buildHealthPayload({
      retentionDays: 90,
      lastDeletedCount: 12,
      lastRanAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
    await page.route("**/api/admin/system/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    });

    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", { name: /System Health/i }),
    ).toBeVisible({ timeout: 15_000 });

    const card = page.getByTestId("card-upgrade-prompt-events-cleanup");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Status badge: Healthy because lastRanAt is recent and stale=false.
    const status = page.getByTestId("upgrade-prompt-events-cleanup-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveText("Healthy");

    // Retention window reflects the 90-day default from the API payload.
    const retention = page.getByTestId("upgrade-prompt-events-cleanup-retention");
    await expect(retention).toBeVisible();
    await expect(retention).toHaveText("90d");

    // Run interval rendering: 1h interval → "1h".
    const interval = page.getByTestId("upgrade-prompt-events-cleanup-interval");
    await expect(interval).toBeVisible();
    await expect(interval).toHaveText("1h");

    // Last run is populated (not "Never") and rows-deleted shows the count.
    const lastRan = page.getByTestId("upgrade-prompt-events-cleanup-last-ran");
    await expect(lastRan).toBeVisible();
    await expect(lastRan).not.toHaveText("Never");

    const deleted = page.getByTestId("upgrade-prompt-events-cleanup-deleted");
    await expect(deleted).toBeVisible();
    await expect(deleted).toHaveText("12");

    // Healthy state shouldn't render the stale warning or last-error blurb —
    // a regression that surfaced them unconditionally would fail here.
    await expect(
      page.getByTestId("upgrade-prompt-events-cleanup-stale-warning"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("upgrade-prompt-events-cleanup-last-error"),
    ).toHaveCount(0);

    // Now simulate flipping UPGRADE_PROMPT_EVENTS_RETENTION_DAYS to 30 on the
    // server: reassign `payload` so the existing route handler returns the
    // new value, then reload the page to force a fresh fetch (we don't want
    // to depend on the page's auto-refresh interval to keep this test fast).
    payload = buildHealthPayload({
      retentionDays: 30,
      lastDeletedCount: 7,
      lastRanAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: /System Health/i }),
    ).toBeVisible({ timeout: 15_000 });

    const retentionAfter = page.getByTestId("upgrade-prompt-events-cleanup-retention");
    const deletedAfter = page.getByTestId("upgrade-prompt-events-cleanup-deleted");
    await expect(retentionAfter).toHaveText("30d", { timeout: 10_000 });
    await expect(deletedAfter).toHaveText("7");
  });

  test("the real /api/admin/system/health response includes upgradePromptEventsCleanup wired from the backend status helper", async ({
    request,
  }) => {
    // Complement to the stubbed UI test above: this hits the real API with
    // no route mocking so a regression that drops `upgradePromptEventsCleanup`
    // from the admin-panel response (or breaks `getUpgradePromptEventsCleanupStatus()`
    // itself) is caught end-to-end — not just at the rendering layer.
    const fixture = loadFixture();
    const loginRes = await request.post("/api/auth/login", {
      data: { email: fixture.adminEmail, password: fixture.adminPassword },
    });
    expect(loginRes.ok()).toBe(true);

    const healthRes = await request.get("/api/admin/system/health");
    expect(
      healthRes.ok(),
      `system-health API call failed (${healthRes.status()} ${healthRes.statusText()})`,
    ).toBe(true);

    const body = (await healthRes.json()) as {
      services?: {
        upgradePromptEventsCleanup?: {
          intervalMs?: number;
          retentionDays?: number;
          lastRanAt?: string | null;
          lastDeletedCount?: number | null;
          lastError?: unknown;
          stale?: boolean;
        };
      };
    };

    const upe = body.services?.upgradePromptEventsCleanup;
    expect(upe, "services.upgradePromptEventsCleanup must be present").toBeTruthy();
    expect(typeof upe!.intervalMs).toBe("number");
    expect(upe!.intervalMs).toBeGreaterThan(0);
    expect(typeof upe!.retentionDays).toBe("number");
    expect(upe!.retentionDays).toBeGreaterThan(0);
    expect(typeof upe!.stale).toBe("boolean");
    // lastRanAt / lastDeletedCount may legitimately be null before the first
    // sweep, but the keys themselves must exist in the payload so the UI's
    // optional-chained rendering keeps working.
    expect(upe!).toHaveProperty("lastRanAt");
    expect(upe!).toHaveProperty("lastDeletedCount");
    expect(upe!).toHaveProperty("lastError");
  });
});
