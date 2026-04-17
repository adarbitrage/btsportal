import { db } from "@workspace/db";
import { memberAppInstancesTable, userProductsTable } from "@workspace/db/schema";
import { and, eq, inArray, isNull, lt, max, or, gte } from "drizzle-orm";
import { squidyDelete } from "./squidy-client";

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const INACTIVE_DAYS = 30;

async function findInactiveUserIdsWithApps(): Promise<number[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);

  const usersWithApps = await db
    .selectDistinct({ userId: memberAppInstancesTable.userId })
    .from(memberAppInstancesTable)
    .where(
      inArray(memberAppInstancesTable.status, [
        "installed",
        "install_failed",
      ]),
    );

  if (usersWithApps.length === 0) return [];

  const userIds = usersWithApps.map((r) => r.userId);

  const activeRows = await db
    .selectDistinct({ userId: userProductsTable.userId })
    .from(userProductsTable)
    .where(
      and(
        inArray(userProductsTable.userId, userIds),
        eq(userProductsTable.status, "active"),
        or(
          isNull(userProductsTable.expiresAt),
          gte(userProductsTable.expiresAt, now),
        ),
      ),
    );
  const activeUserIds = new Set(activeRows.map((r) => r.userId));

  const candidates = userIds.filter((id) => !activeUserIds.has(id));
  if (candidates.length === 0) return [];

  const expiryRows = await db
    .select({
      userId: userProductsTable.userId,
      lastExpiry: max(userProductsTable.expiresAt),
    })
    .from(userProductsTable)
    .where(inArray(userProductsTable.userId, candidates))
    .groupBy(userProductsTable.userId);

  const inactive: number[] = [];
  for (const row of expiryRows) {
    if (row.lastExpiry && row.lastExpiry < cutoff) {
      inactive.push(row.userId);
    }
  }
  return inactive;
}

async function uninstallAppsForUser(userId: number): Promise<void> {
  const apps = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        inArray(memberAppInstancesTable.status, ["installed", "install_failed"]),
      ),
    );

  for (const app of apps) {
    if (!app.appUuid) {
      console.log(
        `[InactiveAppCleanup] user=${userId} app=${app.appName} has no appUuid — marking not_installed`,
      );
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
        .where(eq(memberAppInstancesTable.id, app.id));
      continue;
    }

    try {
      console.log(
        `[InactiveAppCleanup] Deleting user=${userId} app=${app.appName} domain=${app.domain}`,
      );
      await squidyDelete(app.appUuid);
      await db
        .update(memberAppInstancesTable)
        .set({ status: "uninstalling", lastLookupAt: new Date() })
        .where(eq(memberAppInstancesTable.id, app.id));
    } catch (err) {
      console.error(
        `[InactiveAppCleanup] Squidy delete failed for user=${userId} app=${app.appName}:`,
        err,
      );
    }
  }
}

export async function runInactiveAppCleanup(): Promise<void> {
  const inactiveUserIds = await findInactiveUserIdsWithApps();
  if (inactiveUserIds.length === 0) {
    console.log("[InactiveAppCleanup] No inactive members with apps to clean up");
    return;
  }
  console.log(
    `[InactiveAppCleanup] Found ${inactiveUserIds.length} inactive member(s) with apps to remove`,
  );
  for (const userId of inactiveUserIds) {
    try {
      await uninstallAppsForUser(userId);
    } catch (err) {
      console.error(`[InactiveAppCleanup] Cleanup failed for user=${userId}:`, err);
    }
  }
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startInactiveAppCleanupJob(): void {
  if (jobInterval) return;
  jobInterval = setInterval(() => {
    runInactiveAppCleanup().catch((err) => {
      console.error("[InactiveAppCleanup] Unexpected error:", err);
    });
  }, RUN_INTERVAL_MS);
  console.log(
    `[InactiveAppCleanup] Started inactive-app cleanup job (every ${RUN_INTERVAL_MS / 60000}m, threshold ${INACTIVE_DAYS}d)`,
  );
}

export function stopInactiveAppCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
