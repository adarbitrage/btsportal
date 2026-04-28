import { db, memberAppInstancesTable, type MemberAppInstance } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Read the single `member_app_instances` row for a given (user, app) pair.
 *
 * `member_app_instances` has a UNIQUE (user_id, app_name) constraint, so this
 * query should return at most one row. Historically, callers used
 * `.limit(1)` (or destructured `const [row] = ...`) which silently returned
 * an arbitrary row when duplicates existed and made data-integrity bugs
 * impossible to notice. We deliberately fetch all matches and throw if
 * more than one is found, so duplicates surface loudly instead of corrupting
 * downstream behavior (e.g. the admin Flexy lookup reporting the wrong
 * staff user).
 *
 * Returns `null` when the member has never installed the app.
 */
export async function findMemberAppInstance(
  userId: number,
  appName: string,
): Promise<MemberAppInstance | null> {
  const rows = await db
    .select()
    .from(memberAppInstancesTable)
    .where(
      and(
        eq(memberAppInstancesTable.userId, userId),
        eq(memberAppInstancesTable.appName, appName),
      ),
    );

  if (rows.length > 1) {
    throw new Error(
      `member_app_instances has ${rows.length} rows for user_id=${userId} app_name=${appName}; ` +
        `expected at most 1 (unique constraint violation in data)`,
    );
  }

  return rows[0] ?? null;
}
