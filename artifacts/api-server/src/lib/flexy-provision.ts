import { db, memberAppInstancesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  createLocation,
  createStaffUser,
  disableStaffUserForLocation,
  findExistingStaffUser,
  reactivateStaffUserForLocation,
  updateStaffUserPassword,
  generateRandomPassword,
  FLEXY_PORTAL_URL,
} from "./ghl-agency-client";
import { encryptSecret, decryptSecret } from "./app-secrets-crypto";

export const FLEXY_DOMAIN = (FLEXY_PORTAL_URL.replace(/^https?:\/\//, "")).replace(/\/+$/, "");

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return { firstName: "Member", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

interface FlexyInstallResult {
  locationId: string;
  staffUserId: string;
  staffEmail: string;
}

export async function provisionFlexyForUser(userId: number): Promise<FlexyInstallResult> {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) throw new Error(`User ${userId} not found`);

  const [existing] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );

  let locationId = existing?.providerLocationId ?? null;
  let staffUserId = existing?.providerStaffUserId ?? null;

  const { firstName, lastName } = splitName(user.name);
  const memberName = (user.name ?? "").trim() || user.email;
  const businessName = `Flexy - ${memberName}`.trim();
  const staffEmail = user.email;

  if (!locationId) {
    console.log(`[Flexy] Creating sub-account for user=${userId} name="${businessName}"`);
    locationId = await createLocation({
      name: businessName,
      firstName,
      lastName,
      email: staffEmail,
    });
    await db
      .update(memberAppInstancesTable)
      .set({ providerLocationId: locationId })
      .where(
        and(
          eq(memberAppInstancesTable.userId, userId),
          eq(memberAppInstancesTable.appName, "flexy"),
        ),
      );
  }

  // Generate a fresh password every time we have to (re-)create or re-attach
  // the staff user so the member always has a usable credential surfaced.
  let plaintextPassword: string | null = null;

  if (staffUserId) {
    // Existing record (e.g. reinstall after disable) — re-attach to location.
    await reactivateStaffUserForLocation(staffUserId, locationId);
    console.log(`[Flexy] Reactivated staff user=${staffUserId} for location=${locationId}`);
    // Rotate password on reinstall so the member can log in even if the
    // previously surfaced one was lost.
    plaintextPassword = generateRandomPassword();
    await updateStaffUserPassword(staffUserId, plaintextPassword);
  } else {
    const found = await findExistingStaffUser(staffEmail, locationId);
    if (found) {
      staffUserId = found;
      console.log(`[Flexy] Reusing existing staff user=${found} for location=${locationId}`);
      await reactivateStaffUserForLocation(found, locationId);
      plaintextPassword = generateRandomPassword();
      await updateStaffUserPassword(found, plaintextPassword);
    } else {
      console.log(`[Flexy] Creating staff user for user=${userId} location=${locationId}`);
      plaintextPassword = generateRandomPassword();
      staffUserId = await createStaffUser({
        locationId,
        firstName,
        lastName,
        email: staffEmail,
        password: plaintextPassword,
      });
    }
  }

  await db
    .update(memberAppInstancesTable)
    .set({
      providerStaffUserId: staffUserId,
      providerStaffEmail: staffEmail,
      providerStaffPasswordEncrypted: plaintextPassword
        ? encryptSecret(plaintextPassword)
        : existing?.providerStaffPasswordEncrypted ?? null,
    })
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );

  return { locationId, staffUserId, staffEmail };
}

/**
 * Non-destructive uninstall: removes the staff user from the GHL location so
 * they can no longer log in. The sub-account itself and the staff record are
 * preserved so reinstall can re-attach instantly. Throws on provider failure
 * — callers must NOT mark the local row as uninstalled if this throws.
 */
export async function disableFlexyForUser(userId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );
  if (!row) return;
  if (row.providerStaffUserId && row.providerLocationId) {
    await disableStaffUserForLocation(
      row.providerStaffUserId,
      row.providerLocationId,
    );
    console.log(
      `[Flexy] Disabled staff user=${row.providerStaffUserId} on location=${row.providerLocationId}`,
    );
  }
}

export async function regenerateFlexyPassword(userId: number): Promise<{
  email: string;
  password: string;
}> {
  const [row] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );
  if (!row || row.status !== "installed" || !row.providerStaffUserId || !row.providerStaffEmail) {
    throw new Error("Flexy is not installed for this user");
  }
  const newPassword = generateRandomPassword();
  await updateStaffUserPassword(row.providerStaffUserId, newPassword);
  await db
    .update(memberAppInstancesTable)
    .set({ providerStaffPasswordEncrypted: encryptSecret(newPassword) })
    .where(eq(memberAppInstancesTable.id, row.id));
  return { email: row.providerStaffEmail, password: newPassword };
}

export async function revealFlexyCredentials(
  userId: number,
  opts: { includePassword?: boolean } = {},
): Promise<{
  email: string;
  password: string | null;
}> {
  const [row] = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, "flexy"),
      ),
    );
  if (!row || row.status !== "installed" || !row.providerStaffEmail) {
    throw new Error("Flexy is not installed for this user");
  }
  return {
    email: row.providerStaffEmail,
    password:
      opts.includePassword && row.providerStaffPasswordEncrypted
        ? decryptSecret(row.providerStaffPasswordEncrypted)
        : null,
  };
}

export function buildFlexyOpenUrl(opts: {
  providerLocationId?: string | null;
  asAdmin?: boolean;
}): string {
  const base = FLEXY_PORTAL_URL.replace(/\/+$/, "");
  if (opts.asAdmin && opts.providerLocationId) {
    return `${base}/v2/location/${encodeURIComponent(opts.providerLocationId)}/dashboard`;
  }
  return `${base}/`;
}
