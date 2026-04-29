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
  // Mirrors the login pattern used by the other admin e2e specs: hit the API
  // directly and forward the access_token cookie into the browser context so
  // SPA fetches are authenticated without depending on /login UI flake.
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

test.describe("Admin notification bell — signup-challenge warning", () => {
  test("renders the high-severity 'Signup challenge disabled in production' notification and deep-links to System Health", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);

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

    await page.route("**/api/admin/notifications", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([simulatedNotification]),
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
