import { type Request, type Response, type NextFunction } from "express";
import { sendError, ErrorCodes } from "../lib/api-errors";

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKeyContext) {
      next();
      return;
    }

    const keyPermissions = req.apiKeyContext.permissions || [];

    if (keyPermissions.includes("*")) {
      next();
      return;
    }

    const missing = requiredPermissions.filter((p) => !keyPermissions.includes(p));

    if (missing.length > 0) {
      sendError(res, 403, ErrorCodes.PERMISSION_DENIED, "API key does not have required permissions", {
        required: requiredPermissions,
        missing,
      });
      return;
    }

    next();
  };
}

export const AVAILABLE_PERMISSIONS = [
  "members:read",
  "members:write",
  "training:read",
  "training:write",
  "coaching:read",
  "coaching:write",
  "tickets:read",
  "tickets:write",
  "announcements:read",
  "announcements:write",
  "community:read",
  "community:write",
  "products:read",
  "products:write",
  "analytics:read",
  "*",
] as const;

export type Permission = (typeof AVAILABLE_PERMISSIONS)[number];
