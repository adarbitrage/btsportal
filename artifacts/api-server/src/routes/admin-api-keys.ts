import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db, apiKeysTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { sendError, ErrorCodes } from "../lib/api-errors";

const router: IRouter = Router();

router.get("/admin/api-keys", requirePermission("api_keys:view"), async (req: Request, res: Response) => {
  try {
    const keys = await db
      .select({
        id: apiKeysTable.id,
        name: apiKeysTable.name,
        prefix: apiKeysTable.prefix,
        type: apiKeysTable.type,
        environment: apiKeysTable.environment,
        permissions: apiKeysTable.permissions,
        rateLimitTier: apiKeysTable.rateLimitTier,
        createdById: apiKeysTable.createdById,
        lastUsedAt: apiKeysTable.lastUsedAt,
        expiresAt: apiKeysTable.expiresAt,
        revoked: apiKeysTable.revoked,
        revokedAt: apiKeysTable.revokedAt,
        createdAt: apiKeysTable.createdAt,
      })
      .from(apiKeysTable)
      .orderBy(desc(apiKeysTable.createdAt));

    res.json({ keys });
  } catch (err) {
    console.error("[AdminApiKeys] List error:", err);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to list API keys");
  }
});

router.post("/admin/api-keys", requirePermission("api_keys:manage"), async (req: Request, res: Response) => {
  try {
    const { name, type = "secret", environment = "live", permissions = [], rateLimitTier = "standard", expiresAt } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Name is required");
      return;
    }

    const validTypes = ["secret", "publishable"];
    if (!validTypes.includes(type)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Type must be 'secret' or 'publishable'");
      return;
    }

    const validTiers = ["standard", "elevated", "unlimited"];
    if (!validTiers.includes(rateLimitTier)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Rate limit tier must be 'standard', 'elevated', or 'unlimited'");
      return;
    }

    const typePrefix = type === "secret" ? "sk" : "pk";
    const randomPart = randomBytes(24).toString("hex");
    const rawKey = `bts_${environment}_${typePrefix}_${randomPart}`;
    const prefix = `bts_${environment}_${typePrefix}_${randomPart.substring(0, 8)}`;

    const keyHash = await bcrypt.hash(rawKey, 10);

    const effectivePermissions = type === "publishable"
      ? permissions.filter((p: string) => p.endsWith(":read"))
      : permissions;

    const [created] = await db
      .insert(apiKeysTable)
      .values({
        name: name.trim(),
        prefix,
        keyHash,
        type,
        environment,
        permissions: effectivePermissions,
        rateLimitTier,
        createdById: req.userId!,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    res.status(201).json({
      key: {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        type: created.type,
        environment: created.environment,
        permissions: created.permissions,
        rateLimitTier: created.rateLimitTier,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
        plainTextKey: rawKey,
      },
    });
  } catch (err) {
    console.error("[AdminApiKeys] Create error:", err);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create API key");
  }
});

router.patch("/admin/api-keys/:id", requirePermission("api_keys:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid key ID");
      return;
    }

    const { name, permissions, rateLimitTier } = req.body;
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name.trim();
    if (permissions !== undefined) updates.permissions = permissions;
    if (rateLimitTier !== undefined) {
      const validTiers = ["standard", "elevated", "unlimited"];
      if (!validTiers.includes(rateLimitTier)) {
        sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid rate limit tier");
        return;
      }
      updates.rateLimitTier = rateLimitTier;
    }

    if (Object.keys(updates).length === 0) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
      return;
    }

    const [updated] = await db
      .update(apiKeysTable)
      .set(updates)
      .where(eq(apiKeysTable.id, id))
      .returning();

    if (!updated) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, "API key not found");
      return;
    }

    res.json({
      key: {
        id: updated.id,
        name: updated.name,
        prefix: updated.prefix,
        type: updated.type,
        environment: updated.environment,
        permissions: updated.permissions,
        rateLimitTier: updated.rateLimitTier,
        expiresAt: updated.expiresAt,
        createdAt: updated.createdAt,
        revoked: updated.revoked,
      },
    });
  } catch (err) {
    console.error("[AdminApiKeys] Update error:", err);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to update API key");
  }
});

router.post("/admin/api-keys/:id/revoke", requirePermission("api_keys:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid key ID");
      return;
    }

    const [revoked] = await db
      .update(apiKeysTable)
      .set({
        revoked: true,
        revokedAt: new Date(),
        revokedById: req.userId!,
      })
      .where(eq(apiKeysTable.id, id))
      .returning();

    if (!revoked) {
      sendError(res, 404, ErrorCodes.NOT_FOUND, "API key not found");
      return;
    }

    res.json({ success: true, key: { id: revoked.id, revoked: true, revokedAt: revoked.revokedAt } });
  } catch (err) {
    console.error("[AdminApiKeys] Revoke error:", err);
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to revoke API key");
  }
});

export default router;
