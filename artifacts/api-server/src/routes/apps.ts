import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db, memberAppInstancesTable, usersTable, appGlobalSettingsTable, APP_NAMES, type AppName } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  APP_DOMAINS,
  buildSsoRedirectUrl,
  fetchAppSsoToken,
  squidyCreateInstance,
  squidyDelete,
  squidyLookup,
  squidyRetry,
} from "../lib/squidy-client";
import { reconcileUserApps } from "../lib/squidy-jobs";
import { getUserEntitlements } from "../lib/entitlements";
import {
  provisionFlexyForUser,
  disableFlexyForUser,
  buildFlexyOpenUrl,
  revealFlexyCredentials,
  FLEXY_DOMAIN,
} from "../lib/flexy-provision";
import { isAdminRole } from "../middleware/rbac";

const isFlexy = (appName: string): boolean => appName === "flexy";

const router: IRouter = Router();

async function requireActiveMember(userId: number, res: import("express").Response): Promise<boolean> {
  const entitlements = await getUserEntitlements(userId);
  if (entitlements.size === 0) {
    res.status(403).json({ error: "An active membership is required to use this app." });
    return false;
  }
  return true;
}

async function isAppAvailable(appName: string): Promise<{ ok: boolean; reason?: string }> {
  const [row] = await db
    .select({ enabled: appGlobalSettingsTable.enabled, visible: appGlobalSettingsTable.visible })
    .from(appGlobalSettingsTable)
    .where(eq(appGlobalSettingsTable.appName, appName))
    .limit(1);
  const enabled = row?.enabled ?? true;
  const visible = row?.visible ?? true;
  if (!visible) return { ok: false, reason: "This app is not currently available." };
  if (!enabled) return { ok: false, reason: "This app is currently disabled by an administrator." };
  return { ok: true };
}

function generateSubdomain(): string {
  return crypto.randomBytes(4).toString("hex");
}

async function generateUniqueSubdomain(appName: string): Promise<string> {
  const rootDomain = APP_DOMAINS[appName];
  for (let attempt = 0; attempt < 10; attempt++) {
    const sub = generateSubdomain();
    const domain = `${sub}.${rootDomain}`;
    const existing = await db
      .select({ id: memberAppInstancesTable.id })
      .from(memberAppInstancesTable)
      .where(eq(memberAppInstancesTable.domain, domain))
      .limit(1);
    if (existing.length === 0) return domain;
  }
  throw new Error("Could not generate a unique subdomain after 10 attempts");
}

router.get("/apps", async (req, res): Promise<void> => {
  const userId = req.userId!;

  try {
    await reconcileUserApps(userId);
  } catch (err) {
    console.error("[Apps] reconcileUserApps failed (non-fatal):", err);
  }

  const [rows, globalSettings] = await Promise.all([
    db.select().from(memberAppInstancesTable).where(eq(memberAppInstancesTable.userId, userId)),
    db.select().from(appGlobalSettingsTable),
  ]);

  const rowMap = new Map(rows.map((r) => [r.appName, r]));
  const settingMap = new Map(globalSettings.map((s) => [s.appName, s]));

  type AppListItem = {
    appName: string;
    status: string;
    domain: string | null;
    appUuid: string | null;
    squidyStatus: string | null;
    squidySubStatus: string | null;
    lastLookupAt: Date | null;
    squidyError: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    disabled: boolean;
  };

  const result: AppListItem[] = APP_NAMES.flatMap((appName): AppListItem[] => {
    const setting = settingMap.get(appName);
    const visible = setting?.visible ?? true;
    if (!visible) return [];
    const enabled = setting?.enabled ?? true;
    const disabled = !enabled;
    const row = rowMap.get(appName);
    if (!row) {
      return [{
        appName,
        status: "not_installed",
        domain: null,
        appUuid: null,
        squidyStatus: null,
        squidySubStatus: null,
        lastLookupAt: null,
        squidyError: null,
        createdAt: null,
        updatedAt: null,
        disabled,
      }];
    }
    return [{
      appName: row.appName,
      status: row.status,
      domain: row.domain,
      appUuid: row.appUuid,
      squidyStatus: row.squidyStatus,
      squidySubStatus: row.squidySubStatus,
      lastLookupAt: row.lastLookupAt,
      squidyError: row.squidyError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      disabled,
    }];
  });

  res.json(result);
});

