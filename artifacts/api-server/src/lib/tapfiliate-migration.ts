import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runTapfiliateColumnMigration(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tapfiliate_affiliate_id text`,
  );
  await db.execute(
    sql`ALTER TABLE media_mavens_products ADD COLUMN IF NOT EXISTS tapfiliate_program_id text`,
  );
  await db.execute(
    sql`ALTER TABLE media_mavens_products ADD COLUMN IF NOT EXISTS tapfiliate_program_title text`,
  );
}
