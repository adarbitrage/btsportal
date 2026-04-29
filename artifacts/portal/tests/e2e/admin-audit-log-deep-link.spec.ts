import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

// Seed enough queue_fallback rows to push our `pageTwoTargetId` past page 1 of
// the audit log when filtered by `actionType=queue_fallback&entityType=queue`
// (the same filter the System Health deep-link emits). Page size is 50.
const SEEDED_ROWS = 130;
const PAGE_SIZE = 50;
// Pick a target at newest-first index 75 — i.e. the 76th-newest queue_fallback
// row in our batch. With page size 50 that lands on page 2 (rows 51-100).
const PAGE2_TARGET_NEWEST_INDEX = 75;

const seededIds: number[] = [];
let pool: Pool | null = null;
let newestTargetId = 0;
let pageTwoTargetId = 0;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the audit-log deep-link E2E test (it seeds and tears down its own fixtures).",
    );
  }

  pool = new Pool({ connectionString: url });

  // Use timestamps far in the future so our seeded rows are guaranteed to be
  // the newest queue_fallback rows in the table, regardless of whatever
  // already exists in the dev database. This keeps the page-resolution math
  // for the deep-link deterministic across environments.
  const baseMs = Date.now() + 24 * 60 * 60 * 1000;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < SEEDED_ROWS; i++) {
      const metadata = JSON.stringify({
        channel: "email",
        recipient: `e2e-recip-${i}@e2e.local`,
        reason: "e2e seeded queue fallback",
      });
      const result = await client.query<{ id: number }>(
        `INSERT INTO audit_log (action_type, entity_type, entity_id, description, metadata, created_at)
         VALUES ('queue_fallback', 'queue', 'email', $1, $2::jsonb, $3)
         RETURNING id`,
        [`e2e seeded queue fallback ${i}`, metadata, new Date(baseMs + i)],
      );
      seededIds.push(result.rows[0].id);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Seeded oldest-first → reverse for newest-first order, matching what the
  // /admin/audit-log endpoint returns when sorted by (created_at desc, id desc).
  const newestFirst = [...seededIds].reverse();
  // The very newest row — guaranteed to be visible in the System Health
  // "Recent queue-fallback events" card (which shows the newest 50) AND on
  // page 1 of the audit log.
  newestTargetId = newestFirst[0];
  // An older row that is not in the System Health top 50 and lives on page 2
  // of the audit log under the queue_fallback filter.
  pageTwoTargetId = newestFirst[PAGE2_TARGET_NEWEST_INDEX];
});

test.afterAll(async () => {
  if (!pool) return;
  try {
    if (seededIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query(`DELETE FROM audit_log WHERE id = ANY($1::int[])`, [seededIds]);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
    pool = null;
  }
});

async function loginAsAdmin(page: Page, request: APIRequestContext, fixture: E2EFixture): Promise<void> {
  // Log in via the API and forward the access_token cookie into the browser
  // context, mirroring the other e2e specs (avoids flakiness on /login).
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

test.describe("Audit Log deep-link from System Health", () => {
  test("clicking the System Health link opens the audit log with the row pre-expanded", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);

    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", { name: /System Health/i }),
    ).toBeVisible();

    // Wait for the queue-fallback events card to populate from the API.
    const auditLink = page.getByTestId(`link-audit-${newestTargetId}`);
    await expect(auditLink).toBeVisible({ timeout: 15_000 });

    // Make sure the link href encodes the same filter+expand combo the
    // audit log page parses on load — a regression here would silently break
    // the deep-link feature even before we click.
    const href = await auditLink.getAttribute("href");
    expect(href, "System Health audit link must include the deep-link query").toMatch(
      new RegExp(
        `^/admin/audit-log\\?actionType=queue_fallback&entityType=queue&expand=${newestTargetId}$`,
      ),
    );

    await Promise.all([
      page.waitForURL(new RegExp(`/admin/audit-log\\?.*expand=${newestTargetId}`)),
      auditLink.click(),
    ]);

    await expect(page.getByRole("heading", { name: /Audit Log/i })).toBeVisible();

    // Wait for the loading spinner to clear (logs render once the API returns).
    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });

    const targetRow = page.getByTestId(`audit-row-${newestTargetId}`);
    await expect(targetRow).toBeVisible();
    // The expanded panel ships the "Entity ID:" label — its presence inside
    // the target row proves the auto-expand effect ran for the deep-linked id.
    await expect(targetRow.getByText(/Entity ID:/i)).toBeVisible();
    await expect(targetRow).toBeInViewport();
  });

  test("deep-linking to an older row jumps past page 1 with the row expanded and scrolled into view", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);

    // Reproduce exactly the URL System Health builds for an older fallback —
    // we just can't get there from the System Health UI because that card is
    // capped at 50 rows. The router/auto-expand/scroll behavior is identical.
    await page.goto(
      `/admin/audit-log?actionType=queue_fallback&entityType=queue&expand=${pageTwoTargetId}`,
    );

    await expect(page.getByRole("heading", { name: /Audit Log/i })).toBeVisible();
    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });

    // Page 2 of a 50-row page size renders rows 51-100 — assert the
    // pagination footer lands there, proving the API page-resolution math
    // ran end-to-end for an older deep-link.
    await expect(
      page.getByText(new RegExp(`Showing ${PAGE_SIZE + 1} - ${PAGE_SIZE * 2} of`)),
    ).toBeVisible({ timeout: 15_000 });

    const targetRow = page.getByTestId(`audit-row-${pageTwoTargetId}`);
    await expect(targetRow).toBeVisible();
    await expect(targetRow.getByText(/Entity ID:/i)).toBeVisible();
    // The auto-scroll effect uses smooth behavior, so allow Playwright's
    // default polling on toBeInViewport to wait for the animation to settle.
    await expect(targetRow).toBeInViewport();
  });
});
