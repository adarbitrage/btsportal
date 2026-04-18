import { db, memberAppInstancesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  createLocation,
  createStaffUser,
  disableStaffUserForLocation,
  findExistingStaffUser,
  mintLoginUrl,
  reactivateStaffUserForLocation,
  FLEXY_PORTAL_URL,
} from "./ghl-agency-client";

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
  const businessName = `Flexy - ${user.name}`.trim();

  if (!locationId) {
    console.log(`[Flexy] Creating sub-account for user=${userId} name="${businessName}"`);
    locationId = await createLocation({
      name: businessName,
      email: user.email,
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

  if (staffUserId) {
    // Existing record (e.g. reinstall after disable) — make sure the staff
    // user has access to the location again.
    await reactivateStaffUserForLocation(staffUserId, locationId);
    console.log(`[Flexy] Reactivated staff user=${staffUserId} for location=${locationId}`);
  } else {
    const found = await findExistingStaffUser(user.email, locationId);
    if (found) {
      staffUserId = found;
      console.log(`[Flexy] Reusing existing staff user=${found} for location=${locationId}`);
      // Ensure the rediscovered user actually has location access.
      await reactivateStaffUserForLocation(found, locationId);
    } else {
      console.log(`[Flexy] Creating staff user for user=${userId} location=${locationId}`);
      staffUserId = await createStaffUser({
        locationId,
        firstName,
        lastName,
        email: user.email,
      });
    }
    await db
      .update(memberAppInstancesTable)
      .set({ providerStaffUserId: staffUserId })
      .where(
        and(
          eq(memberAppInstancesTable.userId, userId),
          eq(memberAppInstancesTable.appName, "flexy"),
        ),
      );
  }

  return { locationId, staffUserId };
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

export async function buildFlexyLoginUrl(locationId: string, staffUserId: string): Promise<string> {
  return mintLoginUrl(locationId, staffUserId);
}
