/**
 * Live verification script for the Flexy install / uninstall / reinstall flow
 * against the real GoHighLevel agency.
 *
 * This script exercises the same in-process functions (`provisionFlexyForUser`,
 * `disableFlexyForUser`, `revealFlexyCredentials`, `updateStaffUserPassword`)
 * that the `/api/apps/flexy/...` HTTP routes call, then independently queries
 * GHL to assert the resulting agency-side state. It is intentionally chatty so
 * regressions in the agency JWT client, snapshot loading, idempotent re-attach
 * and password rotation surface as a hard FAIL line in the console.
 *
 * Usage (from the repo root):
 *
 *   VERIFY_USER_ID=42 \
 *   GHL_CHERRINGTON_AGENCY_JWT=... \
 *   GHL_CHERRINGTON_CLIENT_ID=... \
 *   GHL_CHERRINGTON_CLIENT_SECRET=... \
 *   GHL_FLEXY_SNAPSHOT_ID=... \
 *   DATABASE_URL=postgres://... \
 *     pnpm --filter @workspace/api-server verify:flexy
 *
 * Optional env vars:
 *   - KEEP_INSTALLED=1  Skip the final uninstall so you can inspect the
 *                       sub-account in the GHL UI; the script will leave the
 *                       member in the `installed` state.
 *   - SKIP_PASSWORD_ROTATION=1  Skip the GHL password rotation step. The
 *                       repo currently exposes no /apps/flexy/regenerate
 *                       route; we exercise the underlying primitive
 *                       (`updateStaffUserPassword`) so future regressions are
 *                       caught even though no end-user flow uses it yet.
 *
 * The script never logs the rotated password and never persists it.
 *
 * The script exits non-zero on the first failed assertion. A clean run prints
 *   `[Verify] PASS — {count} assertions OK`
 * at the end, and the manual UI confirmation steps documented in
 * `docs/flexy-provisioning-verification.md` should then be performed in the
 * GHL agency dashboard.
 */

import { db, memberAppInstancesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  FLEXY_DOMAIN,
  disableFlexyForUser,
  provisionFlexyForUser,
  revealFlexyCredentials,
} from "../lib/flexy-provision";
import { findMemberAppInstance } from "../lib/member-app-instance-lookup";
import {
  generateRandomPassword,
  getStaffUserPublic,
  locationExists,
  searchAgencyLocationsByName,
  updateStaffUserPassword,
} from "../lib/ghl-agency-client";

let assertionCount = 0;

function assert(cond: unknown, message: string): asserts cond {
  assertionCount++;
  if (cond) {
    console.log(`[Verify] OK   — ${message}`);
    return;
  }
  console.error(`[Verify] FAIL — ${message}`);
  throw new Error(`Assertion failed: ${message}`);
}

function step(title: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(`[Verify] ${title}`);
  console.log("=".repeat(72));
}

async function loadInstance(userId: number) {
  return findMemberAppInstance(userId, "flexy");
}

async function loadUser(userId: number) {
  const [u] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u ?? null;
}

function expectedBusinessName(name: string | null | undefined, email: string): string {
  const trimmed = (name ?? "").trim() || email;
  return `Flexy - ${trimmed}`.trim();
}

function isAdminRole(staff: { type?: string; role?: string }): boolean {
  // GHL accepts either `account` (location admin) or `agency` for `type`.
  // The provisioning code uses `type=account, role=admin`; some agencies have
  // historical records with role=`account-admin`. Accept both.
  const role = (staff.role ?? "").toLowerCase();
  return role === "admin" || role === "account-admin";
}

