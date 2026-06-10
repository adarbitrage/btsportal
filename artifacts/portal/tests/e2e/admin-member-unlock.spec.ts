import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
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

test.describe("Admin Member Detail — Unlock account", () => {
  test("admin can unlock a locked member from the Member Detail page and the DB row is cleared", async ({
    page,
  }) => {
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the admin Unlock Account E2E test (it seeds and verifies its own fixtures).",
      );
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const FAILED_COUNT = 5;
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);

    try {
      // Put the seeded member into a locked state with a non-zero failed login
      // count so the lock card is guaranteed to render.
      await pool.query(
        `UPDATE users SET locked_until = $1, failed_login_count = $2 WHERE id = $3`,
        [lockedUntil, FAILED_COUNT, fixture.memberId],
      );

      await loginAsAdmin(page, fixture);

      await page.goto(`/admin/members/${fixture.memberId}`);

      await expect(
        page.getByRole("heading", { name: fixture.memberName }),
      ).toBeVisible({ timeout: 15_000 });

      // Lock card and its inner pieces should all be visible for a locked member.
      const lockCard = page.getByTestId("card-account-lock");
      await expect(lockCard).toBeVisible();
      await expect(lockCard.getByTestId("badge-lock-status")).toHaveText("Locked");
      await expect(lockCard.getByTestId("text-failed-login-count")).toContainText(
        `${FAILED_COUNT} failed login attempts`,
      );
      await expect(lockCard.getByTestId("text-locked-until")).toBeVisible();

      const unlockButton = lockCard.getByTestId("button-unlock-account");
      await expect(unlockButton).toBeVisible();
      await expect(unlockButton).toBeEnabled();

      // Click unlock and wait for the API call to complete so we don't race
      // against the subsequent reload of /full data.
      const [unlockResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/admin/members/${fixture.memberId}/unlock`) &&
            res.request().method() === "POST",
          { timeout: 15_000 },
        ),
        unlockButton.click(),
      ]);
      expect(
        unlockResponse.ok(),
        `Unlock API call failed (${unlockResponse.status()} ${unlockResponse.statusText()})`,
      ).toBe(true);

      // After the reload, the lock card should be gone — the page only shows
      // it when the account is locked OR has a non-zero failed_login_count,
      // and unlock clears both.
      await expect(page.getByTestId("card-account-lock")).toHaveCount(0, {
        timeout: 15_000,
      });

      // Confirm the database row was actually cleared end-to-end.
      const verify = await pool.query<{
        locked_until: Date | null;
        failed_login_count: number;
      }>(
        `SELECT locked_until, failed_login_count FROM users WHERE id = $1`,
        [fixture.memberId],
      );
      expect(verify.rowCount).toBe(1);
      expect(verify.rows[0].locked_until).toBeNull();
      expect(Number(verify.rows[0].failed_login_count)).toBe(0);
    } finally {
      // Defensive cleanup — the unlock endpoint already nulls these, but if
      // the test fails before clicking we still want to reset the seeded
      // member to its original state so other specs aren't affected.
      await pool
        .query(
          `UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1`,
          [fixture.memberId],
        )
        .catch(() => {});
      await pool.end();
    }
  });
});
