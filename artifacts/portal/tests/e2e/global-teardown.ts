import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_PATH = join(__dirname, ".fixture.json");

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURE_PATH)) return;

  const url = process.env.DATABASE_URL;
  if (!url) return;

  let fixture: E2EFixture;
  try {
    fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as E2EFixture;
  } catch {
    unlinkSync(FIXTURE_PATH);
    return;
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::int[])`, [
      [fixture.adminId, fixture.memberId],
    ]);
    await client.query(`DELETE FROM member_app_instances WHERE user_id = $1`, [
      fixture.memberId,
    ]);
    await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::int[])`, [
      [fixture.adminId, fixture.memberId],
    ]);
    // Logging in seeds GHL contact-sync jobs in dev, which write ghl_sync_log
    // rows that FK-reference the fixture users. Clear them before deleting the
    // users, otherwise the delete throws a foreign-key error.
    await client.query(`DELETE FROM ghl_sync_log WHERE user_id = ANY($1::int[])`, [
      [fixture.adminId, fixture.memberId],
    ]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
      [fixture.adminId, fixture.memberId],
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Don't fail teardown — surface the error but allow the test process to exit.
    console.error("[e2e] global teardown cleanup failed:", err);
  } finally {
    client.release();
    await pool.end();
    try {
      unlinkSync(FIXTURE_PATH);
    } catch {
      /* ignore */
    }
  }
}
