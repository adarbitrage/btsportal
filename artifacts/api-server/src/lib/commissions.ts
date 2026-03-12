import { db, affiliateProfilesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserEntitlements } from "./entitlements";
import crypto from "crypto";

const COMMISSION_TIERS = ["commissions:top", "commissions:premium", "commissions:mid", "commissions:entry"] as const;

export type CommissionTier = "top" | "premium" | "mid" | "entry";

export function resolveCommissionTier(entitlements: Set<string>): CommissionTier | null {
  for (const key of COMMISSION_TIERS) {
    if (entitlements.has(key)) {
      return key.split(":")[1] as CommissionTier;
    }
  }
  return null;
}

export async function resolveUserCommissionTier(userId: number): Promise<CommissionTier | null> {
  const entitlements = await getUserEntitlements(userId);
  return resolveCommissionTier(entitlements);
}

export function hasCommissionEntitlement(entitlements: Set<string>): boolean {
  return COMMISSION_TIERS.some(key => entitlements.has(key));
}

function generateAffiliateCode(name: string): string {
  const clean = name.replace(/[^a-zA-Z]/g, "").toLowerCase().slice(0, 8);
  const suffix = crypto.randomBytes(3).toString("hex").slice(0, 4);
  return `${clean || "aff"}${suffix}`;
}

export async function ensureAffiliateProfile(userId: number): Promise<{ id: number; affiliateCode: string; tier: string } | null> {
  const existing = await db
    .select({ id: affiliateProfilesTable.id, affiliateCode: affiliateProfilesTable.affiliateCode, tier: affiliateProfilesTable.tier })
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const entitlements = await getUserEntitlements(userId);
  const tier = resolveCommissionTier(entitlements);
  if (!tier) return null;

  const [user] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return null;

  const affiliateCode = generateAffiliateCode(user.name);

  const [profile] = await db.insert(affiliateProfilesTable).values({
    userId,
    affiliateCode,
    tier,
  }).returning();

  return { id: profile.id, affiliateCode: profile.affiliateCode, tier: profile.tier };
}

export async function updateAffiliateTier(userId: number): Promise<void> {
  const entitlements = await getUserEntitlements(userId);
  const tier = resolveCommissionTier(entitlements);
  if (!tier) return;

  await db.update(affiliateProfilesTable)
    .set({ tier })
    .where(eq(affiliateProfilesTable.userId, userId));
}
