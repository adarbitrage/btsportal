import { Router, type IRouter, type Request, type Response } from "express";
import { requireCoachOrCoachingView } from "../middleware/rbac";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  isGoogleOAuthConfigured,
  buildConsentUrl,
  signOAuthState,
  verifyOAuthState,
  exchangeCodeForTokens,
  getRedirectUri,
} from "../lib/google-oauth";
import {
  getConnectionStatus,
  upsertConnection,
  deleteConnection,
} from "../lib/coach-google-connections";
import { getDashboardReturnUrl } from "../lib/google-oauth";

const router: IRouter = Router();

// Connection status for the logged-in coach (used by the dashboard card).
router.get(
  "/coach/google/status",
  requireCoachOrCoachingView(),
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const status = await getConnectionStatus(userId);
    res.json({ configured: isGoogleOAuthConfigured(), ...status });
  },
);

// Kick off the OAuth flow. The coach's browser hits this via a top-level
// navigation (same-origin, so the SameSite=Strict auth cookie IS sent), and we
// 302 them to Google's consent screen with an HMAC-signed state binding them.
router.get(
  "/coach/google/connect",
  requireCoachOrCoachingView(),
  async (req: Request, res: Response) => {
    if (!isGoogleOAuthConfigured()) {
      sendError(
        res,
        503,
        ErrorCodes.INTERNAL_ERROR,
        "Google OAuth is not configured. An admin must set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.",
      );
      return;
    }
    const userId = req.userId!;
    const state = signOAuthState(userId);
    res.redirect(buildConsentUrl(state));
  },
);

// OAuth callback. PUBLIC route (the cross-site redirect from Google does not
// carry our SameSite=Strict cookie) — the user is identified solely by the
// signed `state`. We never trust the callback without a valid signature.
router.get("/coach/google/callback", async (req: Request, res: Response) => {
  const fail = (reason: string) =>
    res.redirect(getDashboardReturnUrl({ google: "error", reason }));

  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error) {
    fail(error);
    return;
  }
  if (!code) {
    fail("missing_code");
    return;
  }
  const userId = verifyOAuthState(state);
  if (!userId) {
    fail("invalid_state");
    return;
  }
  if (!isGoogleOAuthConfigured()) {
    fail("not_configured");
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.email) {
      fail("no_email");
      return;
    }
    await upsertConnection({
      userId,
      email: tokens.email,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
    });
    res.redirect(getDashboardReturnUrl({ google: "connected" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CoachGoogle] Callback failed for user ${userId}: ${message}`);
    fail("exchange_failed");
  }
});

// Disconnect (revoke locally by deleting the stored token).
router.post(
  "/coach/google/disconnect",
  requireCoachOrCoachingView(),
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    await deleteConnection(userId);
    res.json({ ok: true });
  },
);

// Surface the redirect URI an admin must register in the Google OAuth client.
router.get(
  "/coach/google/redirect-uri",
  requireCoachOrCoachingView(),
  async (_req: Request, res: Response) => {
    res.json({ redirectUri: getRedirectUri() });
  },
);

export default router;
