import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type Locator, type APIRequestContext } from "@playwright/test";
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

// Unique marker so our seeded rows are unmistakable in a shared dev DB and so
// cleanup only touches what this spec created.
const TAG = `e2e-aiflag-${randomBytes(5).toString("hex")}`;

// We park our rows in two far-apart, far-future date windows. Future dates
// guarantee these are the only rows inside each window regardless of whatever
// the dev DB already holds, which makes the date-range filter (and therefore
// the pagination assertions) fully deterministic.
const FILTER_DAY = "2098-06-15"; // window B — filter-narrowing rows live here
const FILTER_FROM = "2098-06-01";
const FILTER_TO = "2098-06-30";

const PAGE_DAY_BASE_MS = Date.UTC(2099, 5, 10, 12, 0, 0); // window A — pagination rows
const PAGE_FROM = "2099-06-01";
const PAGE_TO = "2099-06-30";
const PAGE_ROWS = 30; // > default page size (25) so a second page exists

// A window with nothing in it, to exercise the empty state.
const EMPTY_FROM = "2097-01-01";
const EMPTY_TO = "2097-01-02";

const LOW_BODY = `${TAG} low-score-row`;
const HIGH_BODY = `${TAG} high-score-row`;
const APPROVED_BODY = `${TAG} approved-row`;
const COMBINED_BODY = `${TAG} combined-row`;

let pool: Pool | null = null;
let authorId = 0;

