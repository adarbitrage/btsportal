import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import type { E2EFixture } from "./global-setup";
import { loginAsAdmin } from "./auth";

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

test.describe("Admin notification bell — signup-challenge warning", () => {
  test("renders the high-severity 'Signup challenge disabled in production' notification and deep-links to System Health", async ({
    page,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, fixture);

    // Simulate the production misconfiguration at the network boundary.
    // Restarting the API with NODE_ENV=production + missing TURNSTILE_SECRET_KEY
    // would page on-call and disrupt other tests; intercepting the
    // /admin/notifications response gives the bell exactly the payload the
    // backend produces when the misconfiguration is real, and is what we
    // actually need to verify here (the bell UI rendering it correctly).
    //
    // Important: the SPA polls every 60s, so we install the route before
    // navigating and leave it active for the whole test.
    const simulatedNotification = {
      id: "signup-challenge-disabled",
      type: "signup_challenge_disabled",
      severity: "high",
      title: "Signup challenge disabled in production",
      message:
        "TURNSTILE_SECRET_KEY is not set, so signup requests are passing through without Cloudflare Turnstile verification. Set it on the API service to restore enforcement.",
      link: "/admin/system",
      createdAt: new Date().toISOString(),
    };

    // The bell now requests `/admin/notifications?limit=50` so it doesn't
    // download hundreds of records every 60s during a sync storm. The route
    // glob therefore needs the trailing `*` to also match the limited URL.
    // We respond with the wrapped `{ notifications, total }` shape the API
    // returns when a limit is requested.
    await page.route("**/api/admin/notifications*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [simulatedNotification],
          total: 1,
        }),
      });
    });

    await page.goto("/admin/dashboard");

    // The bell lives in the sticky AdminLayout header — wait for it to mount
    // (auth + permissions resolve before the layout renders).
    const bellButton = page.getByTestId("button-admin-notifications");
    await expect(bellButton).toBeVisible({ timeout: 15_000 });

    // The badge counts every notification regardless of `type`, so an
    // unknown type like signup_challenge_disabled must still bump it to 1.
    // A regression that gates the badge on a known type would fail here.
    const badge = page.getByTestId("badge-admin-notifications-count");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveText("1");

    // Open the dropdown.
    await bellButton.click();
    const dropdown = page.getByTestId("dropdown-admin-notifications");
    await expect(dropdown).toBeVisible();

    // The signup_challenge_disabled type isn't in the iconMap — the UI must
    // still render the item via its AlertTriangle fallback. A regression that
    // dropped unknown-type items (instead of falling back) would fail here.
    const item = page.getByTestId("notification-item-signup-challenge-disabled");
    await expect(item).toBeVisible();

    const title = page.getByTestId("notification-title-signup-challenge-disabled");
    await expect(title).toHaveText("Signup challenge disabled in production");

    const severity = page.getByTestId(
      "notification-severity-signup-challenge-disabled",
    );
    await expect(severity).toBeVisible();
    await expect(severity).toHaveText("high");

    // Clicking the item must navigate to /admin/system so on-call admins land
    // exactly where they can fix the misconfiguration.
    await Promise.all([
      page.waitForURL(/\/admin\/system(?:$|\?|#)/),
      item.click(),
    ]);

    await expect(
      page.getByRole("heading", { name: /System Health/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The dropdown should auto-close after navigation so it doesn't sit on
    // top of the destination page.
    await expect(
      page.getByTestId("dropdown-admin-notifications"),
    ).toBeHidden();
  });
});
