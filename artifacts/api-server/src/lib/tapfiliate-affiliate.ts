import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  findAffiliateByEmail,
  createAffiliate,
  enrollAffiliateInProgram,
  getAffiliateReferralLinks,
  TapfiliateConfigError,
  TapfiliateApiError,
} from "./tapfiliate";
import {
  getCachedReferralUrl,
  setCachedReferralUrl,
} from "./tapfiliate-cache";

export { TapfiliateConfigError, TapfiliateApiError };

export async function resolveAffiliateId(
  userId: number,
  email: string,
  name: string,
): Promise<string> {
  const [user] = await db
    .select({ tapfiliateAffiliateId: usersTable.tapfiliateAffiliateId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (user?.tapfiliateAffiliateId) {
    return user.tapfiliateAffiliateId;
  }

  const existing = await findAffiliateByEmail(email);
  const affiliateId = existing
    ? existing.id
    : (await createAffiliate(email, name)).id;

  await db
    .update(usersTable)
    .set({ tapfiliateAffiliateId: affiliateId })
    .where(eq(usersTable.id, userId));

  return affiliateId;
}

export async function resolveReferralUrl(
  userId: number,
  email: string,
  name: string,
  programId: string,
): Promise<string | null> {
  const cached = await getCachedReferralUrl(userId, programId);
  if (cached) return cached;

  const affiliateId = await resolveAffiliateId(userId, email, name);

  await enrollAffiliateInProgram(affiliateId, programId);

  const links = await getAffiliateReferralLinks(affiliateId, programId);
  if (!links || links.length === 0) return null;

  const url = links[0].link;
  await setCachedReferralUrl(userId, programId, url);
  return url;
}
