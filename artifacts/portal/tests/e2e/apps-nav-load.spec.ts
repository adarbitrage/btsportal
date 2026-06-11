import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import type { E2EFixture } from "./global-setup";
import { loginAsAdmin } from "./auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(): E2EFixture {
  const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
  return JSON.parse(raw) as E2EFixture;
}

test.describe("Apps page client navigation", () => {
  test("Apps page renders when reached via sidebar click (no refresh)", async ({
    page,
  }) => {
    const fixture = loadFixture();

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await loginAsAdmin(page, fixture);

    // Land on the dashboard first, then navigate purely client-side.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    // Expand the "Tools & Apps" folder so the Apps leaf is clickable.
    await page.getByText("Tools & Apps", { exact: true }).first().click();

    // Click the Apps leaf (wouter <Link href="/apps">).
    const appsLink = page.locator('a[href$="/apps"]').first();
    await expect(appsLink).toBeVisible();
    await appsLink.click();

    await expect(page).toHaveURL(/\/apps$/);

    // The Apps page heading should appear without a manual refresh.
    const heading = page.getByRole("heading", { name: "Apps", exact: true });
    let renderedOnNav = true;
    try {
      await expect(heading).toBeVisible({ timeout: 8_000 });
    } catch {
      renderedOnNav = false;
    }

    // Capture whether a refresh fixes it (the reported symptom).
    let renderedAfterReload = true;
    if (!renderedOnNav) {
      await page.reload();
      try {
        await expect(heading).toBeVisible({ timeout: 8_000 });
      } catch {
        renderedAfterReload = false;
      }
    }

    console.log(
      JSON.stringify(
        {
          renderedOnNav,
          renderedAfterReload,
          pageErrors,
          consoleErrors,
        },
        null,
        2,
      ),
    );

    expect(
      renderedOnNav,
      `Apps page did not render on client nav. pageErrors=${JSON.stringify(
        pageErrors,
      )} consoleErrors=${JSON.stringify(consoleErrors)} renderedAfterReload=${renderedAfterReload}`,
    ).toBe(true);
  });
});
