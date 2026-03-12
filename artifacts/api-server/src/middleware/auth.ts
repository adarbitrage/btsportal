import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userEmail?: string;
    }
  }
}

const PUBLIC_PATHS = [
  "/auth/register",
  "/auth/login",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/refresh",
  "/auth/logout",
  "/healthz",
  "/products",
  "/announcements",
  "/email/unsubscribe",
];

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;

  if (PUBLIC_PATHS.some(p => path === p) || path.startsWith("/api/webhooks/") || path.startsWith("/webhooks/") || (process.env.NODE_ENV !== "production" && (path.startsWith("/api/dev/") || path.startsWith("/dev/")))) {
    next();
    return;
  }

  const token = req.cookies?.access_token;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);

  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
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