async function assertGhlAfterInstall(opts: {
  userId: number;
  expectedLocationId: string;
  expectedStaffId: string;
  expectedEmail: string;
  expectedBusinessName: string;
}): Promise<void> {
  const { expectedLocationId, expectedStaffId, expectedEmail, expectedBusinessName } = opts;

  const exists = await locationExists(expectedLocationId);
  assert(
    exists,
    `GHL sub-account ${expectedLocationId} ("${expectedBusinessName}") exists in the agency`,
  );

  const matches = await searchAgencyLocationsByName(expectedBusinessName);
  assert(
    matches.length === 1,
    `exactly one agency sub-account named "${expectedBusinessName}" exists (found ${matches.length})`,
  );
  assert(
    matches[0]?.id === expectedLocationId,
    `the matching sub-account id (${matches[0]?.id ?? "n/a"}) equals the persisted providerLocationId (${expectedLocationId})`,
  );

  const staff = await getStaffUserPublic(expectedStaffId);
  assert(staff !== null, `staff user ${expectedStaffId} exists in GHL`);
  if (!staff) return;
  assert(
    (staff.email ?? "").toLowerCase() === expectedEmail.toLowerCase(),
    `staff user email matches member email (${staff.email} == ${expectedEmail})`,
  );
  assert(isAdminRole(staff), `staff user has admin role (got role="${staff.role ?? ""}")`);
  assert(
    staff.locationIds.includes(expectedLocationId),
    `staff user is attached to location ${expectedLocationId} (locationIds=[${staff.locationIds.join(", ")}])`,
  );
}

async function assertGhlAfterUninstall(opts: {
  expectedLocationId: string;
  expectedStaffId: string;
}): Promise<void> {
  const { expectedLocationId, expectedStaffId } = opts;

  // Sub-account must NOT be deleted on uninstall (non-destructive policy).
  const exists = await locationExists(expectedLocationId);
  assert(exists, `sub-account ${expectedLocationId} is preserved after uninstall (non-destructive)`);

  const staff = await getStaffUserPublic(expectedStaffId);
  // Either the staff user is fully deleted (when this was their only
  // location) OR the location was removed from their locationIds. Both
  // satisfy "member can no longer log in".
  if (staff === null) {
    assert(true, `staff user ${expectedStaffId} was fully deleted (it was their only location)`);
    return;
  }
  assert(
    !staff.locationIds.includes(expectedLocationId),
    `staff user ${expectedStaffId} no longer has access to location ${expectedLocationId} (locationIds=[${staff.locationIds.join(", ")}])`,
  );
}