router.post("/apps/:appName/install", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const appName = req.params.appName as AppName;

  if (!APP_NAMES.includes(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const availability = await isAppAvailable(appName);
  if (!availability.ok) {
    res.status(403).json({ error: availability.reason });
    return;
  }

  if (!(await requireActiveMember(userId, res))) return;

  const [existing] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  if (existing && existing.status !== "not_installed") {
    res.status(409).json({ error: `App is already ${existing.status}` });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (isFlexy(appName)) {
    if (existing) {
      await db
        .update(memberAppInstancesTable)
        .set({
          status: "installing",
          domain: FLEXY_DOMAIN,
          squidyError: null,
        })
        .where(eq(memberAppInstancesTable.id, existing.id));
    } else {
      await db.insert(memberAppInstancesTable).values({
        userId,
        appName,
        status: "installing",
        domain: FLEXY_DOMAIN,
      });
    }
    try {
      await provisionFlexyForUser(userId);
      await db
        .update(memberAppInstancesTable)
        .set({ status: "installed", squidyError: null })
        .where(
          and(
            eq(memberAppInstancesTable.userId, userId),
            eq(memberAppInstancesTable.appName, appName),
          ),
        );
    } catch (err) {
      console.error(`[Apps] Flexy install failed for user=${userId}:`, err);
      await db
        .update(memberAppInstancesTable)
        .set({
          status: "install_failed",
          squidyError: err instanceof Error ? err.message : String(err),
        })
        .where(
          and(
            eq(memberAppInstancesTable.userId, userId),
            eq(memberAppInstancesTable.appName, appName),
          ),
        );
      res.status(502).json({ error: "App could not be created" });
      return;
    }
    const [updated] = await db
      .select()
      .from(memberAppInstancesTable)
      .where(
        and(
          eq(memberAppInstancesTable.userId, userId),
          eq(memberAppInstancesTable.appName, appName),
        ),
      );
    res.status(201).json(updated);
    return;
  }

  let domain: string;
  let appUuid: string;

  try {
    domain = await generateUniqueSubdomain(appName);
    appUuid = crypto.randomUUID();
  } catch (err) {
    console.error("[Apps] Failed to generate subdomain/uuid:", err);
    res.status(500).json({ error: "Failed to generate instance identifiers" });
    return;
  }

  if (existing) {
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "installing",
        domain,
        appUuid,
        squidyStatus: null,
        squidySubStatus: null,
        squidyError: null,
        lastLookupAt: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));
  } else {
    await db.insert(memberAppInstancesTable).values({
      userId,
      appName,
      status: "installing",
      domain,
      appUuid,
    });
  }

  console.log(`[Apps] Persisted installing row for user=${userId} app=${appName} domain=${domain}`);

  try {
    const squidyPayload = {
      app_name: appName,
      domain,
      source: "BTS",
      user_id: userId,
      extra_data: {
        app_uuid: appUuid,
        username: user.name,
        email: user.email,
      },
    };
    await squidyCreateInstance(squidyPayload);
    console.log(`[Apps] Squidy createInstance succeeded for domain=${domain}`);
  } catch (err) {
    console.error(`[Apps] Squidy createInstance failed for domain=${domain}:`, err);

    let existsInSquidy = false;
    try {
      const lookup = await squidyLookup([domain]);
      existsInSquidy = (lookup.instances ?? []).some((i) => i.domain === domain);
      console.log(`[Apps] Post-failure lookup for domain=${domain}: existsInSquidy=${existsInSquidy}`);
    } catch (lookupErr) {
      console.error(`[Apps] Post-failure lookup for domain=${domain} also failed:`, lookupErr);
    }

    if (existsInSquidy) {
      await db
        .update(memberAppInstancesTable)
        .set({
          status: "install_failed",
          squidyError: err instanceof Error ? err.message : String(err),
        })
        .where(
          and(
            eq(memberAppInstancesTable.userId, userId),
            eq(memberAppInstancesTable.appName, appName),
          ),
        );
    } else {
      await db
        .update(memberAppInstancesTable)
        .set({
          status: "not_installed",
          domain: null,
          appUuid: null,
          squidyStatus: null,
          squidySubStatus: null,
          squidyError: null,
          lastLookupAt: null,
        })
        .where(
          and(
            eq(memberAppInstancesTable.userId, userId),
            eq(memberAppInstancesTable.appName, appName),
          ),
        );
    }

    res.status(502).json({ error: "App could not be created" });
    return;
  }

  const [updated] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  res.status(201).json(updated);
});

