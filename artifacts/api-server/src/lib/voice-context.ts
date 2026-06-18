import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserEntitlements, getHighestProductLabel } from "./entitlements";

export async function buildMemberVoiceContext(userId: number): Promise<Record<string, string>> {
  const [user] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const entitlements = await getUserEntitlements(userId);
  const { name: membershipLevel } = getHighestProductLabel(entitlements);

  return {
    member_name: user?.name ?? "Member",
    membership_level: membershipLevel,
  };
}