async function main(): Promise<void> {
  const userIdRaw = process.env.VERIFY_USER_ID;
  if (!userIdRaw) {
    throw new Error(
      "VERIFY_USER_ID env var is required. Set it to the BTS user id of a test member you are willing to install Flexy for.",
    );
  }
  const userId = Number.parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error(`VERIFY_USER_ID must be a positive integer, got "${userIdRaw}"`);
  }

  const keepInstalled = process.env.KEEP_INSTALLED === "1";
  const skipPasswordRotation = process.env.SKIP_PASSWORD_ROTATION === "1";

  console.log(`[Verify] Target BTS user_id=${userId}`);
  console.log(`[Verify] keepInstalled=${keepInstalled} skipPasswordRotation=${skipPasswordRotation}`);

  const user = await loadUser(userId);
  if (!user) throw new Error(`BTS user ${userId} not found`);
  const businessName = expectedBusinessName(user.name, user.email);
  console.log(`[Verify] Member name="${user.name ?? ""}" email="${user.email}" expectedBusinessName="${businessName}"`);

  // Snapshot the starting DB state so we can warn the operator if this user
  // already has a Flexy install (which is fine — the test is idempotent — but
  // good to call out so the operator knows a real provider record will be
  // re-attached, not freshly created).
  const startRow = await loadInstance(userId);
  if (startRow) {
    console.log(
      `[Verify] Starting DB row: status=${startRow.status} providerLocationId=${startRow.providerLocationId ?? "null"} providerStaffUserId=${startRow.providerStaffUserId ?? "null"}`,
    );
  } else {
    console.log(`[Verify] Starting DB row: none (clean install path)`);
  }

  // ---------------------------------------------------------------------
  // Step 1: install
  // ---------------------------------------------------------------------
  step("Step 1/5 — install");
  // Mirror what apps.ts does: ensure a row exists in `installing` status, then
  // call provisionFlexyForUser. We don't go through the HTTP layer because
  // this script is meant to be runnable without the API server running.
  if (startRow) {
    await db
      .update(memberAppInstancesTable)
      .set({ status: "installing", domain: FLEXY_DOMAIN, squidyError: null })
      .where(eq(memberAppInstancesTable.id, startRow.id));
  } else {
    await db.insert(memberAppInstancesTable).values({
      userId,
      appName: "flexy",
      status: "installing",
      domain: FLEXY_DOMAIN,
    });
  }

  const installResult = await provisionFlexyForUser(userId);
  console.log(`[Verify] install returned: ${JSON.stringify(installResult)}`);

  await db
    .update(memberAppInstancesTable)
    .set({ status: "installed", domain: FLEXY_DOMAIN, squidyError: null })
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );

  const afterInstallRow = await loadInstance(userId);
  assert(afterInstallRow !== null, "DB row exists after install");
  if (!afterInstallRow) return;
  assert(afterInstallRow.status === "installed", `DB status is "installed" (got "${afterInstallRow.status}")`);
  assert(
    afterInstallRow.providerLocationId === installResult.locationId,
    "DB providerLocationId equals provisioner result",
  );
  assert(
    afterInstallRow.providerStaffUserId === installResult.staffUserId,
    "DB providerStaffUserId equals provisioner result",
  );
  assert(
    afterInstallRow.providerStaffEmail === installResult.staffEmail,
    "DB providerStaffEmail equals provisioner result",
  );
  assert(
    afterInstallRow.providerStaffPasswordEncrypted === null,
    "DB does NOT persist a staff password (members activate via GHL email)",
  );

  await assertGhlAfterInstall({
    userId,
    expectedLocationId: installResult.locationId,
    expectedStaffId: installResult.staffUserId,
    expectedEmail: installResult.staffEmail,
    expectedBusinessName: businessName,
  });

  // ---------------------------------------------------------------------
  // Step 2: reveal
  // ---------------------------------------------------------------------
  step("Step 2/5 — reveal credentials");
  const reveal = await revealFlexyCredentials(userId);
  assert(
    reveal.email.toLowerCase() === user.email.toLowerCase(),
    `revealed email (${reveal.email}) matches member email (${user.email})`,
  );

  // ---------------------------------------------------------------------
  // Step 3: password rotation primitive (no /regenerate route exists today;
  // we exercise the underlying GHL call so future regressions are caught).
  // ---------------------------------------------------------------------
  if (skipPasswordRotation) {
    step("Step 3/5 — password rotation (SKIPPED via SKIP_PASSWORD_ROTATION=1)");
  } else {
    step("Step 3/5 — password rotation primitive");
    const rotated = generateRandomPassword();
    await updateStaffUserPassword(installResult.staffUserId, rotated);
    console.log("[Verify] updateStaffUserPassword returned without error");

    const staff = await getStaffUserPublic(installResult.staffUserId);
    assert(staff !== null, "staff user still exists after password rotation");
    if (staff) {
      assert(
        staff.locationIds.includes(installResult.locationId),
        "staff user is still attached to its location after password rotation",
      );
      assert(isAdminRole(staff), "staff user still has admin role after password rotation");
    }
  }

  // ---------------------------------------------------------------------
  // Step 4: uninstall
  // ---------------------------------------------------------------------
  step("Step 4/5 — uninstall");
  await disableFlexyForUser(userId);
  await db
    .update(memberAppInstancesTable)
    .set({
      status: "not_installed",
      domain: null,
      squidyError: null,
      lastLookupAt: null,
    })
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );

  const afterUninstallRow = await loadInstance(userId);
  assert(afterUninstallRow !== null, "DB row preserved after uninstall");
  if (!afterUninstallRow) return;
  assert(
    afterUninstallRow.status === "not_installed",
    `DB status is "not_installed" after uninstall (got "${afterUninstallRow.status}")`,
  );
  assert(
    afterUninstallRow.providerLocationId === installResult.locationId,
    "DB still remembers providerLocationId after uninstall (so reinstall re-attaches)",
  );
  assert(
    afterUninstallRow.providerStaffUserId === installResult.staffUserId,
    "DB still remembers providerStaffUserId after uninstall",
  );

  await assertGhlAfterUninstall({
    expectedLocationId: installResult.locationId,
    expectedStaffId: installResult.staffUserId,
  });

  // ---------------------------------------------------------------------
  // Step 5: reinstall (must reuse the same sub-account and re-attach the
  // same staff user; must NOT create a duplicate "Flexy - {name}" location).
  // ---------------------------------------------------------------------
  step("Step 5/5 — reinstall");
  await db
    .update(memberAppInstancesTable)
    .set({ status: "installing", domain: FLEXY_DOMAIN, squidyError: null })
    .where(eq(memberAppInstancesTable.id, afterUninstallRow.id));

  const reinstallResult = await provisionFlexyForUser(userId);
  console.log(`[Verify] reinstall returned: ${JSON.stringify(reinstallResult)}`);

  await db
    .update(memberAppInstancesTable)
    .set({ status: "installed", domain: FLEXY_DOMAIN, squidyError: null })
    .where(eq(memberAppInstancesTable.id, afterUninstallRow.id));

  assert(
    reinstallResult.locationId === installResult.locationId,
    `reinstall reused the same sub-account (${reinstallResult.locationId} == ${installResult.locationId})`,
  );
  // Staff user id may legitimately change ONLY if the previous uninstall
  // fully deleted the staff record (i.e. the member had no other locations
  // in this agency). In that case provisionFlexyForUser creates a fresh
  // staff user against the reused location — that is documented behavior.
  if (reinstallResult.staffUserId !== installResult.staffUserId) {
    console.log(
      `[Verify] note: staff user id changed (${installResult.staffUserId} -> ${reinstallResult.staffUserId}); this is expected only if uninstall fully deleted the staff record. Verifying...`,
    );
  }

  await assertGhlAfterInstall({
    userId,
    expectedLocationId: reinstallResult.locationId,
    expectedStaffId: reinstallResult.staffUserId,
    expectedEmail: reinstallResult.staffEmail,
    expectedBusinessName: businessName,
  });

  // Crucial: confirm reinstall did NOT create a duplicate sub-account.
  const dupCheck = await searchAgencyLocationsByName(businessName);
  assert(
    dupCheck.length === 1,
    `still exactly one "${businessName}" sub-account after reinstall (found ${dupCheck.length})`,
  );

  // ---------------------------------------------------------------------
  // Optional cleanup: leave the member uninstalled by default so test runs
  // are idempotent. Skip via KEEP_INSTALLED=1 to inspect the GHL UI.
  // ---------------------------------------------------------------------
  if (keepInstalled) {
    step("Cleanup — KEEP_INSTALLED=1, leaving member in installed state");
  } else {
    step("Cleanup — uninstalling so reruns start from a known state");
    await disableFlexyForUser(userId);
    await db
      .update(memberAppInstancesTable)
      .set({
        status: "not_installed",
        domain: null,
        squidyError: null,
        lastLookupAt: null,
      })
      .where(eq(memberAppInstancesTable.id, afterUninstallRow.id));
  }

  console.log("\n" + "=".repeat(72));
  console.log(`[Verify] PASS — ${assertionCount} assertions OK`);
  console.log("=".repeat(72));
  console.log(
    "\nNow perform the manual UI checks documented in artifacts/api-server/docs/flexy-provisioning-verification.md",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n" + "=".repeat(72));
    console.error(`[Verify] FAILED after ${assertionCount} assertions`);
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    console.error("=".repeat(72));
    process.exit(1);
  });
