import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync, execSync } from "node:child_process";

// End-to-end coverage for the login brute-force rate limiter (Task #721).
//
// The abuse rate-limiter (artifacts/api-server/src/middleware/abuse-rate-limit.ts)
// guards several sensitive auth routes, but until now only the verify-email
// resend 429 path was asserted end-to-end (verify-email-recovery.spec.ts). This
// spec drives the highest-value uncovered limiter — `loginIpLimiter` on
// /api/auth/login — against the real backend, so a regression in its 429
// response shape (the structured `{ error: { code, message } }` body the SPA
// reads) or in the UI's surfacing of that message would fail loudly instead of
// shipping silently.
//
// It mirrors the pattern in verify-email-recovery.spec.ts: burn the limiter's
// quota against the real route, then assert the next attempt is rejected and the
// page renders the limiter's message. It skips cleanly when Redis is unavailable
// (the limiter is a no-op without it) and when Turnstile is enabled (the login
// form's submit is gated on a captcha we can't auto-solve).

// /api/auth/login's per-IP abuse limit, sourced from
// artifacts/api-server/src/routes/auth.ts (LOGIN_LIMITS.perIp.max). Used to fill
// the per-IP window so the next attempt is the one the limiter rejects.
const LOGIN_PER_IP_MAX = 20;

// The exact message `loginIpLimiter` returns in its 429 body (auth.ts). The SPA
// reads it off `error.message` and renders it in the login error block, so a
// drift in either the server string or the client wiring breaks this assertion.
const LOGIN_RATE_LIMIT_MESSAGE = "Too many login attempts. Please try again later.";

test.describe("/login brute-force rate limit", () => {
  // The limiter is a no-op when REDIS_URL is not set (see abuse-rate-limit.ts).
  // Skip rather than produce a false negative.
  test.skip(
    !process.env.REDIS_URL,
    "REDIS_URL not set — the abuse rate limiter is disabled, so we can't drive a real 429 from /api/auth/login.",
  );

  // When Turnstile is configured the login form disables submit until a captcha
  // token is solved, which we can't do headlessly. Skip cleanly in that case.
  test.skip(
    Boolean(process.env.VITE_TURNSTILE_SITE_KEY),
    "VITE_TURNSTILE_SITE_KEY is set — the login form requires a captcha we can't auto-solve in e2e.",
  );

  // The login limiter keys on the client IP (artifacts/api-server has no
  // `trust proxy`, so every loopback caller in this suite collapses to the same
  // key). Flush the limiter's login keys afterwards so burning the window here
  // can't 429 a legitimate login in a later spec that happens to share the IP.
  test.afterAll(() => {
    flushLoginRateLimitKeys();
  });

  test("burning the per-IP quota surfaces the limiter's 429 message on the login form", async ({
    page,
    request,
  }) => {
    // Fill the per-IP window against the real backend before the form submits,
    // so the single attempt the page issues is the one the limiter rejects. The
    // limiter is per-IP regardless of credentials, so unknown email/password
    // pairs (which return 401) are enough to fill it.
    await burnLoginQuota(request);

    await page.goto("/login");

    await page.locator('input[type="email"]').fill("e2e-login-rl@e2e.local");
    await page.locator('input[type="password"]').fill("wrong-password-123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // The login error block reads `data.error.message` straight off the
    // limiter's structured 429 body. A regression in that shape (e.g. dropping
    // `error.message` for a flat `error` string) breaks this assertion.
    await expect(page.getByText(LOGIN_RATE_LIMIT_MESSAGE)).toBeVisible({
      timeout: 15_000,
    });

    // A 429 must not be mistaken for a successful login — the guest route should
    // keep us on /login rather than navigating to the dashboard.
    await expect(page).toHaveURL(/\/login/);
  });
});

// Fill the per-IP login window by issuing LOGIN_PER_IP_MAX rejected attempts
// through the same proxy path the browser uses, so they share the limiter's IP
// key. We go through the `request` fixture (relative URL -> portal proxy -> API)
// rather than straight to the API origin: the browser's own login also flows
// through the proxy, and the limiter must see one identical IP for both.
async function burnLoginQuota(request: APIRequestContext): Promise<void> {
  for (let i = 0; i < LOGIN_PER_IP_MAX; i++) {
    const res = await request.post("/api/auth/login", {
      data: {
        email: `e2e-login-burn-${i}@e2e.local`,
        password: "definitely-the-wrong-password",
      },
    });
    // These are bad-credential attempts (401), not 429s — we're filling the
    // window, not triggering it. If one is already a 429 the run is racing
    // against pre-existing limiter state for this IP; fail with a clear message
    // rather than misattributing the later assertion.
    expect(
      res.status(),
      `Expected login attempt #${i + 1} to be rejected with 401 while filling the per-IP quota; got ${res.status()}.`,
    ).toBe(401);
  }
}

// Best-effort cleanup of the login limiter's Redis keys via redis-cli. Swallows
// every failure: if redis-cli isn't on PATH or REDIS_URL is unset the keys
// simply expire on their own window TTL (and the throwaway Redis is torn down at
// the end of the run anyway).
function flushLoginRateLimitKeys(): void {
  const url = process.env.REDIS_URL;
  if (!url) return;
  let cliBin: string | undefined;
  try {
    cliBin = execSync("command -v redis-cli", { encoding: "utf8" }).trim();
  } catch {
    return;
  }
  if (!cliBin) return;
  // Delete every key the login limiter could have created. The middleware
  // namespaces keys as `abuse-rate:login:<resolver-key>` (see
  // abuse-rate-limit.ts), so this pattern is scoped to the login limiter alone
  // and won't touch other limiters' windows.
  const script =
    "for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) end return 1";
  try {
    execFileSync(cliBin, ["-u", url, "EVAL", script, "0", "abuse-rate:login:*"], {
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    /* best-effort */
  }
}
