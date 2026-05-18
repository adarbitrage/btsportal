import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
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
      "E2E fixture file is missing. The Playwright globalSetup must run first to seed an isolated admin.",
    );
  }
}

async function loginAs(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const loginRes = await request.post("/api/auth/login", {
    data: { email, password },
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
  // Clear any previous cookies so the second login doesn't keep the first
  // user's access_token around.
  await page.context().clearCookies();
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

test.describe("Member portal + admin — YSE-granted product details", () => {
  test("YSE badge renders only on the granted row; admin sees source + order id", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the YSE-products E2E test (it seeds and verifies its own fixtures).",
      );
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const tag = randomBytes(6).toString("hex");
    const memberEmail = `e2e-yse-member-${tag}@e2e.local`;
    const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
    const memberName = `E2E YSE Member ${tag}`;
    const memberHash = await bcrypt.hash(memberPassword, 10);
    const directSlug = `e2e-direct-${tag}`;
    const yseSlug = `e2e-yse-${tag}`;
    const yseOrderId = `YSE-ORDER-${tag.toUpperCase()}`;

    let memberId = 0;
    let directProductId = 0;
    let yseProductId = 0;
    let directUserProductId = 0;
    let yseUserProductId = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const memberRes = await client.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [memberName, memberEmail, memberHash],
      );
      memberId = memberRes.rows[0].id;

      const directProdRes = await client.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '[]'::jsonb, 0)
         RETURNING id`,
        [directSlug, `Direct Purchase ${tag}`],
      );
      directProductId = directProdRes.rows[0].id;

      const yseProdRes = await client.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '[]'::jsonb, 1)
         RETURNING id`,
        [yseSlug, `YSE Granted ${tag}`],
      );
      yseProductId = yseProdRes.rows[0].id;

      const directUpRes = await client.query<{ id: number }>(
        `INSERT INTO user_products (user_id, product_id, status)
         VALUES ($1, $2, 'active')
         RETURNING id`,
        [memberId, directProductId],
      );
      directUserProductId = directUpRes.rows[0].id;

      const yseUpRes = await client.query<{ id: number }>(
        `INSERT INTO user_products
           (user_id, product_id, status, external_source, external_order_id)
         VALUES ($1, $2, 'active', 'yse', $3)
         RETURNING id`,
        [memberId, yseProductId, yseOrderId],
      );
      yseUserProductId = yseUpRes.rows[0].id;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
      throw err;
    }
    client.release();

    try {
      // --- Member portal view: /account/products ----------------------------
      await loginAs(page, request, memberEmail, memberPassword);

      await page.goto("/account/products");

      await expect(page.getByTestId("my-products-page")).toBeVisible({ timeout: 15_000 });

      const directCard = page.getByTestId(`my-product-card-${directUserProductId}`);
      const yseCard = page.getByTestId(`my-product-card-${yseUserProductId}`);
      await expect(directCard).toBeVisible();
      await expect(yseCard).toBeVisible();

      const yseBadge = page.getByTestId(`my-product-${yseUserProductId}-yse-badge`);
      await expect(yseBadge).toBeVisible();
      await expect(yseBadge).toContainText("Granted via YSE");

      // The direct-purchase row must NOT show a YSE badge or any source badge.
      await expect(
        page.getByTestId(`my-product-${directUserProductId}-yse-badge`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`my-product-${directUserProductId}-source-badge`),
      ).toHaveCount(0);

      // --- Admin member-detail view: products tab ---------------------------
      await loginAs(page, request, fixture.adminEmail, fixture.adminPassword);

      await page.goto(`/admin/members/${memberId}`);
      await expect(
        page.getByRole("heading", { name: memberName }),
      ).toBeVisible({ timeout: 15_000 });

      const sourceBadge = page.getByTestId(
        `admin-member-product-${yseUserProductId}-source`,
      );
      await expect(sourceBadge).toBeVisible();
      await expect(sourceBadge).toContainText("yse");

      const orderLine = page.getByTestId(
        `admin-member-product-${yseUserProductId}-order`,
      );
      await expect(orderLine).toBeVisible();
      await expect(orderLine).toContainText(yseOrderId);

      // The direct-purchase row has neither a source badge nor an order line.
      await expect(
        page.getByTestId(`admin-member-product-${directUserProductId}-source`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`admin-member-product-${directUserProductId}-order`),
      ).toHaveCount(0);
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query(`DELETE FROM user_products WHERE user_id = $1`, [memberId]);
        await cleanup.query(`DELETE FROM sessions WHERE user_id = $1`, [memberId]);
        await cleanup.query(`DELETE FROM users WHERE id = $1`, [memberId]);
        await cleanup.query(`DELETE FROM products WHERE id = ANY($1::int[])`, [
          [directProductId, yseProductId].filter((id) => id > 0),
        ]);
      } catch (err) {
        console.error("[e2e] yse-products cleanup failed:", err);
      } finally {
        cleanup.release();
        await pool.end();
      }
    }
  });
});
