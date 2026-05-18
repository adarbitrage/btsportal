import { test, expect, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import crypto from "node:crypto";

// End-to-end coverage for the /verify-email page and its resend-from-stranded
// recovery flow (Task #213). The component-level test
// (src/pages/__tests__/VerifyEmail.test.tsx) uses a mocked auth context and a
// mocked fetch — it cannot catch wiring regressions like the limiter changing
// its 429 response shape, the anti-enumeration message drifting on the real
// /api/auth/resend-verification route, or App.tsx un-mounting /verify-email.
// This spec drives the page against the real backend.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// /api/auth/resend-verification's per-email abuse limit, sourced from
// artifacts/api-server/src/routes/auth.ts (RESEND_VERIFICATION_LIMITS.perEmail).
// Used to burn quota for the 429 case below.
const RESEND_PER_EMAIL_MAX = 3;

interface SeededVerifyUser {
  id: number;
  email: string;
  token: string;
}

let pool: Pool | null = null;
const seededIds: number[] = [];

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the verify-email recovery E2E test (it seeds and tears down its own fixtures).",
    );
  }
  pool = new Pool({ connectionString: url });
});

test.afterAll(async () => {
  if (!pool) return;
  try {
    if (seededIds.length > 0) {
      const client = await pool.connect();
      try {
        await client.query(
          `DELETE FROM audit_log WHERE actor_id = ANY($1::int[])`,
          [seededIds],
        );
        await client.query(
          `DELETE FROM sessions WHERE user_id = ANY($1::int[])`,
          [seededIds],
        );
        await client.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
          seededIds,
        ]);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
    pool = null;
  }
});

async function seedUnverifiedUser(opts: {
  tag: string;
  expiresInMs: number;
}): Promise<SeededVerifyUser> {
  if (!pool) throw new Error("pool not initialized");
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + opts.expiresInMs);
  const suffix = crypto.randomBytes(4).toString("hex");
  const email = `e2e-verify-${opts.tag}-${suffix}@e2e.local`;
  // Password hash is unused — these accounts only exist to exercise the
  // /verify-email + /resend-verification flow, never /login.
  const passwordHash =
    "$2b$10$abcdefghijklmnopqrstuuJ8H1qXqkY3jWzQ8x.0t9PJrRfQbq3Jq";

  const client = await pool.connect();
  try {
    const res = await client.query<{ id: number }>(
      `INSERT INTO users
         (name, email, password_hash, role, email_verified, onboarding_complete,
          email_verify_token, email_verify_expires)
       VALUES ($1, $2, $3, 'member', false, false, $4, $5)
       RETURNING id`,
      [`E2E Verify ${opts.tag} ${suffix}`, email, passwordHash, token, expires],
    );
    const id = res.rows[0].id;
    seededIds.push(id);
    return { id, email, token };
  } finally {
    client.release();
  }
}

async function readEmailVerifiedFlag(userId: number): Promise<boolean> {
  if (!pool) throw new Error("pool not initialized");
  const client = await pool.connect();
  try {
    const res = await client.query<{ email_verified: boolean }>(
      `SELECT email_verified FROM users WHERE id = $1`,
      [userId],
    );
    return res.rows[0]?.email_verified ?? false;
  } finally {
    client.release();
  }
}

