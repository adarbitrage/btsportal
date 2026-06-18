import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db, usersTable, apiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { isAdminRole } from "./rbac";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userEmail?: string;
      user?: { email?: string; userId?: number };
      requestId?: string;
      isApiKeyAuth?: boolean;
      isImpersonation?: boolean;
      impersonatedBy?: number;
      apiKeyContext?: {
        id: number;
        prefix: string;
        type: string;
        permissions: string[];
        rateLimitTier: string;
      };
    }
  }
}

const PUBLIC_PATHS = [
  "/auth/register",
  "/auth/login",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/verify-email-change",
  "/auth/resend-verification",
  "/auth/refresh",
  "/auth/logout",
  "/healthz",
  "/products",
  "/announcements",
  "/affiliate-networks",
  "/email/unsubscribe",
  "/v1/health",
  "/integrations/machine-purchase",
  "/integrations/bootstrap-superadmin",
  // Google OAuth callback: a cross-site redirect from accounts.google.com does
  // not carry the SameSite=Strict auth cookie. The handler authenticates the
  // user via the HMAC-signed `state` it issued at connect time instead.
  "/coach/google/callback",
  "/voice/kb-search",
];

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;

  if (PUBLIC_PATHS.some(p => path === p) || path.startsWith("/v1/marketing/") || path.startsWith("/api/webhooks/") || path.startsWith("/webhooks/") || path.startsWith("/go/") || (process.env.NODE_ENV !== "production" && (path.startsWith("/api/dev/") || path.startsWith("/dev/")))) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer bts_")) {
    const apiKey = authHeader.slice(7);
    authenticateApiKey(apiKey, req, res, next);
    return;
  }

  const token = req.cookies?.access_token;
  if (!token) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: number;
      email: string;
      isImpersonation?: boolean;
      impersonatedBy?: number;
    };
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.isApiKeyAuth = false;
    req.isImpersonation = payload.isImpersonation === true;
    req.impersonatedBy = payload.impersonatedBy;
    next();
  } catch {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Invalid or expired token");
  }
}

async function authenticateApiKey(rawKey: string, req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parts = rawKey.split("_");
    if (parts.length < 4) {
      sendError(res, 401, ErrorCodes.INVALID_API_KEY, "Invalid API key format");
      return;
    }

    const prefix = parts.slice(0, 3).join("_") + "_" + parts[3].substring(0, 8);

    const keys = await db
      .select()
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.prefix, prefix), eq(apiKeysTable.revoked, false)));

    if (keys.length === 0) {
      sendError(res, 401, ErrorCodes.INVALID_API_KEY, "Invalid or revoked API key");
      return;
    }

    const keyRecord = keys[0];

    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      sendError(res, 401, ErrorCodes.API_KEY_EXPIRED, "API key has expired");
      return;
    }

    const valid = await bcrypt.compare(rawKey, keyRecord.keyHash);
    if (!valid) {
      sendError(res, 401, ErrorCodes.INVALID_API_KEY, "Invalid API key");
      return;
    }

    req.apiKeyContext = {
      id: keyRecord.id,
      prefix: keyRecord.prefix,
      type: keyRecord.type,
      permissions: keyRecord.permissions as string[],
      rateLimitTier: keyRecord.rateLimitTier,
    };

    req.isApiKeyAuth = true;
    req.userId = keyRecord.createdById;

    db.update(apiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeysTable.id, keyRecord.id))
      .catch((err) => console.error("[Auth] Failed to update lastUsedAt:", err));

    next();
  } catch (err) {
    console.error("[Auth] API key auth error:", err);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Authentication error");
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.isApiKeyAuth) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "Admin routes require session authentication, not API key");
    return;
  }

  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);

  if (!user || !isAdminRole(user.role)) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, "Admin access required");
    return;
  }

  next();
}

export function generateAccessToken(userId: number, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "15m" });
}

export function generateCsrfToken(): string {
  const crypto = require("crypto");
  return crypto.randomBytes(32).toString("hex");
}
