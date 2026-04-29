import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Database-level guard for the products.entitlement_keys storage-shape bug.
//
// `0022_products_entitlement_keys_array_check.sql` adds a CHECK constraint
// (`products_entitlement_keys_is_array`) so that Postgres rejects any
// INSERT/UPDATE that tries to write a non-array JSONB value into
// `products.entitlement_keys`. The runtime test in
// `products-entitlement-keys-shape.test.ts` only catches the bad shape on
// the read side, after-the-fact, against the dev DB; the constraint catches
// it on the offending write in every environment, including production.
//
// These tests pin both halves of "the constraint is real":
//   1. It exists in pg_catalog with the expected definition.
//   2. Postgres rejects bad INSERT/UPDATE attempts with a check_violation
//      (SQLSTATE 23514) and a `conname` that points back at this guard.
//
// The slug used by the bad-write tests is unique per row, and every bad
// write rolls back at the constraint check, so no test row can leak into
// the products table. The afterEach cleanup is a defensive belt-and-braces
// for the case where a future regression *removed* the constraint and let
// the row through.
const TEST_SLUG_PREFIX = "__entitlement_keys_check_test__";

// `pg` throws plain `Error` instances at the type level, but the runtime
// objects always carry `code` (the SQLSTATE) and, for constraint violations,
// `constraint` (the conname that fired). Narrow to this shape from `unknown`
// so the assertions below don't have to reach into `any`.
type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM products WHERE slug LIKE ${TEST_SLUG_PREFIX + "%"}`,
  );
});

describe("products.entitlement_keys CHECK constraint", () => {
  it("the products_entitlement_keys_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{
      conname: string;
      definition: string;
    }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.products'::regclass
        AND conname = 'products_entitlement_keys_is_array'
    `);

    expect(
      result.rows.length,
      "products_entitlement_keys_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0022_products_entitlement_keys_array_check.sql " +
        "against this database.",
    ).toBe(1);
    // pg_get_constraintdef normalizes whitespace and casts; the canonical
    // form is `CHECK ((jsonb_typeof(entitlement_keys) = 'array'::text))`.
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
  });

  it("rejects an INSERT whose entitlement_keys is a JSONB string scalar (the original bug shape)", async () => {
    // Build a value that exactly reproduces the original bug: a JSONB
    // string scalar containing a JSON-encoded array. Using the pg pool
    // directly so we observe the raw Postgres error code (Drizzle would
    // wrap the rejection in a generic Error and lose the SQLSTATE).
    const slug = `${TEST_SLUG_PREFIX}string_scalar_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [slug, "test", "frontend", JSON.stringify(JSON.stringify(["x"]))],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    // 23514 = check_violation per the Postgres error-codes table.
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("products_entitlement_keys_is_array");
  });

  it("rejects an INSERT whose entitlement_keys is a JSONB number scalar", async () => {
    const slug = `${TEST_SLUG_PREFIX}number_scalar_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [slug, "test", "frontend", "42"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("products_entitlement_keys_is_array");
  });

  it("rejects an INSERT whose entitlement_keys is a JSONB object", async () => {
    const slug = `${TEST_SLUG_PREFIX}object_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [slug, "test", "frontend", JSON.stringify({ foo: "bar" })],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("products_entitlement_keys_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    // First insert a valid row.
    const slug = `${TEST_SLUG_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, 0)`,
      [slug, "test", "frontend", JSON.stringify(["content:frontend"])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE products SET entitlement_keys = $1::jsonb WHERE slug = $2`,
        [JSON.stringify(JSON.stringify(["content:frontend"])), slug],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("products_entitlement_keys_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check the constraint isn't over-zealous)", async () => {
    const slug = `${TEST_SLUG_PREFIX}happy_path_${Date.now()}`;
    await pool.query(
      `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, 0)`,
      [slug, "test", "frontend", JSON.stringify(["content:frontend", "support:basic"])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(entitlement_keys) AS jt FROM products WHERE slug = $1`,
      [slug],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const slug = `${TEST_SLUG_PREFIX}empty_array_${Date.now()}`;
    await pool.query(
      `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, 0)`,
      [slug, "test", "frontend", JSON.stringify([])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(entitlement_keys) AS jt FROM products WHERE slug = $1`,
      [slug],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });
});
