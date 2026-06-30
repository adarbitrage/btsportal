import crypto from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { sendError } from "../lib/api-errors";

/**
 * Constant-time comparison of two strings. Returns false when either side is
 * empty so that a missing env var always fails closed.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
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

  if (!timingSafeEqual(configured, provided)) {
    sendError(res, 401, "OPS_UNAUTHORIZED", "Invalid or missing ops service key");
    return;
  }

  next();
}
