import { type Request, type Response, type NextFunction } from "express";
import { sendError } from "../lib/api-errors";
import { timingSafeEqual } from "./ops-service-auth";

/**
 * Service-auth guard for the machine-to-machine app-instance domain check
 * endpoint (POST /api/apps/domain-check).
 *
 * Authenticates via `Authorization: Bearer <secret>` against the
 * APP_DOMAIN_CHECK_SECRET environment variable using the same double-HMAC
 * constant-time comparison as the ops service auth.
 *
 * Fails closed: returns 401 when APP_DOMAIN_CHECK_SECRET is unset OR the
 * provided secret mismatches. Member JWT sessions are never accepted — the
 * endpoint's path is registered as public in the global auth layer, so this
 * guard is the sole gate.
 *
 * The env var is read per-request (not captured at import time) so operators
 * can rotate the secret with a restart and tests can exercise the
 * unset-secret fail-closed branch.
 */
export function requireAppDomainCheckAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = process.env.APP_DOMAIN_CHECK_SECRET ?? "";

  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  // Reject an unset secret before any compare — this branches only on server
  // configuration, not attacker-controlled input, so it carries no timing
  // signal about the secret's value.
  if (!configured || !timingSafeEqual(configured, provided)) {
    sendError(res, 401, "DOMAIN_CHECK_UNAUTHORIZED", "Invalid or missing domain-check secret");
    return;
  }

  next();
}
