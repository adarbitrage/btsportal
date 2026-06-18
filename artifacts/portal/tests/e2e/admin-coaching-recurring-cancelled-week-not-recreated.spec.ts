import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { apiLogin, cookieHeader, AUTH_URL } from "./auth";

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

// Guards the core isolation guarantee of recurring-call generation: once an
// admin CANCELS (deletes) a single generated week, that exact occurrence must
// never silently reappear on a later "generate" pass. Generation moves strictly
// forward from the template watermark (lastGeneratedAt), and the unique
// (template_id, scheduled_at) constraint + onConflictDoNothing make it
// idempotent — together those two mechanisms are what stop a cancelled week
// from being re-created. There was no automated coverage for that promise, so a
// regression in nextOccurrences (e.g. re-deriving from the anchor instead of
// the watermark) or a dropped unique constraint could resurrect cancelled weeks
// unnoticed.
//
// This is an API + DB spec (no browser): it drives the REAL admin write paths
// (POST templates -> generate, DELETE a generated call, POST /generate again)
// and asserts directly against the persisted coaching_calls rows.
test.describe("Admin recurring calls — a cancelled week is never re-created", () => {
  test("deleting a generated occurrence keeps it gone after the next /generate", async () => {
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the cancelled-week recurring E2E test (it seeds a coach + template and cleans them up).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E CancelCoach ${tag}`;
    const templateTitle = `E2E Cancel Weekly Call ${tag}`;
    const meetLink = "https://meet.google.com/e2e-cancel-week";

    // First occurrence a week out at a fixed time so the whole series is
    // unambiguously "upcoming". Weekly cadence => each batch lands on the same
    // weekday/time, interval weeks apart.
    const anchorAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    anchorAt.setHours(9, 0, 0, 0);
    const intervalDays = 7;
    const occurrencesPerBatch = 4;

    const pool = new Pool({ connectionString: databaseUrl });

    let coachId = 0;
    let templateId = 0;

    try {
      // --- Seed an isolated coach for the template ---------------------------
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, does_group_calls, is_active)
         VALUES ($1, 'E2E cancel coach bio', 'E2E specialties', true, true)
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      // --- Create the recurring template (generates the first batch) ---------
      const adminLogin = await apiLogin(fixture.adminEmail, fixture.adminPassword);
      expect(
        adminLogin.ok,
        `Admin login failed (HTTP ${adminLogin.status})`,
      ).toBe(true);
      const adminCookie = cookieHeader(adminLogin.setCookies);

      const createRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({
            title: templateTitle,
            description: "Recurring weekly call for the cancelled-week E2E.",
            callType: "weekly_qa",
            coachId,
            anchorAt: anchorAt.toISOString(),
            durationMinutes: 60,
            intervalDays,
            occurrencesPerBatch,
            meetLink,
            requiredEntitlement: "coaching:group",
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        createRes.ok,
        `Admin create template API failed (HTTP ${createRes.status})`,
      ).toBe(true);
      const createBody = (await createRes.json()) as {
        template: { id: number };
        generated: number;
      };
      templateId = createBody.template.id;
      expect(templateId).toBeGreaterThan(0);
      expect(createBody.generated).toBe(occurrencesPerBatch);

      // Read back the first batch (ordered by time) to learn ids + slots.
      const firstBatch = await pool.query<{ id: number; scheduled_at: string }>(
        `SELECT id, scheduled_at
           FROM coaching_calls
          WHERE template_id = $1
          ORDER BY scheduled_at ASC`,
        [templateId],
      );
      expect(firstBatch.rows.length).toBe(occurrencesPerBatch);
      const firstBatchIds = firstBatch.rows.map((r) => r.id);
      const firstBatchSlots = firstBatch.rows.map((r) =>
        new Date(r.scheduled_at).getTime(),
      );

      // --- CANCEL the middle week via the real call-delete endpoint ---------
      // Picking an interior occurrence (not the last) is deliberate: deleting
      // the last week would leave the watermark exactly at the deleted slot, so
      // a "re-create the cancelled week" bug could only manifest via the unique
      // constraint. Deleting an interior week proves the watermark itself —
      // already advanced past this slot — never rewinds to regenerate it.
      const cancelledIndex = 1;
      const cancelledCallId = firstBatchIds[cancelledIndex];
      const cancelledSlot = firstBatchSlots[cancelledIndex];

      const deleteRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/${cancelledCallId}`,
        {
          method: "DELETE",
          headers: { cookie: adminCookie },
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        deleteRes.ok,
        `Cancel (delete) call API failed (HTTP ${deleteRes.status})`,
      ).toBe(true);

      // It's gone right now.
      const afterDelete = await pool.query(
        `SELECT id FROM coaching_calls WHERE id = $1`,
        [cancelledCallId],
      );
      expect(afterDelete.rowCount).toBe(0);

      // --- GENERATE the next batch -----------------------------------------
      const generateRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        generateRes.ok,
        `Template /generate API failed (HTTP ${generateRes.status})`,
      ).toBe(true);
      const generateBody = (await generateRes.json()) as { generated: number };
      // The next pass produces a full fresh batch of FUTURE weeks — it does not
      // "fill the hole" left by the cancelled week.
      expect(generateBody.generated).toBe(occurrencesPerBatch);

      // --- Assert the cancelled week stayed gone ----------------------------
      const afterGenerate = await pool.query<{ id: number; scheduled_at: string }>(
        `SELECT id, scheduled_at
           FROM coaching_calls
          WHERE template_id = $1
          ORDER BY scheduled_at ASC`,
        [templateId],
      );
      const allRows = afterGenerate.rows;
      const allIds = allRows.map((r) => r.id);
      const allSlots = allRows.map((r) => new Date(r.scheduled_at).getTime());

      // The deleted row's id never comes back.
      expect(allIds).not.toContain(cancelledCallId);

      // Nothing was generated for the cancelled week's exact slot, either —
      // proves the watermark moved strictly forward rather than re-deriving the
      // hole from the anchor.
      expect(allSlots).not.toContain(cancelledSlot);

      // We kept the 3 surviving original weeks and added a full new batch:
      // (batch - 1 survivors) + batch new = 2*batch - 1 total.
      expect(allRows.length).toBe(occurrencesPerBatch * 2 - 1);

      // The genuinely-new occurrences are everything that isn't a surviving
      // first-batch row; they must be exactly `occurrencesPerBatch` and all land
      // strictly AFTER the last original week (forward-only generation).
      const survivingFirstBatchIds = firstBatchIds.filter(
        (id) => id !== cancelledCallId,
      );
      const newIds = allIds.filter(
        (id) => !survivingFirstBatchIds.includes(id),
      );
      expect(newIds.length).toBe(occurrencesPerBatch);

      const lastOriginalSlot = Math.max(...firstBatchSlots);
      for (const row of allRows) {
        if (newIds.includes(row.id)) {
          expect(new Date(row.scheduled_at).getTime()).toBeGreaterThan(
            lastOriginalSlot,
          );
        }
      }

      // Every surviving original week is still present and untouched.
      for (const id of survivingFirstBatchIds) {
        expect(allIds).toContain(id);
      }
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into the
      // shared DB for other specs. Generated calls reference the template
      // (ON DELETE SET NULL), so remove the calls first, then the template.
      try {
        if (templateId) {
          await pool.query(`DELETE FROM coaching_calls WHERE template_id = $1`, [
            templateId,
          ]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            coachId,
          ]);
          await pool.query(
            `DELETE FROM coaching_call_templates WHERE coach_id = $1`,
            [coachId],
          );
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [coachId]);
        }
      } catch (err) {
        console.error("[e2e] cancelled-week cleanup failed:", err);
      }
      await pool.end();
    }
  });
});
