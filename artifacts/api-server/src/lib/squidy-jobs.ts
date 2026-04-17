import { db } from "@workspace/db";
import { memberAppInstancesTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { squidyLookup, type SquidyInstance } from "./squidy-client";

const POLL_INTERVAL_MS = 30 * 1000;
const BATCH_SIZE = 50;

function applySquidyStatus(
  squidyStatus: string,
  squidySubStatus: string | null,
): "installing" | "installed" | "install_failed" {
  if (squidyStatus === "active") return "installed";
  if (squidyStatus === "processing" && squidySubStatus == null) return "installing";
  return "install_failed";
}

async function pollInstallingInstances(): Promise<void> {
  const installing = await db
    .select()
    .from(memberAppInstancesTable)
    .where(eq(memberAppInstancesTable.status, "installing"))
    .limit(BATCH_SIZE);

  if (installing.length === 0) return;

  const domains = installing
    .map((i) => i.domain)
    .filter((d): d is string => !!d);

  if (domains.length === 0) return;

  console.log(`[SquidyJobs] Polling ${domains.length} installing instance(s)...`);

  let lookupResult;
  try {
    lookupResult = await squidyLookup(domains);
  } catch (err) {
    console.error("[SquidyJobs] Lookup failed, will retry on next poll:", err);
    return;
  }

  const instanceMap = new Map<string, SquidyInstance>();
  for (const inst of lookupResult.instances ?? []) {
    if (inst.domain) instanceMap.set(inst.domain, inst);
  }

  for (const row of installing) {
    if (!row.domain) continue;
    const squidyInst = instanceMap.get(row.domain);
    if (!squidyInst) {
      console.log(`[SquidyJobs] No lookup result for domain ${row.domain}, skipping`);
      continue;
    }

    const newStatus = applySquidyStatus(squidyInst.status, squidyInst.sub_status ?? null);
    console.log(
      `[SquidyJobs] domain=${row.domain} squidy_status=${squidyInst.status} sub_status=${squidyInst.sub_status} → app_status=${newStatus}`,
    );

    await db
      .update(memberAppInstancesTable)
      .set({
        status: newStatus,
        squidyStatus: squidyInst.status,
        squidySubStatus: squidyInst.sub_status ?? null,
        lastLookupAt: new Date(),
        squidyError:
          newStatus === "install_failed"
            ? `Squidy sub_status: ${squidyInst.sub_status}`
            : null,
      })
      .where(eq(memberAppInstancesTable.id, row.id));
  }
}

async function pollUninstallingInstances(): Promise<void> {
  const uninstalling = await db
    .select()
    .from(memberAppInstancesTable)
    .where(eq(memberAppInstancesTable.status, "uninstalling"))
    .limit(BATCH_SIZE);

  if (uninstalling.length === 0) return;

  const domains = uninstalling
    .map((i) => i.domain)
    .filter((d): d is string => !!d);

  if (domains.length === 0) return;

  console.log(`[SquidyJobs] Polling ${domains.length} uninstalling instance(s)...`);

  let lookupResult;
  try {
    lookupResult = await squidyLookup(domains);
  } catch (err) {
    // A 404 here means none of the queried domains exist anymore — treat all as deleted.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("HTTP 404")) {
      console.log("[SquidyJobs] Lookup returned 404 for uninstalling batch — marking all as deleted");
      lookupResult = { instances: [] };
    } else {
      console.error("[SquidyJobs] Uninstall lookup failed, will retry on next poll:", err);
      return;
    }
  }

  const presentDomains = new Set<string>();
  for (const inst of lookupResult.instances ?? []) {
    if (inst.domain) presentDomains.add(inst.domain);
  }

  for (const row of uninstalling) {
    if (!row.domain) continue;
    if (presentDomains.has(row.domain)) {
      console.log(`[SquidyJobs] domain=${row.domain} still present in Squidy — keeping uninstalling`);
      await db
        .update(memberAppInstancesTable)
        .set({ lastLookupAt: new Date() })
        .where(eq(memberAppInstancesTable.id, row.id));
      continue;
    }

    console.log(`[SquidyJobs] domain=${row.domain} no longer in Squidy — marking not_installed`);
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
      .where(eq(memberAppInstancesTable.id, row.id));
  }
}

export async function reconcileUserApps(userId: number): Promise<void> {
  const rows = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        inArray(memberAppInstancesTable.status, [
          "installing",
          "install_failed",
          "uninstalling",
        ]),
      ),
    );

  if (rows.length === 0) return;

  const domains = rows.map((r) => r.domain).filter((d): d is string => !!d);
  if (domains.length === 0) return;

  console.log(
    `[SquidyJobs] Reconciling ${rows.length} app(s) for user=${userId} via lookup`,
  );

  let lookupResult;
  try {
    lookupResult = await squidyLookup(domains);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("HTTP 404")) {
      lookupResult = { instances: [] };
    } else {
      console.error("[SquidyJobs] Reconcile lookup failed:", err);
      return;
    }
  }

  const instanceMap = new Map<string, SquidyInstance>();
  for (const inst of lookupResult.instances ?? []) {
    if (inst.domain) instanceMap.set(inst.domain, inst);
  }

  for (const row of rows) {
    if (!row.domain) continue;
    const squidyInst = instanceMap.get(row.domain);

    if (row.status === "uninstalling") {
      if (squidyInst) {
        await db
          .update(memberAppInstancesTable)
          .set({ lastLookupAt: new Date() })
          .where(eq(memberAppInstancesTable.id, row.id));
      } else {
        console.log(
          `[SquidyJobs] reconcile: uninstalling domain=${row.domain} gone — not_installed`,
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
          .where(eq(memberAppInstancesTable.id, row.id));
      }
      continue;
    }

    if (!squidyInst) {
      if (row.status === "install_failed") {
        console.log(
          `[SquidyJobs] reconcile: install_failed domain=${row.domain} not in Squidy — not_installed`,
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
          .where(eq(memberAppInstancesTable.id, row.id));
      }
      continue;
    }

    const newStatus = applySquidyStatus(
      squidyInst.status,
      squidyInst.sub_status ?? null,
    );
    console.log(
      `[SquidyJobs] reconcile: domain=${row.domain} squidy=${squidyInst.status}/${squidyInst.sub_status} → ${newStatus}`,
    );
    await db
      .update(memberAppInstancesTable)
      .set({
        status: newStatus,
        squidyStatus: squidyInst.status,
        squidySubStatus: squidyInst.sub_status ?? null,
        lastLookupAt: new Date(),
        squidyError:
          newStatus === "install_failed"
            ? `Squidy sub_status: ${squidyInst.sub_status}`
            : null,
      })
      .where(eq(memberAppInstancesTable.id, row.id));
  }
}

let jobInterval: ReturnType<typeof setInterval> | null = null;

export function startSquidyJobs(): void {
  if (jobInterval) return;

  jobInterval = setInterval(async () => {
    try {
      await pollInstallingInstances();
    } catch (err) {
      console.error("[SquidyJobs] Unexpected error in install polling job:", err);
    }
    try {
      await pollUninstallingInstances();
    } catch (err) {
      console.error("[SquidyJobs] Unexpected error in uninstall polling job:", err);
    }
  }, POLL_INTERVAL_MS);

  console.log("[SquidyJobs] Started Squidy background poller (30s interval)");
}

export function stopSquidyJobs(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
