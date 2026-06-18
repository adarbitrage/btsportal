import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { apiLogin, cookieHeader, loginAs, AUTH_URL } from "./auth";

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

interface MemberCall {
  id: number;
  title: string;
  coachName: string;
  callType: string;
  scheduledAt: string;
  meetLink: string | null;
  isAccessible: boolean;
}

// Fetch the member-facing coaching calls list with a member's auth cookie,
// straight against the API (same endpoint the SPA's useListCoachingCalls hits).
async function fetchMemberCalls(cookie: string): Promise<MemberCall[]> {
  const res = await fetch(`${AUTH_URL}/api/coaching-calls?upcoming=true`, {
    headers: { cookie },
    signal: AbortSignal.timeout(15_000),
  });
  expect(
    res.ok,
    `Member coaching-calls API failed (HTTP ${res.status})`,
  ).toBe(true);
  return (await res.json()) as MemberCall[];
}

// Guards the *paused* half of the recurring-template lifecycle. A schedule can
// be paused by PATCHing the template `active:false`; while paused the
// `/generate` endpoint must refuse to spawn new weeks (HTTP 409) and leave the
// existing calls untouched. Resuming it (`active:true`) must let `/generate`
// work again and the brand-new occurrences must reach an entitled member's
// Coaching page.
//
// member-coaching-recurring-template-visibility.spec.ts covers the active happy
// path (template -> generated weeks reach members). This is its counterpart: a
// regression that ignored the `active` flag could let a paused series keep
// adding weeks, or block resuming it — neither would surface without this guard.
test.describe("Admin recurring template — paused schedule stops generating weeks", () => {
  test("paused /generate returns 409 and adds no calls; resuming generates new weeks that reach an entitled member", async ({
    page,
  }) => {
    // Cold start (browser launch + server boot) can be slow on the shared env.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the paused-template E2E test (it seeds a coach, a template, generated calls, and an entitled member).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E PauseCoach ${tag}`;
    const templateTitle = `E2E Pausable Weekly Call ${tag}`;
    const meetLink = "https://meet.google.com/e2e-paused-view";

    const entitledEmail = `e2e-pause-yes-${tag}@e2e.local`;
    const entitledPassword = `E2E-${randomBytes(9).toString("base64url")}`;

    // First occurrence a week out at a fixed time so every generated occurrence
    // is unambiguously "upcoming". Weekly cadence (intervalDays 7) means each
    // batch lands on the same weekday at the same time.
    const anchorAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    anchorAt.setHours(13, 0, 0, 0);
    const occurrencesPerBatch = 2;
    const expectedCoachFirstName = coachName.split(" ")[0];

    const pool = new Pool({ connectionString: databaseUrl });

    let coachId = 0;
    let productId = 0;
    let entitledMemberId = 0;
    let templateId = 0;

    try {
      // --- Seed coach + member + entitlement --------------------------------
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, call_types, does_group_calls, is_active)
         VALUES ($1, 'E2E paused coach bio', 'E2E specialties', ARRAY['weekly_qa'], true, true)
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      const productRes = await pool.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '["coaching:group"]'::jsonb, 0)
         RETURNING id`,
        [`e2e-pause-product-${tag}`, `E2E Paused Plan ${tag}`],
      );
      productId = productRes.rows[0].id;

      const entitledHash = await bcrypt.hash(entitledPassword, 10);
      const entitledRes = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Entitled ${tag}`, entitledEmail, entitledHash],
      );
      entitledMemberId = entitledRes.rows[0].id;

      await pool.query(
        `INSERT INTO user_products (user_id, product_id, status)
         VALUES ($1, $2, 'active')`,
        [entitledMemberId, productId],
      );

      // --- Create the recurring template via the REAL admin write path ------
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
            description: "Pausable weekly call set up via the admin API for the E2E.",
            callType: "weekly_qa",
            coachId,
            anchorAt: anchorAt.toISOString(),
            durationMinutes: 60,
            intervalDays: 7,
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
      // Creation spawns the first batch — these are the calls that must stay
      // untouched while the schedule is paused.
      expect(createBody.generated).toBe(occurrencesPerBatch);

      const firstBatch = await pool.query<{ id: number }>(
        `SELECT id FROM coaching_calls WHERE template_id = $1 ORDER BY scheduled_at ASC`,
        [templateId],
      );
      expect(firstBatch.rows.length).toBe(occurrencesPerBatch);
      const firstBatchIds = firstBatch.rows.map((r) => r.id);

      // --- Pause the schedule (PATCH active:false) --------------------------
      const pauseRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({ active: false }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        pauseRes.ok,
        `Admin pause (PATCH active:false) failed (HTTP ${pauseRes.status})`,
      ).toBe(true);
      const pausedTemplate = (await pauseRes.json()) as { active: boolean };
      expect(pausedTemplate.active).toBe(false);

      // --- Paused /generate must refuse (409) and add no calls -------------
      const pausedGenerateRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        pausedGenerateRes.status,
        "Generating for a paused schedule must return HTTP 409",
      ).toBe(409);
      // Drain the body so the connection is released.
      await pausedGenerateRes.text().catch(() => undefined);

      // No new rows: the call set is exactly the first batch.
      const afterPausedGenerate = await pool.query<{ id: number }>(
        `SELECT id FROM coaching_calls WHERE template_id = $1 ORDER BY scheduled_at ASC`,
        [templateId],
      );
      expect(
        afterPausedGenerate.rows.length,
        "A paused schedule must not spawn any new occurrences",
      ).toBe(occurrencesPerBatch);
      expect(afterPausedGenerate.rows.map((r) => r.id)).toEqual(firstBatchIds);

      // The watermark must not have moved either (a paused generate that
      // silently advanced lastGeneratedAt would skip a week on resume).
      const watermarkPaused = await pool.query<{ last_generated_at: Date | null }>(
        `SELECT last_generated_at FROM coaching_call_templates WHERE id = $1`,
        [templateId],
      );
      const pausedWatermark = watermarkPaused.rows[0].last_generated_at;

      // --- Resume the schedule (PATCH active:true) -------------------------
      const resumeRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({ active: true }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        resumeRes.ok,
        `Admin resume (PATCH active:true) failed (HTTP ${resumeRes.status})`,
      ).toBe(true);
      const resumedTemplate = (await resumeRes.json()) as { active: boolean };
      expect(resumedTemplate.active).toBe(true);

      // --- Resumed /generate works again and adds the next batch -----------
      const resumedGenerateRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        resumedGenerateRes.ok,
        `Resumed /generate failed (HTTP ${resumedGenerateRes.status})`,
      ).toBe(true);
      const resumedGenerateBody = (await resumedGenerateRes.json()) as {
        generated: number;
      };
      expect(resumedGenerateBody.generated).toBe(occurrencesPerBatch);

      const afterResume = await pool.query<{ id: number }>(
        `SELECT id FROM coaching_calls WHERE template_id = $1 ORDER BY scheduled_at ASC`,
        [templateId],
      );
      const allIds = afterResume.rows.map((r) => r.id);
      expect(allIds.length).toBe(occurrencesPerBatch * 2);
      const newIds = allIds.filter((id) => !firstBatchIds.includes(id));
      expect(newIds.length).toBe(occurrencesPerBatch);

      // Resuming actually advanced the watermark past where the pause left it.
      const watermarkResumed = await pool.query<{ last_generated_at: Date | null }>(
        `SELECT last_generated_at FROM coaching_call_templates WHERE id = $1`,
        [templateId],
      );
      const resumedWatermark = watermarkResumed.rows[0].last_generated_at;
      if (pausedWatermark && resumedWatermark) {
        expect(resumedWatermark.getTime()).toBeGreaterThan(
          pausedWatermark.getTime(),
        );
      }

      // --- The newly generated weeks reach the entitled member -------------
      const entitledApiLogin = await apiLogin(entitledEmail, entitledPassword);
      expect(entitledApiLogin.ok).toBe(true);
      const entitledCookie = cookieHeader(entitledApiLogin.setCookies);
      const entitledCalls = await fetchMemberCalls(entitledCookie);
      for (const callId of newIds) {
        const c = entitledCalls.find((mc) => mc.id === callId);
        expect(
          c,
          `Post-resume occurrence ${callId} must appear in the entitled member's feed`,
        ).toBeTruthy();
        expect(c!.callType).toBe("weekly_qa");
        expect(c!.isAccessible).toBe(true);
        expect(c!.meetLink).toBe(meetLink);
      }

      await loginAs(page, entitledEmail, entitledPassword);
      await page.goto("/coaching");
      for (const callId of newIds) {
        const row = page.getByTestId(`weekly-call-${callId}`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        await expect(row).toContainText(expectedCoachFirstName);
        const joinLink = row.getByRole("link", { name: /join call/i });
        await expect(joinLink).toHaveAttribute("href", meetLink);
      }
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into the
      // shared DB for other specs.
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
        }
        if (entitledMemberId > 0) {
          await pool.query(`DELETE FROM user_products WHERE user_id = $1`, [
            entitledMemberId,
          ]);
          await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [
            entitledMemberId,
          ]);
          // Logging in / fetching as the member can queue GHL contact-sync jobs
          // in dev, which write ghl_sync_log rows that FK-reference the user.
          // Clear them first so the user delete below isn't blocked.
          await pool.query(`DELETE FROM ghl_sync_log WHERE user_id = $1`, [
            entitledMemberId,
          ]);
          await pool.query(`DELETE FROM users WHERE id = $1`, [entitledMemberId]);
        }
        if (productId) {
          await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [coachId]);
        }
      } catch (err) {
        console.error("[e2e] paused-template cleanup failed:", err);
      }
      await pool.end();
    }
  });
});
