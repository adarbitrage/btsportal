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

// Drives the admin Group Calls schedule editor (/admin/coaching/calls) end to
// end against the LIVE API server + database: create a call, edit its Meet
// link, then delete it. Unlike the component-level CoachingCalls.crud.test.tsx
// (which fakes the network boundary), this proves the real create/update/delete
// endpoints, the coach dropdown, and RBAC haven't drifted in shape.
test.describe("Admin Group Calls — schedule CRUD against the real API", () => {
  test("admin creates a call, edits its Meet link, and deletes it", async ({
    page,
  }) => {
    // Cold start on the shared environment (browser launch + server boot) can
    // be slow, so give the whole flow generous headroom.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the admin Group Calls CRUD E2E test (it seeds a coach and cleans up the created call).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E Coach ${tag}`;
    const callTitle = `E2E Group Call ${tag}`;
    const originalMeetLink = "https://meet.google.com/e2e-original";
    const editedMeetLink = "https://meet.google.com/e2e-edited";

    const pool = new Pool({ connectionString: databaseUrl });
    let coachId = 0;
    let createdCallId = 0;

    try {
      // Seed a coach so the schedule editor's coach dropdown has a known,
      // isolated option to pick. globalSetup only seeds an admin + member.
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, call_types)
         VALUES ($1, 'E2E bio', 'E2E specialties', ARRAY['weekly_qa'])
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      await loginAsAdmin(page, fixture);

      await page.goto("/admin/coaching/calls");

      // The "Add Call" button only renders behind the coaching:view permission,
      // so it doubles as a RBAC guard for the admin landing here. Use a generous
      // timeout: on a cold dev server Vite can take a while to first-compile the
      // route before the page paints.
      const addCallButton = page.getByTestId("add-call");
      await expect(addCallButton).toBeVisible({ timeout: 30_000 });

      // --- CREATE -------------------------------------------------------------
      await addCallButton.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      await page.getByTestId("call-title").fill(callTitle);

      // Pick our seeded coach (Radix Select renders options into a portal).
      await page.getByTestId("call-coach").click();
      await page.getByRole("option", { name: coachName }).click();

      // datetime-local wants "yyyy-MM-dd'T'HH:mm" in local time; schedule it a
      // week out so it's unambiguously in the future.
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const localValue = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(
        future.getDate(),
      )}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
      await page.getByTestId("call-scheduled-at").fill(localValue);

      await page.getByTestId("call-meet-link").fill(originalMeetLink);

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            /\/api\/admin\/coaching\/calls$/.test(res.url()) &&
            res.request().method() === "POST",
          { timeout: 30_000 },
        ),
        page.getByTestId("save-call").click(),
      ]);
      expect(
        createResponse.ok(),
        `Create call API failed (${createResponse.status()} ${createResponse.statusText()})`,
      ).toBe(true);
      createdCallId = ((await createResponse.json()) as { id: number }).id;
      expect(createdCallId).toBeGreaterThan(0);

      // The list should now show the new call card (proves the list refetch +
      // the create round-trip both succeeded against the real API).
      const callCard = page.getByTestId(`call-${createdCallId}`);
      await expect(callCard).toBeVisible({ timeout: 15_000 });
      await expect(callCard).toContainText(callTitle);
      await expect(callCard).toContainText(originalMeetLink);
      await expect(callCard).toContainText(coachName);

      // Confirm the row was persisted with the values we entered.
      const afterCreate = await pool.query<{
        title: string;
        coach_id: number;
        meet_link: string | null;
      }>(`SELECT title, coach_id, meet_link FROM coaching_calls WHERE id = $1`, [
        createdCallId,
      ]);
      expect(afterCreate.rowCount).toBe(1);
      expect(afterCreate.rows[0].title).toBe(callTitle);
      expect(afterCreate.rows[0].coach_id).toBe(coachId);
      expect(afterCreate.rows[0].meet_link).toBe(originalMeetLink);

      // --- EDIT MEET LINK -----------------------------------------------------
      await callCard.getByTestId(`edit-call-${createdCallId}`).click();
      await expect(page.getByRole("dialog")).toBeVisible();

      const meetLinkInput = page.getByTestId("call-meet-link");
      await expect(meetLinkInput).toHaveValue(originalMeetLink);
      await meetLinkInput.fill(editedMeetLink);

      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/admin/coaching/calls/${createdCallId}`) &&
            res.request().method() === "PATCH",
          { timeout: 30_000 },
        ),
        page.getByTestId("save-call").click(),
      ]);
      expect(
        updateResponse.ok(),
        `Update call API failed (${updateResponse.status()} ${updateResponse.statusText()})`,
      ).toBe(true);

      // The card should reflect the edited Meet link after the list refetch.
      await expect(callCard).toContainText(editedMeetLink, { timeout: 15_000 });
      await expect(callCard).not.toContainText(originalMeetLink);

      const afterEdit = await pool.query<{ meet_link: string | null }>(
        `SELECT meet_link FROM coaching_calls WHERE id = $1`,
        [createdCallId],
      );
      expect(afterEdit.rows[0].meet_link).toBe(editedMeetLink);

      // --- DELETE -------------------------------------------------------------
      await callCard.getByTestId(`delete-call-${createdCallId}`).click();

      const confirmDelete = page.getByTestId("confirm-delete-call");
      await expect(confirmDelete).toBeVisible();

      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes(`/api/admin/coaching/calls/${createdCallId}`) &&
            res.request().method() === "DELETE",
          { timeout: 30_000 },
        ),
        confirmDelete.click(),
      ]);
      expect(
        deleteResponse.ok(),
        `Delete call API failed (${deleteResponse.status()} ${deleteResponse.statusText()})`,
      ).toBe(true);

      // The card should disappear from the list once the delete + refetch land.
      await expect(callCard).toHaveCount(0, { timeout: 15_000 });

      // And the row should be gone from the database end to end.
      const afterDelete = await pool.query(
        `SELECT id FROM coaching_calls WHERE id = $1`,
        [createdCallId],
      );
      expect(afterDelete.rowCount).toBe(0);
      createdCallId = 0;
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into
      // the shared DB for other specs.
      try {
        if (createdCallId) {
          await pool.query(`DELETE FROM coaching_calls WHERE id = $1`, [
            createdCallId,
          ]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            coachId,
          ]);
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [coachId]);
        }
      } catch {
        /* best-effort cleanup */
      }
      await pool.end();
    }
  });
});
