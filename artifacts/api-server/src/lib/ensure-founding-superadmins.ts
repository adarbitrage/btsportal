import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CommunicationService } from "./communication-service";

// One-time founding super_admin bootstrap.
//
// PRODUCTION is a separate database the agent cannot write directly, and it
// started life with ZERO super_admins. The in-app "assign role" action is
// itself super_admin-only, so nobody could ever hand out the first one — a
// chicken-and-egg deadlock. This boot hook mints the agreed founding
// super_admins (Adam + Sandy) so the normal in-app role-assignment flow can
// take over from there.
//
// SELF-DISABLING — the most important property: this runs on EVERY deploy, so
// it MUST NOT re-assert roles. The instant ANY super_admin row exists it
// becomes a complete no-op. That guarantees:
//   - it only ever acts once (when prod still has 0 super_admins), and
//   - if a super_admin later demotes Adam or Sandy through the UI, the next
//     deploy will NOT silently re-promote them.
const FOUNDING_SUPER_ADMINS: ReadonlyArray<{ email: string; name: string }> = [
  { email: "adam@cherringtonmedia.com", name: "Adam" },
  { email: "sandy@cherringtonmedia.com", name: "Sandy" },
];

const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — generous so a boot-time invite isn't stale by the time it's opened.

export async function ensureFoundingSuperAdmins(): Promise<void> {
  // Self-disable: if a super_admin already exists, the deadlock is broken and
  // role management belongs entirely to the in-app flow from here on.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.role, "super_admin"));
  if (n > 0) {
    return;
  }

  console.log("[Bootstrap] 0 super_admins found — minting founding super_admins.");

  // Collect per-founder failures but keep going so one bad founder never blocks
  // the other. Re-thrown at the end so bootstrapCriticalPrerequisites records
  // it in `missing` instead of falsely reporting "All critical prerequisites OK".
  const failures: string[] = [];

  for (const founder of FOUNDING_SUPER_ADMINS) {
    const email = founder.email.toLowerCase();
    try {
      const [existing] = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);

      if (existing) {
        // Existing account (e.g. Adam, already an admin) — just elevate the role.
        if (existing.role !== "super_admin") {
          await db
            .update(usersTable)
            .set({ role: "super_admin" })
            .where(eq(usersTable.id, existing.id));
          console.log(`[Bootstrap] Promoted existing account id=${existing.id} to super_admin.`);
        }
        continue;
      }

      // No account yet (e.g. Sandy) — create one as super_admin with a random
      // password the founder never sees, then email a password-setup link so
      // they can choose their own. Email is fired-and-forgotten and only ever
      // happens on this initial creation, so deploys never re-spam.
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const passwordHash = await bcrypt.hash(randomPassword, 12);
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      const resetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      const [created] = await db
        .insert(usersTable)
        .values({
          name: founder.name,
          email,
          passwordHash,
          role: "super_admin",
          emailVerified: true,
          onboardingComplete: true,
          resetToken: resetTokenHash,
          resetTokenExpires: resetExpires,
        })
        .returning({ id: usersTable.id });

      console.log(`[Bootstrap] Created founding super_admin id=${created.id} (sending password-setup email).`);

      void CommunicationService.sendEmailNow({
        templateSlug: "password_reset",
        to: email,
        variables: { member_name: founder.name, reset_token: resetToken },
        userId: created.id,
      }).catch((err) =>
        console.error("[Bootstrap] Failed to send founding super_admin password-setup email:", err),
      );
    } catch (err) {
      console.error(`[Bootstrap] Failed to ensure founding super_admin (${founder.name}):`, err);
      failures.push(founder.name);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Failed to ensure founding super_admin(s): ${failures.join(", ")}`);
  }
}