async function insertQueueRow(
  client: import("pg").PoolClient,
  opts: {
    triggeredBy: string;
    scores: { toxicity?: number; spam?: number; harassment?: number; hate_speech?: number };
    flagThreshold: number;
    status: string;
    body: string;
    createdAt: Date;
  },
): Promise<void> {
  const scores = {
    toxicity: opts.scores.toxicity ?? 0,
    spam: opts.scores.spam ?? 0,
    harassment: opts.scores.harassment ?? 0,
    hate_speech: opts.scores.hate_speech ?? 0,
  };
  await client.query(
    `INSERT INTO moderation_queue
       (target_type, target_id, author_id, body, status, triggered_by,
        wordlist_matches, ai_scores, flag_threshold, created_at)
     VALUES ('post', 1, $1, $2, $3, $4, '[]'::jsonb, $5::jsonb, $6, $7)`,
    [
      authorId,
      opts.body,
      opts.status,
      opts.triggeredBy,
      JSON.stringify(scores),
      opts.flagThreshold,
      opts.createdAt,
    ],
  );
}

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the AI-flagged dashboard E2E test (it seeds and tears down its own fixtures).",
    );
  }

  pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const authorRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [`AI Flag Author ${TAG}`, `${TAG}-author@e2e.local`, "x"],
    );
    authorId = authorRes.rows[0].id;

    // Window B: four rows used to prove each filter narrows the list.
    const day = new Date(`${FILTER_DAY}T12:00:00Z`);
    await insertQueueRow(client, {
      triggeredBy: "ai_classifier",
      scores: { toxicity: 0.3, spam: 0.1 },
      flagThreshold: 0.5,
      status: "pending",
      body: LOW_BODY,
      createdAt: day,
    });
    await insertQueueRow(client, {
      triggeredBy: "ai_classifier",
      scores: { toxicity: 0.95, spam: 0.2 },
      flagThreshold: 0.7,
      status: "pending",
      body: HIGH_BODY,
      createdAt: day,
    });
    await insertQueueRow(client, {
      triggeredBy: "ai_classifier",
      scores: { toxicity: 0.9, harassment: 0.4 },
      flagThreshold: 0.6,
      status: "approved",
      body: APPROVED_BODY,
      createdAt: day,
    });
    await insertQueueRow(client, {
      triggeredBy: "combined",
      scores: { toxicity: 0.6, spam: 0.4 },
      flagThreshold: 0.5,
      status: "pending",
      body: COMBINED_BODY,
      createdAt: day,
    });

    // Window A: enough uniform rows to force a second page of results.
    for (let i = 0; i < PAGE_ROWS; i++) {
      await insertQueueRow(client, {
        triggeredBy: "ai_classifier",
        scores: { toxicity: 0.9 },
        flagThreshold: 0.7,
        status: "pending",
        body: `${TAG} pgA-row ${i}`,
        createdAt: new Date(PAGE_DAY_BASE_MS + i * 1000),
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

test.afterAll(async () => {
  if (!pool) return;
  try {
    if (authorId) {
      const client = await pool.connect();
      try {
        await client.query(`DELETE FROM moderation_queue WHERE author_id = $1`, [authorId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [authorId]);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
    pool = null;
  }
});

// Scope to a single rendered row by its body text. The blockquote holds the
// body; its enclosing `.flex-1` wrapper also contains the badges and score
// pills, so it's the right unit to assert per-row rendering against.
function rowByBody(page: Page, body: string): Locator {
  return page
    .locator("blockquote", { hasText: body })
    .locator('xpath=ancestor::div[contains(@class,"flex-1")][1]');
}

async function applyFilters(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Apply" }).click();
}

async function setDateRange(page: Page, from: string, to: string): Promise<void> {
  await page.locator("#ai-flagged-from").fill(from);
  await page.locator("#ai-flagged-to").fill(to);
}

test.describe("Admin AI-Flagged dashboard", () => {
  test.beforeEach(async ({ page, request }) => {
    const fixture = loadFixture();
    await loginAsAdmin(page, request, fixture);
    await page.goto("/admin/moderation/ai-flagged");
    await expect(
      page.getByRole("heading", { name: "AI Flagged" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("renders score, threshold-at-the-time, and trigger reason per row", async ({ page }) => {
    // Narrow to our isolated window so only the four window-B rows show.
    await setDateRange(page, FILTER_FROM, FILTER_TO);
    await applyFilters(page);

    const high = rowByBody(page, HIGH_BODY);
    await expect(high).toBeVisible();
    // Max-score badge, threshold-in-effect, and trigger reason all render.
    await expect(high.getByText("max 0.95")).toBeVisible();
    await expect(high.getByText("threshold 0.70")).toBeVisible();
    await expect(high.getByText("AI classifier")).toBeVisible();
    // Per-class score pills are present.
    await expect(high.getByText("toxicity", { exact: false })).toBeVisible();

    // The combined row reports the wordlist-assisted trigger reason.
    const combined = rowByBody(page, COMBINED_BODY);
    await expect(combined).toBeVisible();
    await expect(combined.getByText("AI + wordlist")).toBeVisible();
    await expect(combined.getByText("threshold 0.50")).toBeVisible();

    // The low-score row is here too (no score filter yet).
    await expect(rowByBody(page, LOW_BODY)).toBeVisible();
  });

  test("score-band and status filters narrow the row list", async ({ page }) => {
    // Score band: keep window B, require maxScore >= 0.5. The 0.30 low-score
    // row drops out; the 0.95 high-score row stays.
    await setDateRange(page, FILTER_FROM, FILTER_TO);
    await page.locator("#ai-flagged-min").fill("0.5");
    await applyFilters(page);

    await expect(rowByBody(page, HIGH_BODY)).toBeVisible();
    await expect(page.locator("blockquote", { hasText: LOW_BODY })).toHaveCount(0);

    // Status filter: switch to Approved. Only the approved row survives; the
    // pending high-score row disappears.
    await page.locator("#ai-flagged-min").fill("");
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Approved" }).click();
    await applyFilters(page);

    await expect(rowByBody(page, APPROVED_BODY)).toBeVisible();
    await expect(page.locator("blockquote", { hasText: HIGH_BODY })).toHaveCount(0);
    await expect(page.locator("blockquote", { hasText: COMBINED_BODY })).toHaveCount(0);
  });

  test("shows the empty state when no rows match the filters", async ({ page }) => {
    await setDateRange(page, EMPTY_FROM, EMPTY_TO);
    await applyFilters(page);

    await expect(
      page.getByText("No AI-flagged items match these filters."),
    ).toBeVisible();
  });

  test("paginates: first page caps at 25 and scrolling loads the rest", async ({ page }) => {
    // Isolate window A (30 uniform rows). The default page size is 25, so the
    // first page must render exactly 25 of our rows.
    await setDateRange(page, PAGE_FROM, PAGE_TO);
    await applyFilters(page);

    const pageRows = page.locator("blockquote", { hasText: "pgA-row" });
    await expect(pageRows).toHaveCount(25);

    // Scrolling the sentinel into view triggers fetchNextPage; the remaining
    // 5 rows load in, bringing the total to all 30.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await pageRows.count()).toBe(PAGE_ROWS);
    }).toPass({ timeout: 20_000 });
  });
});
