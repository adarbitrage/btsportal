import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Locator, type Page } from "@playwright/test";
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

// The sessionStorage key the admin sidebar persists its scroll offset under.
// Keep in lockstep with ADMIN_SIDEBAR_SCROLL_KEY in
// src/components/layout/AdminLayout.tsx.
const SCROLL_KEY = "admin-sidebar-scroll-top";

function readSavedScroll(page: Page): Promise<string | null> {
  return page.evaluate((k) => sessionStorage.getItem(k), SCROLL_KEY);
}

// Read an element's live scrollTop.
function scrollTopOf(scroll: Locator): Promise<number> {
  return scroll.evaluate((el) => el.scrollTop);
}

// Scroll the sidebar down to `px` and return the resulting (browser-clamped)
// scrollTop. Dispatching the scroll event makes the save listener fire
// deterministically rather than waiting on the async native scroll event.
async function scrollSidebar(scroll: Locator, px: number): Promise<number> {
  return scroll.evaluate((el, target) => {
    el.scrollTop = target;
    el.dispatchEvent(new Event("scroll"));
    return el.scrollTop;
  }, px);
}

test.describe("Admin sidebar scroll persistence", () => {
  // A short viewport guarantees the static admin nav overflows its scroll
  // container, so there is a meaningful offset to preserve.
  test.use({ viewport: { width: 1280, height: 500 } });

  test.beforeEach(async ({ page }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, fixture);
    await page.goto("/admin/dashboard");
  });

  test("preserves the sidebar scroll position across navigation and reload", async ({
    page,
  }) => {
    const scroll = page.getByTestId("admin-sidebar-scroll");
    await expect(scroll).toBeVisible();

    // Confirm the nav actually overflows before scrolling is meaningful.
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 15_000,
      })
      .toBeGreaterThan(80);

    const target = await scrollSidebar(scroll, 120);
    expect(target).toBeGreaterThan(0);

    // The scroll listener should have written the offset to sessionStorage.
    await expect.poll(() => readSavedScroll(page)).toBe(String(target));

    // In-app navigation to a different admin page (wouter <Link>, no reload).
    // Each admin page wraps itself in <AdminLayout>, so the sidebar remounts —
    // only the restore-from-sessionStorage effect can bring the offset back.
    await Promise.all([
      page.waitForURL(/\/admin\/agent-performance/),
      page.getByRole("link", { name: "Agent Performance" }).click(),
    ]);

    const scrollAfterNav = page.getByTestId("admin-sidebar-scroll");
    await expect(scrollAfterNav).toBeVisible();
    await expect
      .poll(() => scrollTopOf(scrollAfterNav), { timeout: 15_000 })
      .toBe(target);

    // A full reload remounts the sidebar from scratch — this proves the
    // persistence mechanism itself, not just a component that stayed mounted.
    await page.reload();
    const scrollAfterReload = page.getByTestId("admin-sidebar-scroll");
    await expect(scrollAfterReload).toBeVisible();
    await expect
      .poll(() => scrollTopOf(scrollAfterReload), { timeout: 15_000 })
      .toBe(target);
  });

  test('"Back to Portal" resets the sidebar scroll to the top', async ({
    page,
  }) => {
    const scroll = page.getByTestId("admin-sidebar-scroll");
    await expect(scroll).toBeVisible();

    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 15_000,
      })
      .toBeGreaterThan(80);

    const target = await scrollSidebar(scroll, 120);
    expect(target).toBeGreaterThan(0);

    await expect.poll(() => readSavedScroll(page)).toBe(String(target));

    // "Back to Portal" is the one intentional place that clears the saved
    // offset so a later return to the admin area starts at the top.
    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname === "/"),
      page.getByTestId("admin-back-to-portal").click(),
    ]);

    await expect.poll(() => readSavedScroll(page)).toBeNull();

    // Returning to the admin area must now start scrolled to the top.
    await page.goto("/admin/dashboard");
    const scrollBack = page.getByTestId("admin-sidebar-scroll");
    await expect(scrollBack).toBeVisible();
    await expect.poll(() => scrollTopOf(scrollBack), { timeout: 15_000 }).toBe(0);
  });
});
