import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";

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

async function loginAsAdmin(
  page: Page,
  request: APIRequestContext,
  fixture: E2EFixture,
): Promise<void> {
  const loginRes = await request.post("/api/auth/login", {
    data: { email: fixture.adminEmail, password: fixture.adminPassword },
  });
  expect(
    loginRes.ok(),
    `Login API call failed (${loginRes.status()} ${loginRes.statusText()})`,
  ).toBe(true);

  const setCookieHeader = loginRes.headers()["set-cookie"];
  expect(setCookieHeader, "Login should return an access_token cookie").toBeTruthy();

  const cookies = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
    .flatMap((header) => header.split(/,(?=[^;]+=)/g))
    .map((raw) => {
      const [pair] = raw.split(";");
      const [name, ...valueParts] = pair.split("=");
      const value = valueParts.join("=");
      return name && value ? { name: name.trim(), value: value.trim() } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);

  const baseUrlObj = new URL(process.env.E2E_BASE_URL ?? "http://localhost:25265");
  await page.context().addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: baseUrlObj.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

test.describe("Admin Ticket Detail — Canned Response picker", () => {
  test("opens the picker, lists seeded canned responses from the API, and inserts the body into the reply box", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the admin Canned Response picker E2E test (it seeds its own ticket).",
      );
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const ticketNumber = `E2E-CR-${randomBytes(4).toString("hex").toUpperCase()}`;
    let ticketId = 0;

    try {
      // Seed a single ticket owned by the fixture member so the admin can open
      // /admin/tickets/:id without depending on whatever else exists in the dev DB.
      const ticketRes = await pool.query<{ id: number }>(
        `INSERT INTO tickets (ticket_number, user_id, category, priority, status, subject)
         VALUES ($1, $2, 'other', 'normal', 'open', $3)
         RETURNING id`,
        [ticketNumber, fixture.memberId, `E2E canned response picker ticket ${fixture.tag}`],
      );
      ticketId = ticketRes.rows[0].id;

      // Sanity: the seeded canned responses (see seed-canned-responses.ts) must
      // already be present. The picker depends on this exact seeded row, so we
      // grab one to assert against rather than relying on a hard-coded title
      // that could drift if the seed list is reordered.
      const seededRow = await pool.query<{ id: number; title: string; body: string }>(
        `SELECT id, title, body FROM canned_responses ORDER BY sort_order ASC LIMIT 1`,
      );
      expect(
        seededRow.rowCount,
        "Seeded canned responses must exist for this test (see seed-canned-responses.ts)",
      ).toBeGreaterThan(0);
      const seeded = seededRow.rows[0];

      await loginAsAdmin(page, request, fixture);

      await page.goto(`/admin/tickets/${ticketId}`);

      // Page header for the seeded ticket renders once /admin/tickets/:id loads.
      await expect(page.getByTestId("ticket-number")).toHaveText(ticketNumber, {
        timeout: 15_000,
      });

      // Open the picker. The button has no data-testid; the visible label is stable.
      // Wait for the GET to /admin/canned-responses so we know the dialog has live data.
      const [cannedResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            /\/api\/admin\/canned-responses(\?|$)/.test(res.url()) &&
            res.request().method() === "GET",
          { timeout: 15_000 },
        ),
        page.getByRole("button", { name: /Canned Response/i }).click(),
      ]);
      expect(
        cannedResponse.ok(),
        `GET /admin/canned-responses failed (${cannedResponse.status()} ${cannedResponse.statusText()})`,
      ).toBe(true);

      // Dialog renders the seeded row keyed by its real DB id — this is the
      // bit that would regress if the picker reverted to mock fixtures (mocks
      // used hardcoded ids that wouldn't match what's in the database).
      const seededRowLocator = page.getByTestId(`canned-response-${seeded.id}`);
      await expect(seededRowLocator).toBeVisible({ timeout: 10_000 });
      await expect(seededRowLocator).toContainText(seeded.title);

      // The reply textarea has no data-testid; use its placeholder.
      const replyBox = page.getByPlaceholder("Type your reply here...");
      await expect(replyBox).toBeVisible();
      await expect(replyBox).toHaveValue("");

      await seededRowLocator.click();

      // Picker closes and the body (with {{variables}} substituted) lands in the reply box.
      await expect(seededRowLocator).toHaveCount(0, { timeout: 10_000 });

      // The picker substitutes {{member_name}} / {{ticket_number}} etc. before
      // inserting. Pick the longest variable-free chunk of the seeded body
      // and assert it appears verbatim in the textarea — this proves the
      // insert path ran end-to-end without coupling the test to any specific
      // substitution rule.
      const stableSlice = seeded.body
        .split(/\{\{[^}]+\}\}/g)
        .map((s) => s.trim())
        .sort((a, b) => b.length - a.length)[0];
      expect(stableSlice && stableSlice.length).toBeGreaterThan(0);

      await expect(replyBox).not.toHaveValue("");
      const inserted = await replyBox.inputValue();
      expect(inserted).toContain(stableSlice);
    } finally {
      // Clean up the seeded ticket (and any audit-log rows referring to it)
      // so reruns stay isolated. Defensive — failures here shouldn't fail the test.
      try {
        if (ticketId > 0) {
          await pool.query(`DELETE FROM ticket_sla WHERE ticket_id = $1`, [ticketId]);
          await pool.query(`DELETE FROM ticket_messages WHERE ticket_id = $1`, [ticketId]);
          await pool.query(
            `DELETE FROM audit_log WHERE entity_type = 'ticket' AND entity_id = $1`,
            [String(ticketId)],
          );
          await pool.query(`DELETE FROM tickets WHERE id = $1`, [ticketId]);
        }
      } catch (err) {
        console.error("[e2e] canned-response picker cleanup failed:", err);
      } finally {
        await pool.end();
      }
    }
  });
});
