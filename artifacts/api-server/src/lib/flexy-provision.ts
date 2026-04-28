import { db, memberAppInstancesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  createLocation,
  createStaffUser,
  disableStaffUserForLocation,
  findExistingStaffUser,
  mintFlexyLoginUrl,
  reactivateStaffUserForLocation,
  generateRandomPassword,
  FLEXY_PORTAL_URL,
} from "./ghl-agency-client";

export const FLEXY_DOMAIN = (FLEXY_PORTAL_URL.replace(/^https?:\/\//, "")).replace(/\/+$/, "");

function splitName(fullName: string): { firstName: string; lastName: string } {
  // GHL requires both firstName and lastName to be non-empty when creating
  // a staff user. If the member only has a single-word name, repeat it as
  // the last name so provisioning still succeeds.
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return { firstName: "Member", lastName: "Member" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
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

  // We deliberately do NOT keep a copy of the staff password. GHL sends an
  // activation email to the member's address on user creation; the member
  // sets their own password via that link. We still pass a random throwaway
  // password to the create call because GHL requires one.

  if (staffUserId) {
    // Existing record (e.g. reinstall after disable) — re-attach to location.
    // If the previous uninstall fully deleted the staff user (because it was
    // their only location), GHL returns 404 here. Fall through to the
    // create-new-user branch in that case so reinstall still succeeds.
    try {
      await reactivateStaffUserForLocation(staffUserId, locationId);
      console.log(`[Flexy] Reactivated staff user=${staffUserId} for location=${locationId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("HTTP 404") || msg.includes("does not exist")) {
        console.log(
          `[Flexy] Stored staff user=${staffUserId} no longer exists in GHL; will create a new one`,
        );
        staffUserId = null;
      } else {
        throw err;
      }
    }
  }
  if (!staffUserId) {
    const found = await findExistingStaffUser(staffEmail, locationId);
    if (found) {
      staffUserId = found;
      console.log(`[Flexy] Reusing existing staff user=${found} for location=${locationId}`);
      await reactivateStaffUserForLocation(found, locationId);
    } else {
      console.log(`[Flexy] Creating staff user for user=${userId} location=${locationId}`);
      staffUserId = await createStaffUser({
        locationId,
        firstName,
        lastName,
        email: staffEmail,
        password: generateRandomPassword(),
      });
    }
  }

  await db
    .update(memberAppInstancesTable)
    .set({
      providerStaffUserId: staffUserId,
      providerStaffEmail: staffEmail,
      providerStaffPasswordEncrypted: null,
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

export async function revealFlexyCredentials(userId: number): Promise<{
  email: string;
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
  return { email: row.providerStaffEmail };
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

/**
 * Resolve the URL to send the member to when they click "Open Flexy".
 *
 * For non-admin opens we first try to mint a one-time GHL login URL so the
 * member lands inside the dashboard already authenticated. If that fails for
 * any reason (endpoint changed, staff user not eligible, network blip) we
 * fall back to the existing behavior — the white-label login page or, for
 * admins, the location deep link — so the click never breaks.
 *
 * NOTE (Apr 2026): the mint helper is disabled by default — see
 * `docs/flexy-sso-verification.md` ("Decision" section) for the recorded
 * decision to keep showing the Flexy login page indefinitely. With no
 * `GHL_LOGIN_TOKEN_PATH` set, `mintFlexyLoginUrl` short-circuits to null
 * and this function always returns the white-label fallback.
 */
export async function resolveFlexyOpenUrl(opts: {
  providerLocationId?: string | null;
  providerStaffUserId?: string | null;
  asAdmin?: boolean;
}): Promise<string> {
  const fallback = buildFlexyOpenUrl({
    providerLocationId: opts.providerLocationId,
    asAdmin: opts.asAdmin,
  });

  if (opts.asAdmin) {
    // Admin "view as agency" deep link — keep behavior unchanged. Admins
    // typically have an existing dashboard session and the deep link assumes
    // that. Minting a member-scoped login URL would actually log them in as
    // the member, which is not what the admin shortcut is for.
    return fallback;
  }

  if (!opts.providerStaffUserId || !opts.providerLocationId) {
    return fallback;
  }

  try {
    const ssoUrl = await mintFlexyLoginUrl({
      staffUserId: opts.providerStaffUserId,
      locationId: opts.providerLocationId,
    });
    if (ssoUrl) return ssoUrl;
  } catch (err) {
    console.warn(`[Flexy] resolveFlexyOpenUrl: SSO mint threw, falling back:`, err);
  }
  return fallback;
}
