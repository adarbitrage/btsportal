import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// Database-level guard for the webhook_subscriptions.event_types
// storage-shape bug. Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0025_webhook_subscriptions_event_types_array_check.sql` adds a CHECK
// constraint (`webhook_subscriptions_event_types_is_array`) so Postgres
// rejects any INSERT/UPDATE that tries to land a non-array JSONB value.
// `event_types` drives webhook fan-out — a JSONB string scalar (the
// regression shape from #329) would silently match nothing in the
// dispatcher's `@>` / `?` checks, dropping every event on the floor with
// no error surface.
//
// These tests pin both halves of "the constraint is real":
//   1. It exists in pg_catalog with the expected definition.
//   2. Postgres rejects bad INSERT/UPDATE attempts with a check_violation
//      (SQLSTATE 23514) and the expected `conname`.
const TEST_NAME_PREFIX = "__event_types_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM webhook_subscriptions WHERE name LIKE ${TEST_NAME_PREFIX + "%"}`,
  );
});

describe("webhook_subscriptions.event_types CHECK constraint", () => {
  it("the webhook_subscriptions_event_types_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.webhook_subscriptions'::regclass
        AND conname = 'webhook_subscriptions_event_types_is_array'
    `);
    expect(
      result.rows.length,
      "webhook_subscriptions_event_types_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0025_webhook_subscriptions_event_types_array_check.sql " +
        "against this database.",
    ).toBe(1);
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
  });

  it("rejects an INSERT whose event_types is a JSONB string scalar (the original bug shape)", async () => {
    const name = `${TEST_NAME_PREFIX}string_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [name, "https://example.test/hook", "secret", JSON.stringify(JSON.stringify(["sale.created"]))],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("webhook_subscriptions_event_types_is_array");
  });

  it("rejects an INSERT whose event_types is a JSONB number scalar", async () => {
    const name = `${TEST_NAME_PREFIX}num_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [name, "https://example.test/hook", "secret", "42"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("webhook_subscriptions_event_types_is_array");
  });

  it("rejects an INSERT whose event_types is a JSONB object", async () => {
    const name = `${TEST_NAME_PREFIX}obj_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [name, "https://example.test/hook", "secret", JSON.stringify({ foo: "bar" })],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("webhook_subscriptions_event_types_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const name = `${TEST_NAME_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [name, "https://example.test/hook", "secret", JSON.stringify(["sale.created"])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE webhook_subscriptions SET event_types = $1::jsonb WHERE name = $2`,
        [JSON.stringify(JSON.stringify(["sale.created"])), name],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("webhook_subscriptions_event_types_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const name = `${TEST_NAME_PREFIX}happy_${Date.now()}`;
    await pool.query(
      `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [name, "https://example.test/hook", "secret", JSON.stringify(["sale.created", "refund.issued"])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(event_types) AS jt FROM webhook_subscriptions WHERE name = $1`,
      [name],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const name = `${TEST_NAME_PREFIX}empty_${Date.now()}`;
    await pool.query(
      `INSERT INTO webhook_subscriptions (name, target_url, secret, event_types)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [name, "https://example.test/hook", "secret", JSON.stringify([])],
    );
    const result = await pool.query(
      `SELECT jsonb_typeof(event_types) AS jt FROM webhook_subscriptions WHERE name = $1`,
      [name],
    );
    expect(result.rows[0]?.jt).toBe("array");
  });
});
