import { describe, it, expect } from "vitest";
import { db, productsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

// Regression guard for the products.entitlement_keys storage-shape bug:
//
// The original product seed passed `JSON.stringify([...])` for the
// `entitlement_keys` JSONB column. Drizzle's jsonb mapper then ran
// JSON.stringify on the already-serialized string a second time, so every row
// landed in Postgres as a JSONB string scalar (e.g.
// `"[\"content:frontend\", ...]"`) instead of a JSONB array. Drizzle's reader
// silently parses the string back into an array on the way out, so the
// application kept working — but any direct pg client query, raw SQL JSONB
// operator (`jsonb_array_elements_text`, `?`, `@>`), or future ORM swap saw
// a string and silently granted zero entitlements.
//
// The seed has been corrected to insert real arrays, and migration
// 0021_normalize_products_entitlement_keys.sql repairs already-affected rows.
// This test pins both shapes so a future regression on either side
// (a stray JSON.stringify in the seed, an unrepaired environment, or an
// inserter that reintroduces the double-encoding) fails loudly.
describe("products.entitlement_keys storage shape", () => {
  it("every row is decoded into a real JS array by Drizzle", async () => {
    const rows = await db
      .select({
        id: productsTable.id,
        slug: productsTable.slug,
        entitlementKeys: productsTable.entitlementKeys,
      })
      .from(productsTable);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        Array.isArray(row.entitlementKeys),
        `products.id=${row.id} (${row.slug}) entitlement_keys decoded as ${typeof row.entitlementKeys} (${JSON.stringify(row.entitlementKeys)}); expected an array. ` +
          `This usually means the row was inserted with JSON.stringify([...]) instead of a real array, producing a JSONB string scalar.`,
      ).toBe(true);
      const keys = row.entitlementKeys as unknown[];
      for (const key of keys) {
        expect(typeof key).toBe("string");
      }
    }
  });

  it("every row is stored as a real JSONB array (not a string scalar) at the column level", async () => {
    // Use raw SQL via the same Drizzle client so we observe the on-disk JSONB
    // type rather than Drizzle's lenient mapFromDriverValue. The previous bug
    // hid behind that mapper; this assertion is what the diagnostic in the
    // task description was reading.
    const result = await db.execute<{
      id: number;
      slug: string;
      jt: string;
    }>(sql`
      SELECT id,
             slug,
             jsonb_typeof(${productsTable.entitlementKeys}) AS jt
      FROM ${productsTable}
    `);

    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(
        row.jt,
        `products.id=${row.id} (${row.slug}) jsonb_typeof(entitlement_keys)='${row.jt}'; expected 'array'. ` +
          `Run lib/db/drizzle/0021_normalize_products_entitlement_keys.sql against this database.`,
      ).toBe("array");
    }
  });

  it("raw jsonb_array_elements_text works against entitlement_keys", async () => {
    // Sanity check that the on-disk shape supports the raw JSONB array
    // operators the original bug broke. Before the fix, this query errored
    // with "cannot extract elements from a scalar".
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM ${productsTable},
           jsonb_array_elements_text(${productsTable.entitlementKeys}) AS key
    `);
    expect(Number(result.rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});