router.post("/apps/:appName/retry", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const appName = req.params.appName as AppName;

  if (!APP_NAMES.includes(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const availability = await isAppAvailable(appName);
  if (!availability.ok) {
    res.status(403).json({ error: availability.reason });
    return;
  }

  if (!(await requireActiveMember(userId, res))) return;

  const [existing] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  if (!existing) {
    res.status(404).json({ error: "App instance not found" });
    return;
  }

  if (existing.status !== "install_failed") {
    res.status(409).json({ error: `Retry only available for install_failed apps (current: ${existing.status})` });
    return;
  }

  if (isFlexy(appName)) {
    await db
      .update(memberAppInstancesTable)
      .set({ status: "installing", squidyError: null, domain: FLEXY_DOMAIN })
      .where(eq(memberAppInstancesTable.id, existing.id));
    try {
      await provisionFlexyForUser(userId);
      await db
        .update(memberAppInstancesTable)
        .set({ status: "installed", squidyError: null })
        .where(eq(memberAppInstancesTable.id, existing.id));
    } catch (err) {
      console.error(`[Apps] Flexy retry failed for user=${userId}:`, err);
      await db
        .update(memberAppInstancesTable)
        .set({
          status: "install_failed",
          squidyError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(memberAppInstancesTable.id, existing.id));
      res.status(502).json({ error: "Flexy retry failed" });
      return;
    }
    const [updated] = await db
      .select()
      .from(memberAppInstancesTable)
      .where(eq(memberAppInstancesTable.id, existing.id));
    res.json(updated);
    return;
  }

  if (!existing.domain) {
    res.status(400).json({ error: "No domain on record for this instance" });
    return;
  }

  console.log(`[Apps] Retry: first looking up domain=${existing.domain}`);
  let lookupResult;
  try {
    lookupResult = await squidyLookup([existing.domain]);
  } catch (err) {
    console.error("[Apps] Lookup before retry failed:", err);
    lookupResult = { instances: [] };
  }

  const lookedUp = (lookupResult.instances ?? []).find(
    (i) => i.domain === existing.domain,
  );

  if (lookedUp && lookedUp.status === "active") {
    console.log(`[Apps] Lookup shows active for domain=${existing.domain}, marking installed`);
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "installed",
        squidyStatus: "active",
        squidySubStatus: null,
        lastLookupAt: new Date(),
        squidyError: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));

    const [updated] = await db
      .select()
      .from(memberAppInstancesTable)
      .where(eq(memberAppInstancesTable.id, existing.id));
    res.json(updated);
    return;
  }

  if (
    lookedUp &&
    lookedUp.status === "processing" &&
    (lookedUp.sub_status == null || lookedUp.sub_status === "")
  ) {
    console.log(
      `[Apps] Lookup shows still processing for domain=${existing.domain}, no retry needed`,
    );
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "installing",
        squidyStatus: lookedUp.status,
        squidySubStatus: lookedUp.sub_status ?? null,
        lastLookupAt: new Date(),
        squidyError: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));

    const [updated] = await db
      .select()
      .from(memberAppInstancesTable)
      .where(eq(memberAppInstancesTable.id, existing.id));
    res.json(updated);
    return;
  }

  console.log(`[Apps] Calling Squidy retry for domain=${existing.domain}`);
  try {
    await squidyRetry(existing.domain);
  } catch (err) {
    console.error(`[Apps] Squidy retry failed for domain=${existing.domain}:`, err);
    await db
      .update(memberAppInstancesTable)
      .set({
        squidyError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(memberAppInstancesTable.id, existing.id));
    res.status(502).json({ error: "Squidy retry call failed" });
    return;
  }

  await db
    .update(memberAppInstancesTable)
    .set({
      status: "installing",
      squidyStatus: null,
      squidySubStatus: null,
      squidyError: null,
      lastLookupAt: null,
    })
    .where(eq(memberAppInstancesTable.id, existing.id));

  const [updated] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(eq(memberAppInstancesTable.id, existing.id));

  res.json(updated);
});