test.describe("/verify-email recovery flow", () => {
  test("a valid token verifies the account and surfaces the success state", async ({
    page,
  }) => {
    const user = await seedUnverifiedUser({
      tag: "success",
      expiresInMs: ONE_DAY_MS,
    });

    await page.goto(`/verify-email?token=${encodeURIComponent(user.token)}`);

    await expect(page.getByTestId("verify-email-success")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", { name: /Email verified/i }),
    ).toBeVisible();

    // The success copy comes from the real API response (the server returns
    // `{ message: "Email verified successfully" }`). Asserting on it proves
    // the page is reading the message field from the live route, not just
    // its hard-coded fallback.
    await expect(page.getByText(/Email verified successfully/i)).toBeVisible();

    // And of course the side-effect: the DB row is flipped to verified.
    expect(await readEmailVerifiedFlag(user.id)).toBe(true);
  });

  test("an expired token shows the error UI and a resend submission renders the anti-enumeration notice", async ({
    page,
  }) => {
    // Seed with an expired token so the /verify-email POST returns 400 and
    // the page falls into the resend-from-stranded recovery branch.
    const user = await seedUnverifiedUser({
      tag: "expired",
      expiresInMs: -60 * 60 * 1000,
    });

    await page.goto(`/verify-email?token=${encodeURIComponent(user.token)}`);

    const errorPanel = page.getByTestId("verify-email-error");
    await expect(errorPanel).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /Couldn't verify your email/i }),
    ).toBeVisible();
    // The error copy is whatever the real /verify-email route returns for
    // an expired/invalid token. If the route's wording or response shape
    // ever drifts, this assertion will catch it.
    await expect(
      page.getByText(/Invalid or expired verification token/i),
    ).toBeVisible();

    // The resend form should be mounted alongside the error.
    const form = page.getByTestId("resend-verification-form");
    await expect(form).toBeVisible();

    await page.getByTestId("resend-verification-email-input").fill(user.email);
    await page.getByTestId("resend-verification-button").click();

    // The form is replaced with the success notice once the real route
    // responds. The exact text below is the anti-enumeration message the
    // server returns on every accepted call — a regression in that string
    // would silently break the stranded-recovery confirmation copy.
    const notice = page.getByTestId("resend-verification-notice");
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText(
      "If that email is registered and not yet verified, we sent a new verification link.",
    );

    // No error banner should be present on the success path.
    await expect(
      page.getByTestId("resend-verification-error"),
    ).toHaveCount(0);
  });

  test("hitting the per-email rate limit surfaces the limiter's 429 message inline", async ({
    page,
    request,
  }) => {
    // The limiter is a no-op when REDIS_URL is not set (see
    // artifacts/api-server/src/middleware/abuse-rate-limit.ts). Skip cleanly
    // rather than producing a false negative — the success and resend cases
    // above still exercise the real route wiring on every run.
    test.skip(
      !process.env.REDIS_URL,
      "REDIS_URL not set — the abuse rate limiter is disabled, so we can't drive a real 429 from /api/auth/resend-verification.",
    );

    const user = await seedUnverifiedUser({
      tag: "ratelimit",
      expiresInMs: -60 * 60 * 1000,
    });

    // Burn the per-email quota against the real backend before the UI even
    // loads, so the next resend the page issues is the one the limiter
    // rejects with a 429.
    await burnResendQuotaForEmail(request, user.email);

    await page.goto(`/verify-email?token=${encodeURIComponent(user.token)}`);
    await expect(page.getByTestId("verify-email-error")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("resend-verification-email-input").fill(user.email);
    await page.getByTestId("resend-verification-button").click();

    // The error banner reads `data.error.message` straight off the
    // limiter's structured 429 body. If the limiter ever changes that
    // shape (e.g. drops `error.message` in favor of a flat `error`
    // string), this assertion will fail loudly.
    const errorBanner = page.getByTestId("resend-verification-error");
    await expect(errorBanner).toBeVisible({ timeout: 15_000 });
    await expect(errorBanner).toContainText(
      /Too many verification email requests/i,
    );

    // The success notice must NOT appear when the call was rejected.
    await expect(
      page.getByTestId("resend-verification-notice"),
    ).toHaveCount(0);
  });
});

async function burnResendQuotaForEmail(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  for (let i = 0; i < RESEND_PER_EMAIL_MAX; i++) {
    const res = await request.post("/api/auth/resend-verification", {
      data: { email },
    });
    // Each of these should be accepted (200 generic) — we're filling the
    // window, not triggering it. If one of these 200s is actually a 429
    // already, the test setup is racing against pre-existing limiter state
    // for this email; fail with a clear message rather than misattributing.
    expect(
      res.status(),
      `Expected resend-verification call #${i + 1} to be accepted (200) while filling the per-email quota; got ${res.status()}.`,
    ).toBe(200);
  }
}
