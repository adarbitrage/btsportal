import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// Regression guard for the Blitz hub "Go to Section" buttons. The reported bug:
// clicking "Go to Section" on a lesson card (/blitz hub) lands the member on the
// FULL guide (all lesson modules visible) instead of the single filtered lesson
// section at /blitz/guide/<lessonId>.
//
// Root cause: the guide body is injected via dangerouslySetInnerHTML, and an
// async re-render (the content-access guard's query resolving ~100-600ms after
// mount) makes React silently re-commit the innerHTML, replacing every module
// with a fresh UNFILTERED copy without re-running the filter effect. The filter
// is re-applied via a MutationObserver; this test must therefore wait past that
// re-commit window before asserting, or it would pass against the broken build.
//
// This only reproduces in a real browser (the section filter sets inline
// display:none on non-matching `.module[data-section]` blocks and the symptom
// depends on the real DOM/CSS + SPA navigation + async re-render), so it is
// covered here as an e2e test rather than a jsdom unit test.
//
// We click lesson 2's "Go to Section" specifically: lesson 1 renders at the top
// of BOTH the full guide and its own section view, so it cannot distinguish the
// bug. Lesson 2 is in the first ("intro") phase, so it is unlocked for a fresh
// member, yet a correct section view must show ONLY section "s2" and must NOT
// show lesson 1 ("s1") or the final lesson ("s19").
test.describe("Blitz hub 'Go to Section' opens the single lesson section", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    navigationTimeout: 60_000,
  });
  test.describe.configure({ timeout: 120_000 });

  test("clicking lesson 2's 'Go to Section' shows only that section, not the full guide", async ({
    page,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the Blitz go-to-section E2E test (it seeds and tears down its own member).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const email = `e2e-blitz-nav-${tag}@e2e.local`;
    const password = `E2E-${randomBytes(9).toString("base64url")}`;

    const pool = new Pool({ connectionString: databaseUrl });
    let memberId = 0;
    try {
      const hash = await bcrypt.hash(password, 10);
      const res = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Blitz Nav Member ${tag}`, email, hash],
      );
      memberId = res.rows[0].id;

      await loginAs(page, email, password);

      // Land on the hub and confirm it rendered (guard resolved).
      await page.goto("/blitz", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "The Blitz™" }),
      ).toBeVisible({ timeout: 30_000 });

      // Click lesson 2's "Go to Section" link (href ends with /blitz/guide/2;
      // the bare-section CTA has no hash). Tolerate an optional base prefix.
      const goToSection = page
        .locator('a[href$="/blitz/guide/2"]')
        .filter({ hasText: "Go to Section" });
      await expect(goToSection).toBeVisible({ timeout: 30_000 });
      await goToSection.click();

      // URL is the single-lesson section route.
      await expect(page).toHaveURL(/\/blitz\/guide\/2$/, { timeout: 30_000 });

      // Section-view chrome is present (these only render in section view).
      await expect(page.getByText("Lesson 2 of")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole("link", { name: "View Full Guide" }),
      ).toBeVisible();

      // The content container is in filtered (not full-guide) mode.
      await expect(page.locator(".blitz-content.section-filtered")).toBeVisible({
        timeout: 30_000,
      });

      // Wait past the async re-commit window. The original bug surfaced ~100-600ms
      // after navigation when the content-access query resolved and React rebuilt
      // the body's innerHTML back to the unfiltered markup. Asserting before this
      // window would pass even against the broken build.
      await page.waitForTimeout(1500);

      // The decisive check: of all guide modules, ONLY section s2 is actually
      // visible (uses getComputedStyle so it catches real CSS/inline display,
      // which jsdom cannot model). The full-guide bug would leave s1 (and every
      // other section) visible.
      const visibleSections = await page.evaluate(() => {
        const mods = Array.from(
          document.querySelectorAll<HTMLElement>(".module[data-section]"),
        );
        return mods
          .filter((m) => getComputedStyle(m).display !== "none")
          .map((m) => m.getAttribute("data-section") || "");
      });

      expect(visibleSections.length).toBeGreaterThan(0);
      for (const section of visibleSections) {
        expect(section.split(/\s+/)).toContain("s2");
      }
      // Lesson 1 and the final lesson must NOT be visible in section view.
      const allTokens = visibleSections.flatMap((s) => s.split(/\s+/));
      expect(allTokens).not.toContain("s1");
      expect(allTokens).not.toContain("s19");

      // Section-view chrome that drives in-section navigation/progress is still
      // present (the pager and Back-to-Hub render only in section view).
      await expect(
        page.getByRole("link", { name: "Back to Hub" }),
      ).toBeVisible();
    } finally {
      if (memberId) {
        await pool
          .query("DELETE FROM users WHERE id = $1", [memberId])
          .catch(() => {});
      }
      await pool.end();
    }
  });
});
