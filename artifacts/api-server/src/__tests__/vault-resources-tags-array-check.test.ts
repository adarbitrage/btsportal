import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Database-level guard for the vault_resources.tags storage-shape bug.
// Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0027_vault_resources_tags_array_check.sql` adds the CHECK constraint
// `vault_resources_tags_is_array` so Postgres rejects any INSERT/UPDATE
// that lands a non-array, non-NULL JSONB value. The original
// `seed-vault.ts` actually hit this bug — it passed
// `tags: JSON.stringify([...])` for every row, so Drizzle's jsonb mapper
// landed JSONB string scalars and the admin tag-listing endpoint
// (`Array.isArray(r.tags)`) silently dropped every tag from those rows.
//
// `vault_resources.tags` is nullable, so the constraint also has to accept
// NULL. The "happy path" tests below cover both array and NULL.
const TEST_TITLE_PREFIX = "__vault_tags_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM vault_resources WHERE title LIKE ${TEST_TITLE_PREFIX + "%"}`,
  );
});

describe("vault_resources.tags CHECK constraint", () => {
  it("the vault_resources_tags_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.vault_resources'::regclass
        AND conname = 'vault_resources_tags_is_array'
    `);
    expect(
      result.rows.length,
      "vault_resources_tags_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0027_vault_resources_tags_array_check.sql " +
        "against this database.",
    ).toBe(1);
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
    // This column is nullable, so the constraint must also accept NULL.
    expect(result.rows[0]?.definition.toLowerCase()).toMatch(/is null/);
  });

  it("rejects an INSERT whose tags is a JSONB string scalar (the original seed bug shape)", async () => {
    const title = `${TEST_TITLE_PREFIX}string_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
        [title, JSON.stringify(JSON.stringify(["facebook", "ads"]))],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("vault_resources_tags_is_array");
  });

  it("rejects an INSERT whose tags is a JSONB number scalar", async () => {
    const title = `${TEST_TITLE_PREFIX}num_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
        [title, "42"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("vault_resources_tags_is_array");
  });

  it("rejects an INSERT whose tags is a JSONB object", async () => {
    const title = `${TEST_TITLE_PREFIX}obj_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
        [title, JSON.stringify({ foo: "bar" })],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("vault_resources_tags_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const title = `${TEST_TITLE_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
      [title, JSON.stringify(["facebook"])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE vault_resources SET tags = $1::jsonb WHERE title = $2`,
        [JSON.stringify(JSON.stringify(["facebook"])), title],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("vault_resources_tags_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const title = `${TEST_TITLE_PREFIX}happy_${Date.now()}`;
    await pool.query(
      `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
      [title, JSON.stringify(["facebook", "ads", "swipe"])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(tags) AS jt FROM vault_resources WHERE title = $1`,
      [title],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const title = `${TEST_TITLE_PREFIX}empty_${Date.now()}`;
    await pool.query(
      `INSERT INTO vault_resources (title, tags) VALUES ($1, $2::jsonb)`,
      [title, JSON.stringify([])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(tags) AS jt FROM vault_resources WHERE title = $1`,
      [title],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with NULL tags (column is nullable)", async () => {
    const title = `${TEST_TITLE_PREFIX}null_${Date.now()}`;
    await pool.query(
      `INSERT INTO vault_resources (title, tags) VALUES ($1, NULL)`,
      [title],
    );
    const result = await pool.query(
      `SELECT tags IS NULL AS is_null FROM vault_resources WHERE title = $1`,
      [title],
    );
    expect(result.rows[0]?.is_null).toBe(true);
  });
});
