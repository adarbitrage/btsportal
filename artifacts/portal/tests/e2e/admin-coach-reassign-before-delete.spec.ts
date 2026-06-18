import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
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

// Drives the admin Coach Profiles page (/admin/coaching/coaches) reassign-
// before-delete recovery flow end to end against the LIVE API + database:
// a coach that hosts a scheduled call can't be deleted until its calls are
// moved, so the delete dialog surfaces the blocking call and an inline reassign
// control. This proves the dialog wiring, the blocked "Remove Coach" button,
// the reassign round-trip, and the follow-up delete haven't drifted — the
// backend 409 + reassign endpoint already have API-level coverage, but the
// admin UI flow that ties them together had none.
test.describe("Admin Coach Profiles — reassign-before-delete flow", () => {
  test("blocks delete on scheduled calls, reassigns them, then removes the coach", async ({
    page,
  }) => {
    // Cold start on the shared environment (browser launch + server boot) can
    // be slow, so give the whole flow generous headroom.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the admin coach reassign E2E test (it seeds two coaches + a scheduled call and cleans them up).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const fromCoachName = `E2E From Coach ${tag}`;
    const toCoachName = `E2E To Coach ${tag}`;
    const callTitle = `E2E Reassign Call ${tag}`;

    const pool = new Pool({ connectionString: databaseUrl });
    let fromCoachId = 0;
    let toCoachId = 0;
    let callId = 0;

    try {
      // Seed two coaches: one that hosts the scheduled call (blocks delete) and
      // one to reassign the call to. globalSetup only seeds an admin + member.
      const fromRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties)
         VALUES ($1, 'E2E from bio', 'E2E specialties')
         RETURNING id`,
        [fromCoachName],
      );
      fromCoachId = fromRes.rows[0].id;

      const toRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties)
         VALUES ($1, 'E2E to bio', 'E2E specialties')
         RETURNING id`,
        [toCoachName],
      );
      toCoachId = toRes.rows[0].id;

      // An UPCOMING call (scheduled_at in the future) is what makes the delete
      // guard return its structured 409, so the dialog shows the reassign UI.
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const callRes = await pool.query<{ id: number }>(
        `INSERT INTO coaching_calls (title, description, call_type, coach_id, scheduled_at)
         VALUES ($1, 'E2E reassign description', 'weekly_qa', $2, $3)
         RETURNING id`,
        [callTitle, fromCoachId, future.toISOString()],
      );
      callId = callRes.rows[0].id;

      await loginAsAdmin(page, fixture);

      await page.goto("/admin/coaching/coaches");

      // The coach card only renders behind coaching:view, so it doubles as an
      // RBAC guard for the admin landing here. Use a generous timeout: on a cold
      // dev server Vite can take a while to first-compile the route.
      const fromCard = page.getByTestId(`coach-${fromCoachId}`);
      await expect(fromCard).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`coach-${toCoachId}`)).toBeVisible();

      // --- DELETE BLOCKED -----------------------------------------------------
      await page.getByTestId(`delete-coach-${fromCoachId}`).click();

      const dialog = page.getByTestId("delete-coach-dialog");
      await expect(dialog).toBeVisible();

      // The blocking-calls section lists the scheduled call that's in the way,
      // so the admin sees exactly what's blocking removal.
      const blocking = page.getByTestId("coach-calls-blocking");
      await expect(blocking).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId(`coach-call-${callId}`)).toContainText(
        callTitle,
      );

      // "Remove Coach" stays disabled while calls still reference the coach.
      const confirmDelete = page.getByTestId("confirm-delete-coach");
      await expect(confirmDelete).toBeDisabled();

      // --- REASSIGN -----------------------------------------------------------
      // Pick the destination coach (Radix Select renders options in a portal).
      await page.getByTestId("reassign-coach-select").click();
      await page.getByRole("option", { name: toCoachName }).click();

      const [reassignResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new RegExp(
              `/api/admin/coaching/coaches/${fromCoachId}/reassign-calls$`,
            ).test(res.url()) && res.request().method() === "POST",
          { timeout: 30_000 },
        ),
        page.getByTestId("reassign-coach-calls").click(),
      ]);
      expect(
        reassignResponse.ok(),
        `Reassign calls API failed (${reassignResponse.status()} ${reassignResponse.statusText()})`,
      ).toBe(true);
      expect((await reassignResponse.json()) as { reassigned: number }).toEqual({
        reassigned: 1,
      });

      // The call moved to the destination coach in the DB.
      const afterReassign = await pool.query<{ coach_id: number }>(
        `SELECT coach_id FROM coaching_calls WHERE id = $1`,
        [callId],
      );
      expect(afterReassign.rows[0].coach_id).toBe(toCoachId);

      // With no calls left referencing the source coach, the blocking section
      // disappears and "Remove Coach" becomes actionable.
      await expect(blocking).toHaveCount(0, { timeout: 15_000 });
      await expect(confirmDelete).toBeEnabled();

      // --- DELETE -------------------------------------------------------------
      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new RegExp(
              `/api/admin/coaching/coaches/${fromCoachId}$`,
            ).test(res.url()) && res.request().method() === "DELETE",
          { timeout: 30_000 },
        ),
        confirmDelete.click(),
      ]);
      expect(
        deleteResponse.ok(),
        `Delete coach API failed (${deleteResponse.status()} ${deleteResponse.statusText()})`,
      ).toBe(true);

      // The source coach card disappears from the list once the delete +
      // refetch land; the destination coach (now holding the call) remains.
      await expect(fromCard).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId(`coach-${toCoachId}`)).toBeVisible();

      // The source coach is gone from the DB; the reassigned call survives.
      const afterDelete = await pool.query(
        `SELECT id FROM coaches WHERE id = $1`,
        [fromCoachId],
      );
      expect(afterDelete.rowCount).toBe(0);
      const callStillThere = await pool.query<{ coach_id: number }>(
        `SELECT coach_id FROM coaching_calls WHERE id = $1`,
        [callId],
      );
      expect(callStillThere.rows[0].coach_id).toBe(toCoachId);

      fromCoachId = 0;
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into
      // the shared DB for other specs.
      try {
        if (callId) {
          await pool.query(`DELETE FROM coaching_calls WHERE id = $1`, [callId]);
        }
        if (toCoachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            toCoachId,
          ]);
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [toCoachId]);
        }
        if (fromCoachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            fromCoachId,
          ]);
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [fromCoachId]);
        }
      } catch {
        /* best-effort cleanup */
      }
      await pool.end();
    }
  });
});
