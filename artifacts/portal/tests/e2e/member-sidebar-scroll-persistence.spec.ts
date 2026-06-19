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

// The sessionStorage key the member sidebar persists its scroll offset under.
// Keep in lockstep with SIDEBAR_SCROLL_KEY in
// src/components/layout/Sidebar.tsx.
const SCROLL_KEY = "sidebar-scroll-top";

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

test.describe("Member sidebar scroll persistence", () => {
  // A short viewport guarantees the member nav overflows its scroll container
  // even with the collapsible folders closed, so there is a meaningful offset
  // to preserve. We log in as the admin because that account also surfaces the
  // in-sidebar Admin folder + "Back to Portal" control exercised below.
  //
  // The first navigation to a heavy member route triggers an on-demand Vite
  // dev transform that, on this shared environment, hovers right at the default
  // 30s navigationTimeout — enough to flake. Give navigations (goto/reload/
  // waitForURL) a roomier budget and the tests a longer overall timeout; once
  // the route is warm every later navigation is fast.
  test.use({ viewport: { width: 1280, height: 400 }, navigationTimeout: 60_000 });
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, fixture);
    // The member dashboard keeps fetching after first paint, so the "load"
    // event can lag past the navigation timeout; wait for the DOM instead and
    // let the per-test sidebar assertions gate readiness.
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  test("preserves the sidebar scroll position across navigation and reload", async ({
    page,
  }) => {
    const scroll = page.getByTestId("member-sidebar-scroll");
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

    // In-app navigation to a different member page (wouter <Link>, no reload).
    // Each member page wraps itself in <AppLayout>, so the sidebar remounts —
    // only the restore-from-sessionStorage effect can bring the offset back.
    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname === "/account"),
      page.getByRole("link", { name: "Account", exact: true }).click(),
    ]);

    // Clicking a below-the-fold link makes Playwright scroll it into view, so
    // the offset persisted at navigation time may differ slightly from `target`.
    // Whatever it is, it must be a real (non-zero) offset, and it is the value
    // the remounted sidebar has to restore to.
    const persisted = Number(await readSavedScroll(page));
    expect(persisted).toBeGreaterThan(0);

    const scrollAfterNav = page.getByTestId("member-sidebar-scroll");
    await expect(scrollAfterNav).toBeVisible();
    await expect
      .poll(() => scrollTopOf(scrollAfterNav), { timeout: 15_000 })
      .toBe(persisted);

    // A full reload remounts the sidebar from scratch — this proves the
    // persistence mechanism itself, not just a component that stayed mounted.
    await page.reload({ waitUntil: "domcontentloaded" });
    const scrollAfterReload = page.getByTestId("member-sidebar-scroll");
    await expect(scrollAfterReload).toBeVisible();
    await expect
      .poll(() => scrollTopOf(scrollAfterReload), { timeout: 15_000 })
      .toBe(persisted);
  });

  test('"Back to Portal" resets the sidebar scroll to the top', async ({
    page,
  }) => {
    const scroll = page.getByTestId("member-sidebar-scroll");
    await expect(scroll).toBeVisible();

    // Expanding the Admin folder reveals its children and the "Back to Portal"
    // control, and makes the nav overflow well past the scroll container.
    await page.getByTestId("member-admin-folder-toggle").click();
    await expect(page.getByTestId("member-back-to-portal")).toBeVisible();

    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 15_000,
      })
      .toBeGreaterThan(80);

    const target = await scrollSidebar(scroll, 120);
    expect(target).toBeGreaterThan(0);

    await expect.poll(() => readSavedScroll(page)).toBe(String(target));

    // "Back to Portal" is the one intentional place that collapses the Admin
    // folder, clears the saved offset, and scrolls the sidebar back to the top.
    await page.getByTestId("member-back-to-portal").click();

    // The live sidebar must immediately be scrolled back to the top.
    await expect.poll(() => scrollTopOf(scroll), { timeout: 15_000 }).toBe(0);

    // The persisted offset is reset to the top: collapseAdminFolder removes the
    // key, and because the in-place collapse keeps the sidebar mounted, the
    // scrollTop=0 it sets fires a native scroll that re-saves "0". Either way a
    // later return starts at the top, never at the old offset.
    const saved = await readSavedScroll(page);
    expect(saved === null || saved === "0").toBe(true);
    expect(saved).not.toBe(String(target));

    // Prove the reset survives a full remount: returning starts at the top.
    await page.reload({ waitUntil: "domcontentloaded" });
    const scrollAfterReload = page.getByTestId("member-sidebar-scroll");
    await expect(scrollAfterReload).toBeVisible();
    await expect
      .poll(() => scrollTopOf(scrollAfterReload), { timeout: 15_000 })
      .toBe(0);
  });
});
