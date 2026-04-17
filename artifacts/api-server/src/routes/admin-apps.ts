import { Router, type IRouter } from "express";
import { db, appGlobalSettingsTable, APP_NAMES } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { logAdminAction } from "../lib/audit-log";

const router: IRouter = Router();

async function ensureAppSettingsSeeded(): Promise<void> {
  for (const appName of APP_NAMES) {
    const [existing] = await db
      .select({ appName: appGlobalSettingsTable.appName })
      .from(appGlobalSettingsTable)
      .where(eq(appGlobalSettingsTable.appName, appName))
      .limit(1);

    if (!existing) {
      await db.insert(appGlobalSettingsTable).values({ appName, enabled: true, visible: true });
    }
  }
}

router.get("/admin/apps-manager", requirePermission("apps:manage"), async (req, res): Promise<void> => {
  try {
    await ensureAppSettingsSeeded();

    const rows = await db.select().from(appGlobalSettingsTable);
    const rowMap = new Map(rows.map((r) => [r.appName, r]));

    const result = APP_NAMES.map((appName) => {
      const row = rowMap.get(appName) ?? {
        appName,
        enabled: true,
        visible: true,
        updatedAt: null,
        updatedById: null,
        updatedByEmail: null,
      };
      return row;
    });

    res.json(result);
  } catch (err) {
    console.error("[AdminApps] Error listing app statuses:", err);
    res.status(500).json({ error: "Failed to fetch app statuses" });
  }
});

router.patch("/admin/apps-manager/:appName", requirePermission("apps:manage"), async (req, res): Promise<void> => {
  const { appName } = req.params;

  if (!(APP_NAMES as readonly string[]).includes(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const { enabled, visible } = req.body;
  const hasEnabled = typeof enabled === "boolean";
  const hasVisible = typeof visible === "boolean";

  if (!hasEnabled && !hasVisible) {
    res.status(400).json({ error: "Provide 'enabled' and/or 'visible' boolean field(s)" });
    return;
  }

  try {
    await ensureAppSettingsSeeded();

    const [existing] = await db
      .select()
      .from(appGlobalSettingsTable)
      .where(eq(appGlobalSettingsTable.appName, appName))
      .limit(1);

    const previousEnabled = existing?.enabled ?? true;
    const previousVisible = existing?.visible ?? true;

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedById: req.userId,
      updatedByEmail: req.userEmail,
    };
    if (hasEnabled) patch.enabled = enabled;
    if (hasVisible) patch.visible = visible;

    await db
      .update(appGlobalSettingsTable)
      .set(patch)
      .where(eq(appGlobalSettingsTable.appName, appName));

    const [updated] = await db
      .select()
      .from(appGlobalSettingsTable)
      .where(eq(appGlobalSettingsTable.appName, appName))
      .limit(1);

    if (hasEnabled && enabled !== previousEnabled) {
      await logAdminAction(
        req,
        enabled ? "enable" : "disable",
        "app_global_setting",
        appName,
        `App "${appName}" ${enabled ? "enabled" : "disabled"} by admin`,
        { appName, before: { enabled: previousEnabled }, after: { enabled } },
      );
    }

    if (hasVisible && visible !== previousVisible) {
      await logAdminAction(
        req,
        visible ? "show" : "hide",
        "app_global_setting",
        appName,
        `App "${appName}" ${visible ? "shown" : "hidden"} on member apps page by admin`,
        { appName, before: { visible: previousVisible }, after: { visible } },
      );
    }

    res.json(updated);
  } catch (err) {
    console.error("[AdminApps] Error updating app status:", err);
    res.status(500).json({ error: "Failed to update app status" });
  }
});

export default router;
