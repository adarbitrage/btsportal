import { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let warnedNoSecret = false;

export interface TurnstileVerificationResult {
  success: boolean;
  errorCodes?: string[];
}

async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerificationResult> {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", token);
  if (remoteIp) params.set("remoteip", remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      return { success: false, errorCodes: [`http-${res.status}`] };
    }
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    return {
      success: Boolean(data.success),
      errorCodes: data["error-codes"],
    };
  } catch (err) {
    return {
      success: false,
      errorCodes: [`fetch-error:${(err as Error)?.message ?? "unknown"}`],
    };
  }
}

export interface CaptchaMiddlewareOptions {
  /**
   * Body field that should hold the Turnstile token. Defaults to
   * `captchaToken`. The middleware also accepts `cf-turnstile-response`
   * (the standard widget field name) as a fallback.
   */
  tokenField?: string;
}

/**
 * Express middleware that verifies a Cloudflare Turnstile token on the
 * incoming request.
 *
 * Enforcement is gated to production: the challenge is only verified when
 * `NODE_ENV === "production"` AND `TURNSTILE_SECRET_KEY` is set. Outside
 * production the middleware always fails open. `TURNSTILE_SECRET_KEY` is a
 * globally-scoped secret (so it is also present in dev/test); this gate
 * prevents it from blocking dev/test signups, where no Turnstile widget
 * (site key) is rendered and therefore no token is ever sent.
 *
 * Behavior (in production, with the secret set):
 *  - If the token is missing → 400 CAPTCHA_REQUIRED.
 *  - If the token fails verification → 400 CAPTCHA_INVALID.
 *  - If the token verifies → next().
 * Outside production, or when the secret is unset → next() (fail open).
 */
export function verifyCaptcha(
  opts: CaptchaMiddlewareOptions = {},
): RequestHandler {
  const tokenField = opts.tokenField ?? "captchaToken";
  return async function verifyCaptchaMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    const isProduction = process.env.NODE_ENV === "production";
    // Fail open outside production, or when no secret is configured. See the
    // doc comment above: enforcement is intentionally production-only so the
    // globally-scoped secret never blocks dev/test signups.
    if (!secret || !isProduction) {
      if (isProduction && !secret && !warnedNoSecret) {
        warnedNoSecret = true;
        console.warn(
          "[captcha] TURNSTILE_SECRET_KEY is not set — signup challenge verification is disabled in production. Set TURNSTILE_SECRET_KEY to enforce it.",
        );
      }
      next();
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawToken =
      typeof body[tokenField] === "string"
        ? (body[tokenField] as string)
        : typeof body["cf-turnstile-response"] === "string"
          ? (body["cf-turnstile-response"] as string)
          : "";
    const token = rawToken.trim();
    if (!token) {
      sendError(
        res,
        400,
        ErrorCodes.CAPTCHA_REQUIRED,
        "Captcha challenge is required.",
      );
      return;
    }

    const remoteIp = req.ip || req.socket?.remoteAddress;
    const result = await verifyTurnstileToken(secret, token, remoteIp);
    if (!result.success) {
      console.warn(
        `[captcha] Turnstile verification failed: codes=${(result.errorCodes ?? []).join(",") || "none"}`,
      );
      sendError(
        res,
        400,
        ErrorCodes.CAPTCHA_INVALID,
        "Captcha challenge failed. Please try again.",
      );
      return;
    }

    next();
  };
}

/**
 * Returns whether the signup captcha challenge is *configured* on the
 * backend — i.e. whether `TURNSTILE_SECRET_KEY` is set to a non-empty
 * value. Note that runtime enforcement by `verifyCaptcha` additionally
 * requires `NODE_ENV === "production"`. Never returns or exposes the
 * secret itself.
 */
export function isSignupChallengeEnforced(): boolean {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  return typeof secret === "string" && secret.trim().length > 0;
}

/**
 * Test-only helper: clear the cached "warned" flag so each test can
 * independently observe the dev-mode warning.
 */
export function __resetCaptchaWarningForTests(): void {
  warnedNoSecret = false;
}
