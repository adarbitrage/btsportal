import { db, memberAppInstancesTable, usersTable, emailTemplatesTable, smsTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  createLocation,
  createStaffUser,
  disableStaffUserForLocation,
  findExistingStaffUser,
  mintFlexyLoginUrl,
  reactivateStaffUserForLocation,
  updateStaffUserPassword,
  generateRandomPassword,
  FLEXY_PORTAL_URL,
} from "./ghl-agency-client";
import { findMemberAppInstance } from "./member-app-instance-lookup";

export const FLEXY_DOMAIN = (FLEXY_PORTAL_URL.replace(/^https?:\/\//, "")).replace(/\/+$/, "");

const FLEXY_PASSWORD_RESET_EMAIL_TEMPLATE = {
  slug: "flexy_password_reset",
  name: "Flexy Password Reset",
  subject: "Your new Flexy password",
  htmlBody: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1a1a2e;padding:30px;text-align:center;"><h1 style="color:#ffffff;margin:0;font-size:24px;">Build Test Scale</h1></td></tr>
<tr><td style="padding:30px;">
<h2 style="color:#1a1a2e;margin-top:0;">Your Flexy password has been reset</h2>
<p>Hi {{member_name}},</p>
<p>Our support team just generated a new password for your Flexy login. Use the credentials below the next time you sign in.</p>
<p style="background:#f0f0ff;padding:15px;border-radius:6px;font-family:monospace;"><strong>Login email:</strong> {{flexy_email}}<br><strong>New password:</strong> {{flexy_password}}</p>
<p>For your security, change this password to something only you know after you log in. If you did not request this reset, contact us right away at {{support_email}}.</p>
<p><a href="{{flexy_login_url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Open Flexy Login</a></p>
<p>The BTS Team</p>
</td></tr>
<tr><td style="background:#f8f8f8;padding:20px;text-align:center;font-size:12px;color:#999;"><p style="margin:0;">&copy; {{current_year}} Build Test Scale. All rights reserved.</p></td></tr>
</table></td></tr></table></body></html>`,
  textBody: "Hi {{member_name}},\n\nOur support team just generated a new password for your Flexy login.\n\nLogin email: {{flexy_email}}\nNew password: {{flexy_password}}\n\nFor your security, change this password after you log in. If you did not request this reset, contact {{support_email}} right away.\n\nLog in at {{flexy_login_url}}\n\nThe BTS Team",
  category: "transactional",
  variables: ["member_name", "flexy_email", "flexy_password", "flexy_login_url", "support_email", "current_year"],
};

const FLEXY_PASSWORD_RESET_SMS_TEMPLATE = {
  slug: "flexy_password_reset",
  name: "Flexy Password Reset SMS",
  body: "BTS: Your Flexy password was just reset. Login: {{flexy_email}} / Password: {{flexy_password}}. Change it after you log in.",
  variables: ["flexy_email", "flexy_password"],
};

let templatesEnsured = false;
export async function ensureFlexyPasswordResetTemplates(): Promise<void> {
  if (templatesEnsured) return;
  try {
    await db
      .insert(emailTemplatesTable)
      .values(FLEXY_PASSWORD_RESET_EMAIL_TEMPLATE)
      .onConflictDoNothing({ target: emailTemplatesTable.slug });
    await db
      .insert(smsTemplatesTable)
      .values(FLEXY_PASSWORD_RESET_SMS_TEMPLATE)
      .onConflictDoNothing({ target: smsTemplatesTable.slug });
    templatesEnsured = true;
  } catch (err) {
    console.warn("[Flexy] Could not ensure flexy_password_reset templates:", err);
  }
}

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

  const existing = await findMemberAppInstance(userId, "flexy");

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
  const row = await findMemberAppInstance(userId, "flexy");
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
  const row = await findMemberAppInstance(userId, "flexy");
  if (!row || row.status !== "installed" || !row.providerStaffEmail) {
    throw new Error("Flexy is not installed for this user");
  }
  return { email: row.providerStaffEmail };
}

/**
 * Generate a fresh random password for the member's Flexy staff user and
 * push it to GHL. Returns the new plaintext password so the caller can show
 * it to the support agent (we deliberately do not persist it).
 *
 * Throws if the user does not have an installed Flexy instance.
 */
export async function regenerateFlexyPassword(userId: number): Promise<{
  email: string;
  newPassword: string;
}> {
  const row = await findMemberAppInstance(userId, "flexy");
  if (!row || row.status !== "installed" || !row.providerStaffUserId || !row.providerStaffEmail) {
    throw new Error("Flexy is not installed for this user");
  }
  const newPassword = generateRandomPassword();
  await updateStaffUserPassword(row.providerStaffUserId, newPassword);
  return { email: row.providerStaffEmail, newPassword };
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
