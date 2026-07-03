import crypto from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { sendError } from "../lib/api-errors";

/**
 * Constant-time comparison of two strings using the double-HMAC technique
 * (the same approach as the well-known `tsscmp` package): both inputs are
 * first HMAC'd with a fresh random per-call key, which folds them down to
 * fixed-length (32-byte) digests, and only THOSE digests are compared with
 * `crypto.timingSafeEqual`.
 *
 * This deliberately has NO branch on `a`/`b`'s length or emptiness — unlike
 * a naive "compare raw buffers, bail out if lengths differ" implementation,
 * there is nothing here whose control flow depends on the *content* (or
 * even the length) of either input, so there's no length- or
 * presence-based timing side-channel to leak. Equal-length raw buffers are
 * never compared directly.
 *
 * Note: this only proves `a === b`; it does NOT enforce that either side is
 * non-empty. Callers comparing against a shared secret must separately
 * reject an unset/empty configured secret BEFORE calling this (that check
 * is on server configuration, not on the attacker-controlled input, so it
 * carries no timing signal about the secret's value).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const key = crypto.randomBytes(32);
  const digestA = crypto.createHmac("sha256", key).update(a, "utf8").digest();
  const digestB = crypto.createHmac("sha256", key).update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Service-auth middleware for /api/ops routes.
 *
 * Authenticates via the `Authorization: Bearer <key>` header against the
 * OPS_API_KEY environment variable using a constant-time comparison.
 *
 * Fails closed: returns 401 when OPS_API_KEY is unset OR the key mismatches.
 * Member JWT sessions are never accepted — this is a machine-to-machine gate.
 */
export function requireOpsServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = process.env.OPS_API_KEY ?? "";

  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  // Reject an unset OPS_API_KEY before any timing-sensitive compare. This
  // branches only on server configuration (public to the deployment, not
  // attacker-controlled), so it introduces no secret-dependent timing
  // signal — it's just "the service isn't configured at all, fail closed."
  if (!configured || !timingSafeEqual(configured, provided)) {
    sendError(res, 401, "OPS_UNAUTHORIZED", "Invalid or missing ops service key");
    return;
  }

  next();
}
