import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendError, ErrorCodes } from "../lib/api-errors";

export type AdminRole = "super_admin" | "admin" | "support_agent" | "content_manager";

const ADMIN_ROLES: AdminRole[] = ["super_admin", "admin", "support_agent", "content_manager"];

export const PERMISSION_MATRIX: Record<string, AdminRole[]> = {
  "dashboard:view": ["super_admin", "admin", "support_agent", "content_manager"],
  "members:view": ["super_admin", "admin", "support_agent"],
  "members:edit": ["super_admin", "admin"],
  "members:impersonate": ["super_admin"],
  "tickets:view": ["super_admin", "admin", "support_agent"],
  "tickets:manage": ["super_admin", "admin", "support_agent"],
  "content:view": ["super_admin", "admin", "content_manager"],
  "content:manage": ["super_admin", "admin", "content_manager"],
  "community:view": ["super_admin", "admin", "content_manager"],
  "community:moderate": ["super_admin", "admin", "content_manager"],
  "coaching:view": ["super_admin", "admin"],
  "coaching:manage": ["super_admin", "admin"],
  "commissions:view": ["super_admin", "admin"],
  "commissions:manage": ["super_admin", "admin"],
  "chat:view": ["super_admin", "admin"],
  "chat:manage": ["super_admin", "admin"],
  "communications:view": ["super_admin", "admin"],
  "communications:manage": ["super_admin", "admin"],
  "audit:view": ["super_admin", "admin"],
  "settings:view": ["super_admin", "admin"],
  "settings:manage": ["super_admin"],
  "system:view": ["super_admin", "admin"],
  "export:data": ["super_admin", "admin"],
  "ghl:view": ["super_admin", "admin"],
  "ghl:manage": ["super_admin", "admin"],
  "wins:view": ["super_admin", "admin", "content_manager"],
  "wins:manage": ["super_admin", "admin", "content_manager"],
  "vault:view": ["super_admin", "admin", "content_manager"],
  "vault:manage": ["super_admin", "admin", "content_manager"],
  "api_keys:view": ["super_admin", "admin"],
  "api_keys:manage": ["super_admin"],
  "notifications:view": ["super_admin", "admin", "support_agent", "content_manager"],
  "apps:manage": ["super_admin", "admin"],
};

declare global {
  namespace Express {
    interface Request {
      adminRole?: AdminRole;
    }
  }
}

export function isAdminRole(role: string): role is AdminRole {
  return ADMIN_ROLES.includes(role as AdminRole);
}

export function hasPermission(role: AdminRole, permission: string): boolean {
  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

export function requirePermission(...permissions: string[]) {
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

    const hasAny = permissions.some(p => hasPermission(user.role as AdminRole, p));
    if (!hasAny) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Insufficient permissions for this action");
      return;
    }

    next();
  };
}

export function getPermissionsForRole(role: AdminRole): string[] {
  return Object.entries(PERMISSION_MATRIX)
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission);
}
