import { Router, type IRouter } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requirePermission } from "../middleware/rbac";
import { logAdminAction } from "../lib/audit-log";
import {
  exchangeAuthorizationCode,
  isAgencyTokenConfigured,
} from "../lib/ghl-agency-client";

const router: IRouter = Router();

const GHL_AUTHORIZE_URL =
  "https://marketplace.gohighlevel.com/oauth/chooselocation";

const OAUTH_STATE_COOKIE = "flexy_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 600;

function safeStateEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function getDefaultRedirectUri(req: import("express").Request): string {
  const env = process.env.GHL_CHERRINGTON_REDIRECT_URI;
  if (env) return env;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host;
  return `${proto}://${host}/api/admin/flexy/oauth/callback`;
}

router.get(
  "/admin/flexy/oauth/status",
  requirePermission("apps:manage"),
  async (_req, res): Promise<void> => {
    try {
      const configured = await isAgencyTokenConfigured();
      const hasClient = !!process.env.GHL_CHERRINGTON_CLIENT_ID;
      const hasSecret = !!process.env.GHL_CHERRINGTON_CLIENT_SECRET;
      res.json({
        configured,
        clientIdSet: hasClient,
        clientSecretSet: hasSecret,
      });
    } catch (err) {
      console.error("[AdminFlexy] status failed:", err);
      res.status(500).json({ error: "Failed to fetch Flexy OAuth status" });
    }
  },
);

router.get(
  "/admin/flexy/oauth/install",
  requirePermission("apps:manage"),
  async (req, res): Promise<void> => {
    const clientId = process.env.GHL_CHERRINGTON_CLIENT_ID;
    if (!clientId) {
      res
        .status(500)
        .json({ error: "GHL_CHERRINGTON_CLIENT_ID is not configured" });
      return;
    }
    const redirectUri = getDefaultRedirectUri(req);
    const scope = [
      "locations.write",
      "locations.readonly",
      "users.write",
      "users.readonly",
      "oauth.write",
      "oauth.readonly",
    ].join(" ");
    const state = randomBytes(32).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
      path: "/api/admin/flexy/oauth",
    });
    const url =
      `${GHL_AUTHORIZE_URL}?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`;
    res.redirect(url);
  },
);

router.get(
  "/admin/flexy/oauth/callback",
  requirePermission("apps:manage"),
  async (req, res): Promise<void> => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.status(400).send("Missing 'code' query param");
      return;
    }
    const queryState =
      typeof req.query.state === "string" ? req.query.state : "";
    const cookieState =
      (req.cookies && (req.cookies as Record<string, string>)[OAUTH_STATE_COOKIE]) || "";
    if (!queryState || !cookieState || !safeStateEq(queryState, cookieState)) {
      res
        .status(400)
        .send(
          "Invalid OAuth state. Please restart the install flow from /api/admin/flexy/oauth/install.",
        );
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/admin/flexy/oauth" });
    const redirectUri = getDefaultRedirectUri(req);
    try {
      const { companyId } = await exchangeAuthorizationCode(
        code,
        redirectUri,
        req.userId,
      );
      await logAdminAction(
        req,
        "configure",
        "ghl_oauth_token",
        companyId,
        `Flexy GHL agency OAuth installed (companyId=${companyId})`,
      );
      res
        .status(200)
        .send(
          `<html><body><h2>Flexy OAuth installed.</h2><p>Company ID: <code>${companyId}</code></p><p>You can close this window.</p></body></html>`,
        );
    } catch (err) {
      console.error("[AdminFlexy] callback failed:", err);
      res
        .status(502)
        .send(
          `<html><body><h2>OAuth install failed</h2><pre>${(err instanceof Error ? err.message : String(err)).replace(/[<>]/g, "")}</pre></body></html>`,
        );
    }
  },
);

export default router;
