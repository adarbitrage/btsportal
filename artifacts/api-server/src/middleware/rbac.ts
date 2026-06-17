import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  type AdminRole,
  type Permission,
  hasPermission,
  isAdminRole,
  isCoachRole,
} from "@workspace/auth";
import { sendError, ErrorCodes } from "../lib/api-errors";

export {
  ADMIN_ROLES,
  PERMISSION_MATRIX,
  getPermissionsForRole,
  hasPermission,
  isAdminRole,
  isCoachRole,
} from "@workspace/auth";
export type { AdminRole, Permission } from "@workspace/auth";

declare global {
  namespace Express {
    interface Request {
      adminRole?: AdminRole;
    }
  }
}

export function requirePermission(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.isApiKeyAuth) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Admin routes require session authentication");
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

    req.adminRole = user.role;

    const hasAny = permissions.some(p => hasPermission(user.role, p));
    if (!hasAny) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Insufficient permissions for this action");
      return;
    }

    next();
  };
}

/**
 * Allow either a `coach` (usersTable.role === "coach", which is NOT an admin
 * role) OR an admin role that holds `coaching:view`. This mirrors the frontend
 * CoachRoute / shouldShowCoachSection gate so coaches can reach the pack coach
 * dashboard while plain members / admin roles without coaching:view are denied.
 * Admin callers get `req.adminRole` set (coaches do not — they have no admin role).
 */
export function requireCoachOrCoachingView() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.isApiKeyAuth) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Coach routes require session authentication");
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

    if (!user) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Coach access required");
      return;
    }

    if (user.role === "coach") {
      next();
      return;
    }

    if (isAdminRole(user.role) && hasPermission(user.role, "coaching:view")) {
      req.adminRole = user.role;
      next();
      return;
    }

    sendError(res, 403, ErrorCodes.FORBIDDEN, "Coach access required");
  };
}