router.delete("/apps/:appName", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const appName = req.params.appName as AppName;

  if (!APP_NAMES.includes(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const availability = await isAppAvailable(appName);
  if (!availability.ok) {
    res.status(403).json({ error: availability.reason });
    return;
  }

  const [existing] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  if (!existing || existing.status === "not_installed") {
    res.status(404).json({ error: "App instance not found" });
    return;
  }

  if (isFlexy(appName)) {
    try {
      await disableFlexyForUser(userId);
    } catch (err) {
      console.error(`[Apps] Flexy uninstall failed for user=${userId}:`, err);
      await db
        .update(memberAppInstancesTable)
        .set({ squidyError: err instanceof Error ? err.message : String(err) })
        .where(eq(memberAppInstancesTable.id, existing.id));
      res.status(502).json({ error: "Flexy uninstall failed" });
      return;
    }
    // Non-destructive: keep providerLocationId AND providerStaffUserId so
    // reinstall just re-grants location access on the existing staff record.
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "not_installed",
        domain: null,
        squidyError: null,
        lastLookupAt: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));
    const [updated] = await db
      .select()
      .from(memberAppInstancesTable)
      .where(eq(memberAppInstancesTable.id, existing.id));
    res.json(updated);
    return;
  }

  if (!existing.domain) {
    res.status(400).json({ error: "No domain on record for this instance" });
    return;
  }

  console.log(`[Apps] Uninstall: looking up domain=${existing.domain} to find instance_id`);
  let instanceId: string | undefined;
  try {
    const lookup = await squidyLookup([existing.domain]);
    const looked = (lookup.instances ?? []).find((i) => i.domain === existing.domain);
    instanceId = looked?.id;
  } catch (err) {
    console.error("[Apps] Lookup before delete failed:", err);
    res.status(502).json({ error: "Squidy lookup failed before delete" });
    return;
  }

  if (!instanceId) {
    console.warn(`[Apps] No Squidy instance_id found for domain=${existing.domain}; treating as already deleted`);
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "not_installed",
        domain: null,
        appUuid: null,
        squidyStatus: null,
        squidySubStatus: null,
        squidyError: null,
        lastLookupAt: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));
  } else {
    try {
      await squidyDelete(instanceId);
      console.log(`[Apps] Squidy delete accepted for instance_id=${instanceId}`);
    } catch (err) {
      console.error(`[Apps] Squidy delete failed for instance_id=${instanceId}:`, err);
      await db
        .update(memberAppInstancesTable)
        .set({ squidyError: err instanceof Error ? err.message : String(err) })
        .where(eq(memberAppInstancesTable.id, existing.id));
      res.status(502).json({ error: "Squidy delete call failed" });
      return;
    }

    await db
      .update(memberAppInstancesTable)
      .set({
        status: "uninstalling",
        squidyError: null,
        lastLookupAt: null,
      })
      .where(eq(memberAppInstancesTable.id, existing.id));
  }

  const [updated] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(eq(memberAppInstancesTable.id, existing.id));

  res.json(updated);
});

router.get("/apps/flexy/credentials", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const availability = await isAppAvailable("flexy");
  if (!availability.ok) {
    res.status(403).json({ error: availability.reason });
    return;
  }
  if (!(await requireActiveMember(userId, res))) return;
  try {
    const creds = await revealFlexyCredentials(userId);
    res.json(creds);
  } catch (err) {
    console.error(`[Apps] Flexy credentials reveal failed for user=${userId}:`, err);
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/apps/:appName/sso-redirect", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const appName = req.params.appName as AppName;

  if (!APP_NAMES.includes(appName)) {
    res.status(400).json({ error: "Invalid app name" });
    return;
  }

  const availability = await isAppAvailable(appName);
  if (!availability.ok) {
    res.status(403).json({ error: availability.reason });
    return;
  }

  if (!(await requireActiveMember(userId, res))) return;

  const [existing] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  if (!existing || existing.status !== "installed" || !existing.domain) {
    res.status(409).json({ error: "App is not installed" });
    return;
  }

  if (isFlexy(appName)) {
    if (!existing.providerLocationId) {
      res.status(409).json({ error: "Flexy install is incomplete" });
      return;
    }
    let asAdmin = false;
    if (req.query.admin === "1") {
      const [u] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      asAdmin = !!u && isAdminRole(u.role);
    }
    const url = buildFlexyOpenUrl({
      providerLocationId: existing.providerLocationId,
      asAdmin,
    });
    res.json({ url });
    return;
  }

  try {
    const token = await fetchAppSsoToken(appName, existing.domain);
    const url = buildSsoRedirectUrl(appName, existing.domain, token);
    res.json({ url });
  } catch (err) {
    console.error(`[Apps] SSO token fetch failed for app=${appName} domain=${existing.domain}:`, err);
    res.status(502).json({ error: "Could not generate SSO link" });
  }
});

export default router;
