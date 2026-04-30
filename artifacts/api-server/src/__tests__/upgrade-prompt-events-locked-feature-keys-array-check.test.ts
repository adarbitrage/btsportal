import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Database-level guard for the upgrade_prompt_events.locked_feature_keys
// storage-shape bug. Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0026_upgrade_prompt_events_locked_feature_keys_array_check.sql` adds the
// CHECK constraint `upgrade_prompt_events_locked_feature_keys_is_array` so
// Postgres rejects any INSERT/UPDATE that lands a non-array JSONB value.
// The upgrade-prompt analytics buckets events by feature key with
// `jsonb_array_elements_text` / `?` — a JSONB string scalar (the regression
// shape from #329) would silently report zero matches in every dashboard.
const TEST_VARIANT_PREFIX = "__locked_keys_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM upgrade_prompt_events WHERE variant LIKE ${TEST_VARIANT_PREFIX + "%"}`,
  );
});

describe("upgrade_prompt_events.locked_feature_keys CHECK constraint", () => {
  it("the upgrade_prompt_events_locked_feature_keys_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.upgrade_prompt_events'::regclass
        AND conname = 'upgrade_prompt_events_locked_feature_keys_is_array'
    `);
    expect(
      result.rows.length,
      "upgrade_prompt_events_locked_feature_keys_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0026_upgrade_prompt_events_locked_feature_keys_array_check.sql " +
        "against this database.",
    ).toBe(1);
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
  });

  it("rejects an INSERT whose locked_feature_keys is a JSONB string scalar (the original bug shape)", async () => {
    const variant = `${TEST_VARIANT_PREFIX}string_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
         VALUES ($1, $2, $3, $4::jsonb)`,
        ["impression", variant, "frontend", JSON.stringify(JSON.stringify(["coaching:1on1"]))],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("upgrade_prompt_events_locked_feature_keys_is_array");
  });

  it("rejects an INSERT whose locked_feature_keys is a JSONB number scalar", async () => {
    const variant = `${TEST_VARIANT_PREFIX}num_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
         VALUES ($1, $2, $3, $4::jsonb)`,
        ["impression", variant, "frontend", "42"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("upgrade_prompt_events_locked_feature_keys_is_array");
  });

  it("rejects an INSERT whose locked_feature_keys is a JSONB object", async () => {
    const variant = `${TEST_VARIANT_PREFIX}obj_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
         VALUES ($1, $2, $3, $4::jsonb)`,
        ["impression", variant, "frontend", JSON.stringify({ foo: "bar" })],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("upgrade_prompt_events_locked_feature_keys_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const variant = `${TEST_VARIANT_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ["impression", variant, "frontend", JSON.stringify(["coaching:1on1"])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE upgrade_prompt_events SET locked_feature_keys = $1::jsonb WHERE variant = $2`,
        [JSON.stringify(JSON.stringify(["coaching:1on1"])), variant],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("upgrade_prompt_events_locked_feature_keys_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const variant = `${TEST_VARIANT_PREFIX}happy_${Date.now()}`;
    await pool.query(
      `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ["impression", variant, "frontend", JSON.stringify(["coaching:1on1", "vault:advanced"])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(locked_feature_keys) AS jt FROM upgrade_prompt_events WHERE variant = $1`,
      [variant],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const variant = `${TEST_VARIANT_PREFIX}empty_${Date.now()}`;
    await pool.query(
      `INSERT INTO upgrade_prompt_events (event_type, variant, source_tier, locked_feature_keys)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ["impression", variant, "frontend", JSON.stringify([])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(locked_feature_keys) AS jt FROM upgrade_prompt_events WHERE variant = $1`,
      [variant],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });
});
