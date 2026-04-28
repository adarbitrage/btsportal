import { Router, type IRouter } from "express";
import {
  db,
  appGlobalSettingsTable,
  memberAppInstancesTable,
  usersTable,
  APP_NAMES,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { logAdminAction } from "../lib/audit-log";
import {
  regenerateFlexyPassword,
  buildFlexyOpenUrl,
  ensureFlexyPasswordResetTemplates,
  FLEXY_DOMAIN,
} from "../lib/flexy-provision";
import { CommunicationService } from "../lib/communication-service";

const router: IRouter = Router();

function parseUserId(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

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

// ---------------------------------------------------------------------------
// Flexy support lookup tool
// ---------------------------------------------------------------------------
//
// Lets support agents look up the Flexy login email for a specific member and
// trigger a password regeneration when the member is locked out. The reveal
// endpoint that members used to call (`GET /apps/flexy/credentials`) returns
// the credentials of the *currently signed-in* user, so it can't be used by
// support to help someone else. These routes are admin/support-only.

router.get(
  "/admin/apps/flexy/lookup/:userId",
  requirePermission("apps:support"),
  async (req, res): Promise<void> => {
    const userId = parseUserId(req.params.userId);
    if (userId === null) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    try {
      const [user] = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          smsOptIn: usersTable.smsOptIn,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const [instance] = await db
        .select({
          status: memberAppInstancesTable.status,
          providerStaffEmail: memberAppInstancesTable.providerStaffEmail,
          providerLocationId: memberAppInstancesTable.providerLocationId,
          providerStaffUserId: memberAppInstancesTable.providerStaffUserId,
          updatedAt: memberAppInstancesTable.updatedAt,
        })
        .from(memberAppInstancesTable)
        .where(
          and(
            eq(memberAppInstancesTable.userId, userId),
            eq(memberAppInstancesTable.appName, "flexy"),
          ),
        )
        .limit(1);

      res.json({
        member: {
          id: user.id,
          name: user.name,
          email: user.email,
          hasPhone: !!user.phone,
          smsOptIn: user.smsOptIn,
        },
        flexy: {
          status: instance?.status ?? "not_installed",
          email: instance?.providerStaffEmail ?? null,
          locationId: instance?.providerLocationId ?? null,
          hasStaffUser: !!instance?.providerStaffUserId,
          updatedAt: instance?.updatedAt ?? null,
        },
      });
    } catch (err) {
      console.error("[AdminApps] Flexy lookup failed:", err);
      res.status(500).json({ error: "Failed to look up Flexy credentials" });
    }
  },
);

type NotifyResult = "sent" | "skipped" | "failed";
interface NotifyOutcome {
  email: { requested: boolean; status: NotifyResult; reason?: string };
  sms: { requested: boolean; status: NotifyResult; reason?: string };
}

router.post(
  "/admin/apps/flexy/regenerate-password/:userId",
  requirePermission("apps:support"),
  async (req, res): Promise<void> => {
    const userId = parseUserId(req.params.userId);
    if (userId === null) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const body = (req.body ?? {}) as { notifyEmail?: unknown; notifySms?: unknown };
    const notifyEmail = body.notifyEmail === true;
    const notifySms = body.notifySms === true;

    try {
      const [user] = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          phone: usersTable.phone,
          smsOptIn: usersTable.smsOptIn,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const result = await regenerateFlexyPassword(userId);

      await logAdminAction(
        req,
        "regenerate_password",
        "flexy_credentials",
        String(userId),
        `Regenerated Flexy password for member ${user.email}`,
        { memberId: userId, memberEmail: user.email },
      );

      const notifications: NotifyOutcome = {
        email: { requested: notifyEmail, status: "skipped" },
        sms: { requested: notifySms, status: "skipped" },
      };

      if (notifyEmail || notifySms) {
        await ensureFlexyPasswordResetTemplates();
        const flexyLoginUrl = buildFlexyOpenUrl({
          providerLocationId: null,
          asAdmin: false,
        });
        const memberName = (user.name ?? "").trim() || user.email;
        const variables: Record<string, string> = {
          member_name: memberName,
          flexy_email: result.email,
          flexy_password: result.newPassword,
          flexy_login_url: flexyLoginUrl,
          flexy_domain: FLEXY_DOMAIN,
        };

        const looksSkipped = (err?: string) =>
          !!err && /not configured|\(skipped\)/i.test(err);

        if (notifyEmail) {
          try {
            const emailResult = await CommunicationService.sendEmailNow({
              templateSlug: "flexy_password_reset",
              to: user.email,
              variables,
              userId,
              category: "transactional",
            });
            if (emailResult.success && looksSkipped(emailResult.error)) {
              notifications.email.status = "skipped";
              notifications.email.reason = "provider_not_configured";
            } else if (emailResult.success) {
              notifications.email.status = "sent";
            } else {
              notifications.email.status = "failed";
              notifications.email.reason = emailResult.error;
            }
          } catch (err) {
            notifications.email.status = "failed";
            notifications.email.reason = err instanceof Error ? err.message : String(err);
            console.error("[AdminApps] Flexy password email send failed:", err);
          }
        }

        if (notifySms) {
          if (!user.phone) {
            notifications.sms.status = "skipped";
            notifications.sms.reason = "no_phone_on_file";
          } else if (!user.smsOptIn) {
            notifications.sms.status = "skipped";
            notifications.sms.reason = "not_opted_in";
          } else {
            try {
              const smsResult = await CommunicationService.sendSmsNow({
                templateSlug: "flexy_password_reset",
                to: user.phone,
                variables,
                userId,
              });
              if (smsResult.success && looksSkipped(smsResult.error)) {
                notifications.sms.status = "skipped";
                notifications.sms.reason = "provider_not_configured";
              } else if (smsResult.success) {
                notifications.sms.status = "sent";
              } else {
                notifications.sms.status = "failed";
                notifications.sms.reason = smsResult.error;
              }
            } catch (err) {
              notifications.sms.status = "failed";
              notifications.sms.reason = err instanceof Error ? err.message : String(err);
              console.error("[AdminApps] Flexy password SMS send failed:", err);
            }
          }
        }

        const sentChannels = (
          [
            ["email", notifications.email],
            ["sms", notifications.sms],
          ] as const
        )
          .filter(([, n]) => n.requested)
          .map(([k, n]) => `${k}=${n.status}${n.reason ? `(${n.reason})` : ""}`);

        if (sentChannels.length > 0) {
          await logAdminAction(
            req,
            "notify_password",
            "flexy_credentials",
            String(userId),
            `Sent new Flexy password to member ${user.email} via ${sentChannels.join(", ")}`,
            {
              memberId: userId,
              memberEmail: user.email,
              channels: {
                email: notifications.email.requested
                  ? { status: notifications.email.status, reason: notifications.email.reason }
                  : undefined,
                sms: notifications.sms.requested
                  ? { status: notifications.sms.status, reason: notifications.sms.reason }
                  : undefined,
              },
            },
          );
        }
      }

      res.json({
        email: result.email,
        newPassword: result.newPassword,
        notifications,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Flexy is not installed")) {
        res.status(404).json({ error: message });
        return;
      }
      console.error("[AdminApps] Flexy regenerate-password failed:", err);
      res.status(502).json({ error: "Failed to regenerate Flexy password" });
    }
  },
);

export default router;
