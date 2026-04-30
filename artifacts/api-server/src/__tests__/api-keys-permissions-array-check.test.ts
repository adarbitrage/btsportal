import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { db, pool, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Database-level guard for the api_keys.permissions storage-shape bug.
// Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0024_api_keys_permissions_array_check.sql` adds the CHECK constraint
// `api_keys_permissions_is_array` so Postgres rejects any INSERT/UPDATE
// that lands a non-array JSONB value. `permissions` is the auth-scope list
// for each API key — a JSONB string scalar (the regression shape from #329)
// would silently grant zero permissions on any code path that uses raw
// JSONB array operators (`@>`, `?`, `jsonb_array_elements_text`), and
// would leak through Drizzle's silent string-to-array reader as a still-
// "working" but wrong-shape row.
const TEST_PREFIX = "__permissions_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

// `api_keys.created_by_id` is a NOT NULL FK to `users.id`, so the test
// suite needs a real user to point at. Create one in beforeAll so the
// suite is self-contained (does not depend on seed data being present).
let testUserId = 0;

beforeAll(async () => {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_PREFIX}-${Date.now()}@example.test`,
      name: "permissions-array-check fixture user",
      passwordHash: "irrelevant",
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  testUserId = u.id;
});

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM api_keys WHERE name LIKE ${TEST_PREFIX + "%"}`,
  );
});

afterAll(async () => {
  if (testUserId) {
    await db.delete(usersTable).where(eq(usersTable.id, testUserId));
  }
});

describe("api_keys.permissions CHECK constraint", () => {
  it("the api_keys_permissions_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.api_keys'::regclass
        AND conname = 'api_keys_permissions_is_array'
    `);
    expect(
      result.rows.length,
      "api_keys_permissions_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0024_api_keys_permissions_array_check.sql " +
        "against this database.",
    ).toBe(1);
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
  });

  async function badInsert(name: string, permissionsJsonbLiteral: string): Promise<unknown> {
    try {
      await pool.query(
        `INSERT INTO api_keys (name, prefix, key_hash, permissions, created_by_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [name, `${name}_pfx`, "hash", permissionsJsonbLiteral, testUserId],
      );
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose permissions is a JSONB string scalar (the original bug shape)", async () => {
    const caught = await badInsert(
      `${TEST_PREFIX}string_${Date.now()}`,
      JSON.stringify(JSON.stringify(["leads:read"])),
    );
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("api_keys_permissions_is_array");
  });

  it("rejects an INSERT whose permissions is a JSONB number scalar", async () => {
    const caught = await badInsert(`${TEST_PREFIX}num_${Date.now()}`, "42");
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("api_keys_permissions_is_array");
  });

  it("rejects an INSERT whose permissions is a JSONB object", async () => {
    const caught = await badInsert(
      `${TEST_PREFIX}obj_${Date.now()}`,
      JSON.stringify({ foo: "bar" }),
    );
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("api_keys_permissions_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const name = `${TEST_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO api_keys (name, prefix, key_hash, permissions, created_by_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [name, `${name}_pfx`, "hash", JSON.stringify(["leads:read"]), testUserId],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE api_keys SET permissions = $1::jsonb WHERE name = $2`,
        [JSON.stringify(JSON.stringify(["leads:read"])), name],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("api_keys_permissions_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const name = `${TEST_PREFIX}happy_${Date.now()}`;
    await pool.query(
      `INSERT INTO api_keys (name, prefix, key_hash, permissions, created_by_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [name, `${name}_pfx`, "hash", JSON.stringify(["leads:read", "leads:write"]), testUserId],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(permissions) AS jt FROM api_keys WHERE name = $1`,
      [name],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const name = `${TEST_PREFIX}empty_${Date.now()}`;
    await pool.query(
      `INSERT INTO api_keys (name, prefix, key_hash, permissions, created_by_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [name, `${name}_pfx`, "hash", JSON.stringify([]), testUserId],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(permissions) AS jt FROM api_keys WHERE name = $1`,
      [name],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });
});
