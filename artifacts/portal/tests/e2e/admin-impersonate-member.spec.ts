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

// Poll the audit_log for a row written by the seeded admin for a given action.
// The impersonation routes await their audit write before responding, so the
// row is normally present immediately — the short retry just absorbs any
// replication/visibility lag on the shared dev database.
async function waitForAuditRow(
  pool: Pool,
  opts: { actorId: number; actionType: string; entityId: string },
): Promise<{ id: number; description: string | null }> {
  const deadline = Date.now() + 10_000;
  let last: { id: number; description: string | null } | undefined;
  while (Date.now() < deadline) {
    const res = await pool.query<{ id: number; description: string | null }>(
      `SELECT id, description FROM audit_log
       WHERE actor_id = $1 AND action_type = $2 AND entity_id = $3
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [opts.actorId, opts.actionType, opts.entityId],
    );
    if (res.rowCount && res.rowCount > 0) {
      last = res.rows[0];
      return last;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out waiting for ${opts.actionType} audit row (actor=${opts.actorId}, entity=${opts.entityId})`,
  );
}

test.describe("Admin Member Detail — Log in as member (impersonation)", () => {
  test("admin starts impersonation, sees the banner, stops, and audit rows are written", async ({
    page,
  }) => {
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the impersonation E2E test (it verifies its own audit rows).",
      );
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const entityId = String(fixture.memberId);

    try {
      await loginAsAdmin(page, fixture);

      // Use domcontentloaded rather than the default "load": the Replit dev
      // plugins (cartographer / dev-banner, active when REPL_ID is set) keep
      // long-lived connections open so the window "load" event can stall past
      // the navigation timeout. The SPA hydrates fine on DOMContentLoaded.
      await page.goto(`/admin/members/${fixture.memberId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: fixture.memberName }),
      ).toBeVisible({ timeout: 15_000 });

      // --- Start impersonation -------------------------------------------
      const impersonationCard = page.getByTestId("card-impersonation");
      await expect(impersonationCard).toBeVisible();
      await impersonationCard.getByTestId("button-impersonate").click();

      const dialog = page.getByTestId("dialog-confirm-impersonate");
      await expect(dialog).toBeVisible();

      const [startResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res
              .url()
              .includes(`/api/admin/impersonate/${fixture.memberId}`) &&
            res.request().method() === "POST",
          { timeout: 15_000 },
        ),
        dialog.getByTestId("button-confirm-impersonate").click(),
      ]);
      expect(
        startResponse.ok(),
        `Start-impersonation API call failed (${startResponse.status()} ${startResponse.statusText()})`,
      ).toBe(true);

      // --- Banner visible while impersonating ----------------------------
      const banner = page.getByTestId("impersonation-banner");
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText(fixture.memberName);
      await expect(banner).toContainText(fixture.memberEmail);
      await expect(banner).toContainText(/impersonated by/i);

      // Audit: impersonate_start row written, attributed to the admin and
      // pointing at the impersonated member — this is the row the history /
      // duration features pair against.
      const startRow = await waitForAuditRow(pool, {
        actorId: fixture.adminId,
        actionType: "impersonate_start",
        entityId,
      });
      expect(startRow.description ?? "").toContain(fixture.memberName);

      // --- Stop impersonation --------------------------------------------
      const exitButton = banner.getByTestId("button-exit-impersonation");
      await expect(exitButton).toBeVisible();

      const [stopResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/admin/impersonate/stop") &&
            res.request().method() === "POST",
          { timeout: 15_000 },
        ),
        exitButton.click(),
      ]);
      expect(
        stopResponse.ok(),
        `Stop-impersonation API call failed (${stopResponse.status()} ${stopResponse.statusText()})`,
      ).toBe(true);

      // Banner disappears once the admin session is restored, and the exit
      // flow returns the admin to the members list (an admin-only route),
      // proving the original admin session is back.
      await expect(banner).toHaveCount(0, { timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: /Members/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Audit: impersonate_stop row written, also attributed to the admin and
      // the same member, so start/stop pair up for duration tracking.
      await waitForAuditRow(pool, {
        actorId: fixture.adminId,
        actionType: "impersonate_stop",
        entityId,
      });
    } finally {
      // Defensive cleanup so re-runs against the same dev DB stay clean even
      // if an assertion fails mid-flow. Global teardown also removes these by
      // actor_id, but it only runs once the whole suite finishes.
      await pool
        .query(
          `DELETE FROM audit_log
           WHERE actor_id = $1
             AND action_type IN ('impersonate_start', 'impersonate_stop')`,
          [fixture.adminId],
        )
        .catch(() => {});
      await pool.end();
    }
  });
});
