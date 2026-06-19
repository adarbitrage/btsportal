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

// The main admin panel (AdminLayout) renders a sidebar that collapses into a
// hamburger drawer below Tailwind's `md` breakpoint (768px), the same pattern
// the Commission and Communications sections use. This guards that mobile
// behavior end to end against the real SPA: at a phone-sized viewport the
// desktop sidebar must be hidden, the hamburger must open a drawer containing
// every nav link (including the grouped Integrations items), and tapping a link
// must navigate and close the drawer.
//
// Keep the nav arrays + data-testids below in lockstep with
// src/components/layout/AdminLayout.tsx (adminNav + adminNavGroups).
const DESKTOP_SIDEBAR = "admin-sidebar-desktop";
const DRAWER = "admin-sidebar-drawer";
const LANDING = "/admin/tickets";
// Every nav link label the drawer should expose, including the grouped
// Integrations items.
const NAV_LINKS = [
  "Ticket Queue",
  "Routing Rules",
  "Canned Responses",
  "Agent Performance",
  "Support Analytics",
  "Resource Vault",
  "Collections",
  "Vault Analytics",
  "YSE Orders",
  "Machine Orders",
  "YSE Grant Failures",
];
// A link that changes the URL when tapped (proves navigation + drawer close).
const CLICK_LABEL = "Routing Rules";
const EXPECT_URL = /\/admin\/routing-rules/;

test.describe("Main admin panel collapses into a mobile drawer", () => {
  // A phone-sized viewport (below Tailwind's 768px `md` breakpoint) so the
  // desktop sidebar's `hidden md:flex` hides it and the `md:hidden` hamburger
  // shows.
  test.use({ viewport: { width: 390, height: 844 } });

  test("hamburger opens the drawer, links navigate, drawer closes", async ({
    page,
  }) => {
    // Cold start on the shared environment (browser launch + Vite first compile
    // of the route) can be slow, so give the flow generous headroom.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    await loginAsAdmin(page, fixture);
    await page.goto(LANDING);

    // The hamburger lives in the mobile-only top bar; its presence proves we
    // rendered the collapsed mobile layout (not the desktop sidebar).
    const hamburger = page.getByRole("button", { name: "Open menu" });
    await expect(hamburger).toBeVisible({ timeout: 30_000 });

    // The desktop sidebar exists in the DOM but must be hidden at this width.
    await expect(page.getByTestId(DESKTOP_SIDEBAR)).toBeHidden();

    // The drawer is only mounted while open, so it shouldn't exist yet.
    await expect(page.getByTestId(DRAWER)).toHaveCount(0);

    // --- OPEN THE DRAWER ------------------------------------------------------
    await hamburger.click();

    const drawer = page.getByTestId(DRAWER);
    await expect(drawer).toBeVisible();

    // Every nav link should be present and visible inside the drawer.
    for (const label of NAV_LINKS) {
      await expect(
        drawer.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
    // ...plus the "Back to Portal" escape hatch and the close button.
    await expect(
      drawer.getByRole("link", { name: "Back to Portal", exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: "Close menu" }),
    ).toBeVisible();

    // --- TAP A LINK: NAVIGATES + CLOSES THE DRAWER ----------------------------
    await Promise.all([
      page.waitForURL(EXPECT_URL),
      drawer.getByRole("link", { name: CLICK_LABEL, exact: true }).click(),
    ]);

    // The drawer closes (unmounts) once the location changes.
    await expect(page.getByTestId(DRAWER)).toHaveCount(0);
    // And the hamburger is back, confirming we're still in the mobile layout on
    // the new page.
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  });
});
