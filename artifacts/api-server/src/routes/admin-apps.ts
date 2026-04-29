import { Router, type IRouter } from "express";
import {
  db,
  appGlobalSettingsTable,
  auditLogTable,
  memberAppInstancesTable,
  usersTable,
  APP_NAMES,
} from "@workspace/db";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { logAdminAction } from "../lib/audit-log";
import {
  regenerateFlexyPassword,
  buildFlexyOpenUrl,
  ensureFlexyPasswordResetTemplates,
  FLEXY_DOMAIN,
} from "../lib/flexy-provision";
import { findMemberAppInstance } from "../lib/member-app-instance-lookup";
import {
  CommunicationService,
  type CommunicationOutcome,
} from "../lib/communication-service";

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

      const instance = await findMemberAppInstance(userId, "flexy");

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

// ---------------------------------------------------------------------------
// Flexy password-reset history
// ---------------------------------------------------------------------------
//
// Returns recent audit-log events for Flexy password resets so admins can see
// who reset which member's password, when, and which channels were notified.
// Plaintext passwords are NEVER stored in the audit log (and never returned
// here) — we only surface metadata that was already written by the regenerate
// and notify flows above.

// Exported so the audit-log retention registry
// (`lib/audit-log-retention.ts`) can reuse the same string values and we
// don't end up with the action_type names typed in two places that can
// silently drift apart.
export const FLEXY_RESET_ACTIONS = ["regenerate_password", "notify_password"] as const;

interface FlexyResetEvent {
  id: number;
  createdAt: string | null;
  actionType: string;
  actorId: number | null;
  actorEmail: string | null;
  memberId: number | null;
  memberEmail: string | null;
  description: string;
  channels: {
    email?: { status: string; reason?: string };
    sms?: { status: string; reason?: string };
  } | null;
}

router.get(
  "/admin/apps/flexy/password-reset-history",
  requirePermission("apps:support"),
  async (req, res): Promise<void> => {
    const userIdRaw = req.query.userId;
    const actorEmailRaw = req.query.actorEmail;
    const limitRaw = req.query.limit;

    let userId: number | null = null;
    if (typeof userIdRaw === "string" && userIdRaw.length > 0) {
      userId = parseUserId(userIdRaw);
      if (userId === null) {
        res.status(400).json({ error: "Invalid userId" });
        return;
      }
    }

    let actorEmail: string | null = null;
    if (typeof actorEmailRaw === "string") {
      const trimmed = actorEmailRaw.trim();
      if (trimmed.length > 0) actorEmail = trimmed;
    }

    let limit = 25;
    if (typeof limitRaw === "string" && limitRaw.length > 0) {
      const parsed = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    try {
      const conditions = [
        eq(auditLogTable.entityType, "flexy_credentials"),
        inArray(
          auditLogTable.actionType,
          FLEXY_RESET_ACTIONS as unknown as string[],
        ),
      ];
      if (userId !== null) {
        conditions.push(eq(auditLogTable.entityId, String(userId)));
      }
      if (actorEmail) {
        conditions.push(ilike(auditLogTable.actorEmail, `%${actorEmail}%`));
      }

      const rows = await db
        .select({
          id: auditLogTable.id,
          createdAt: auditLogTable.createdAt,
          actionType: auditLogTable.actionType,
          actorId: auditLogTable.actorId,
          actorEmail: auditLogTable.actorEmail,
          entityId: auditLogTable.entityId,
          description: auditLogTable.description,
          changeDiff: auditLogTable.changeDiff,
        })
        .from(auditLogTable)
        .where(and(...conditions))
        .orderBy(desc(auditLogTable.createdAt))
        .limit(limit);

      const events: FlexyResetEvent[] = rows.map((row) => {
        const diff = (row.changeDiff ?? {}) as Record<string, unknown>;
        const memberEmail =
          typeof diff.memberEmail === "string" ? diff.memberEmail : null;
        const channels =
          row.actionType === "notify_password" &&
          diff.channels &&
          typeof diff.channels === "object"
            ? (diff.channels as FlexyResetEvent["channels"])
            : null;

        let memberId: number | null = null;
        if (row.entityId && /^[1-9]\d*$/.test(row.entityId)) {
          memberId = Number.parseInt(row.entityId, 10);
        }

        return {
          id: row.id,
          createdAt: row.createdAt ? row.createdAt.toISOString() : null,
          actionType: row.actionType,
          actorId: row.actorId,
          actorEmail: row.actorEmail,
          memberId,
          memberEmail,
          description: row.description,
          channels,
        };
      });

      res.json({ events });
    } catch (err) {
      console.error("[AdminApps] Flexy password-reset history failed:", err);
      res.status(500).json({ error: "Failed to load password reset history" });
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

        // Translate the queueEmail/queueSms outcome into the per-channel
        // status the admin UI already understands. "queued" and
        // "sent_direct" both count as a successful "sent" — from the
        // admin's POV we did our job; the worker (or direct fallback when
        // Redis is down) takes it from there.
        const mapOutcome = (
          outcome: CommunicationOutcome,
        ): { status: NotifyResult; reason?: string } => {
          if (outcome.result === "queued" || outcome.result === "sent_direct") {
            return { status: "sent" };
          }
          if (outcome.result === "skipped") {
            return { status: "skipped", reason: outcome.reason };
          }
          return { status: "failed", reason: outcome.reason };
        };

        if (notifyEmail) {
          try {
            const outcome = await CommunicationService.queueEmail({
              templateSlug: "flexy_password_reset",
              to: user.email,
              variables,
              userId,
              category: "transactional",
            });
            const mapped = mapOutcome(outcome);
            notifications.email.status = mapped.status;
            if (mapped.reason !== undefined) {
              notifications.email.reason = mapped.reason;
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
              const outcome = await CommunicationService.queueSms({
                templateSlug: "flexy_password_reset",
                to: user.phone,
                variables,
                userId,
              });
              const mapped = mapOutcome(outcome);
              notifications.sms.status = mapped.status;
              if (mapped.reason !== undefined) {
                notifications.sms.reason = mapped.reason;
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
