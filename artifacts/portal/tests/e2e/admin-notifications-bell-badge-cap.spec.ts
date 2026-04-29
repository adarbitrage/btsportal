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

test.describe("Admin notification bell — badge cap", () => {
  test("caps the visible count at '99+' and keeps the surrounding header layout stable when the backend returns 100+ notifications", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);

    // Simulate a runaway alert source (sync storm, misconfigured webhook, etc.)
    // by intercepting /admin/notifications. We can't easily seed 150 real
    // notifications, and intercepting at the network boundary lets us assert
    // exactly the bell rendering behaviour the task is about.
    //
    // Important: the SPA polls every 60s, so we install the route before
    // navigating and leave it active for the whole test.
    const RUNAWAY_COUNT = 150;
    const simulatedNotifications = Array.from({ length: RUNAWAY_COUNT }, (_, i) => ({
      id: `runaway-${i + 1}`,
      type: "sync_failure",
      severity: "medium",
      title: `Sync failure #${i + 1}`,
      message: "Simulated runaway alert from a sync storm.",
      link: "/admin/system",
      createdAt: new Date().toISOString(),
    }));

    // The bell now requests `/admin/notifications?limit=50` so it doesn't
    // download hundreds of records every 60s during a sync storm. The route
    // glob therefore needs the trailing `*` to also match the limited URL.
    // We respond with the wrapped `{ notifications, total }` shape the API
    // returns when a limit is requested — the UI uses `total` for the badge,
    // which is what lets the cap test still see "99+" even though the
    // truncated `notifications` array would otherwise look like a quiet day.
    await page.route("**/api/admin/notifications*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: simulatedNotifications.slice(0, 50),
          total: simulatedNotifications.length,
        }),
      });
    });

    await page.goto("/admin/dashboard");

    const bellButton = page.getByTestId("button-admin-notifications");
    await expect(bellButton).toBeVisible({ timeout: 15_000 });

    // The visible badge text must be capped — never the raw 3-digit count.
    // A regression that rendered notifications.length directly would fail
    // here because "150" !== "99+".
    const badge = page.getByTestId("badge-admin-notifications-count");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveText("99+");

    // Screen readers must still hear the real count, not the truncated cap,
    // so on-call admins know the actual scale of the incident. The accessible
    // name lives on the bell button (the badge itself is aria-hidden).
    await expect(bellButton).toHaveAccessibleName(
      `Notifications, ${RUNAWAY_COUNT} unread`,
    );

    // Layout stability: the badge itself must stay narrow. With the cap in
    // place "99+" fits in a small pill (~24px wide). A regression that
    // rendered the raw 3-digit count "150" would still fit visually, but
    // anything wider than ~32px means the cap was bypassed or the badge
    // grew unboundedly — both of which would distort the bell on a real
    // 4-digit storm. The badge is positioned absolutely, so this also
    // proves it can't push surrounding header elements around.
    const badgeBox = await badge.boundingBox();
    expect(badgeBox, "badge must have a bounding box").not.toBeNull();
    expect(badgeBox!.width).toBeLessThanOrEqual(32);
    expect(badgeBox!.height).toBeLessThanOrEqual(20);

    // And the bell button itself must keep its compact icon-button footprint
    // — a regression that let the badge break out of absolute positioning
    // and stretch the button would fail here.
    const bellBox = await bellButton.boundingBox();
    expect(bellBox, "bell button must have a bounding box").not.toBeNull();
    expect(bellBox!.width).toBeLessThanOrEqual(48);

    // Open the dropdown and verify the truncation footer hint is rendered
    // when fewer items are shown than the server's reported `total`. This
    // locks in the contract that admins can always tell *at a glance* that
    // they're looking at a truncated view, not the full incident.
    await bellButton.click();
    const dropdown = page.getByTestId("dropdown-admin-notifications");
    await expect(dropdown).toBeVisible();

    const truncationHint = page.getByTestId("text-admin-notifications-truncation");
    await expect(truncationHint).toBeVisible();
    await expect(truncationHint).toHaveText(
      `Showing the 50 most recent of ${RUNAWAY_COUNT}.`,
    );

    // The audit-log footer link must always be present so admins have an
    // escape hatch to the full history when the dropdown is truncated.
    await expect(
      page.getByTestId("link-admin-notifications-view-all"),
    ).toBeVisible();
  });
});
