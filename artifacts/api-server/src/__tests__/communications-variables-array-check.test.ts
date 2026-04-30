import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { db, pool, emailTemplatesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Database-level guard for the three `variables` JSONB columns in the
// communications schema (`email_templates`, `email_template_versions`,
// `sms_templates`). Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0029_communications_variables_array_check.sql` adds three CHECK
// constraints (one per table) so Postgres rejects any INSERT/UPDATE that
// lands a non-array, non-NULL JSONB value. All three columns feed the
// template-render pipeline's array iteration; a JSONB string scalar (the
// regression shape from #329) would silently break the renderer's
// placeholder substitution and would silently drop every variable from
// the admin UI's chip list.
//
// All three columns are nullable, so the constraints also have to
// accept NULL.
const TEST_PREFIX = "__variables_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

// `email_template_versions` requires a real `template_id` (FK with
// ON DELETE CASCADE), so we seed a parent template up front and tear it
// down at the end. Cascading delete also cleans up any test versions left
// behind by a failing run.
let testTemplateId = 0;

beforeAll(async () => {
  const [tpl] = await db
    .insert(emailTemplatesTable)
    .values({
      slug: `${TEST_PREFIX}parent_${Date.now()}`,
      name: "variables-array-check parent",
      subject: "fixture",
      htmlBody: "fixture",
      textBody: "fixture",
    })
    .returning({ id: emailTemplatesTable.id });
  testTemplateId = tpl.id;
});

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM email_templates WHERE slug LIKE ${TEST_PREFIX + "%"} AND id <> ${testTemplateId}`,
  );
  await db.execute(
    sql`DELETE FROM email_template_versions WHERE template_id = ${testTemplateId}`,
  );
  await db.execute(
    sql`DELETE FROM sms_templates WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
});

afterAll(async () => {
  if (testTemplateId) {
    // ON DELETE CASCADE on email_template_versions.template_id cleans up
    // any leftover version rows automatically.
    await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, testTemplateId));
  }
});

const CATALOG_ROWS = [
  {
    table: "email_templates" as const,
    constraint: "email_templates_variables_is_array",
    migration: "0029_communications_variables_array_check.sql",
  },
  {
    table: "email_template_versions" as const,
    constraint: "email_template_versions_variables_is_array",
    migration: "0029_communications_variables_array_check.sql",
  },
  {
    table: "sms_templates" as const,
    constraint: "sms_templates_variables_is_array",
    migration: "0029_communications_variables_array_check.sql",
  },
];

describe("communications.variables CHECK constraints (catalog)", () => {
  for (const { table, constraint, migration } of CATALOG_ROWS) {
    it(`the ${constraint} CHECK constraint exists on ${table}`, async () => {
      const result = await db.execute<{ conname: string; definition: string }>(sql.raw(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.${table}'::regclass
          AND conname = '${constraint}'
      `));
      expect(
        result.rows.length,
        `${constraint} CHECK constraint missing on ${table}. Apply lib/db/drizzle/${migration} against this database.`,
      ).toBe(1);
      expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
      expect(result.rows[0]?.definition).toMatch(/'array'/i);
      // All three columns are nullable, so the constraint must also accept NULL.
      expect(result.rows[0]?.definition.toLowerCase()).toMatch(/is null/);
    });
  }
});

describe("email_templates.variables CHECK constraint", () => {
  async function badInsert(slug: string, variablesLiteral: string): Promise<unknown> {
    try {
      await pool.query(
        `INSERT INTO email_templates (slug, name, subject, html_body, text_body, variables)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [slug, "test", "subj", "<p>x</p>", "x", variablesLiteral],
      );
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose variables is a JSONB string scalar (the original bug shape)", async () => {
    const slug = `${TEST_PREFIX}email_string_${Date.now()}`;
    const caught = await badInsert(slug, JSON.stringify(JSON.stringify(["first_name"])));
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("email_templates_variables_is_array");
  });

  it("rejects an INSERT whose variables is a JSONB object", async () => {
    const slug = `${TEST_PREFIX}email_obj_${Date.now()}`;
    const caught = await badInsert(slug, JSON.stringify({ foo: "bar" }));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("email_templates_variables_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const slug = `${TEST_PREFIX}email_happy_${Date.now()}`;
    const caught = await badInsert(slug, JSON.stringify(["first_name", "last_name"]));
    expect(caught).toBeNull();
  });

  it("accepts an INSERT with NULL variables (column is nullable)", async () => {
    const slug = `${TEST_PREFIX}email_null_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO email_templates (slug, name, subject, html_body, text_body, variables)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [slug, "test", "subj", "<p>x</p>", "x"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeNull();
  });
});

describe("email_template_versions.variables CHECK constraint", () => {
  async function badInsert(version: number, variablesLiteral: string): Promise<unknown> {
    try {
      await pool.query(
        `INSERT INTO email_template_versions
           (template_id, version, slug, name, subject, html_body, text_body, category, variables)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          testTemplateId,
          version,
          `${TEST_PREFIX}ver_${version}_${Date.now()}`,
          "ver",
          "subj",
          "<p>x</p>",
          "x",
          "transactional",
          variablesLiteral,
        ],
      );
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose variables is a JSONB string scalar", async () => {
    const caught = await badInsert(101, JSON.stringify(JSON.stringify(["first_name"])));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("email_template_versions_variables_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const caught = await badInsert(102, JSON.stringify(["first_name"]));
    expect(caught).toBeNull();
  });
});

describe("sms_templates.variables CHECK constraint", () => {
  async function badInsert(slug: string, variablesLiteral: string): Promise<unknown> {
    try {
      await pool.query(
        `INSERT INTO sms_templates (slug, name, body, variables)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [slug, "test", "hello {{first_name}}", variablesLiteral],
      );
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose variables is a JSONB string scalar", async () => {
    const slug = `${TEST_PREFIX}sms_string_${Date.now()}`;
    const caught = await badInsert(slug, JSON.stringify(JSON.stringify(["first_name"])));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("sms_templates_variables_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const slug = `${TEST_PREFIX}sms_update_${Date.now()}`;
    await pool.query(
      `INSERT INTO sms_templates (slug, name, body, variables)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [slug, "test", "hi", JSON.stringify(["first_name"])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE sms_templates SET variables = $1::jsonb WHERE slug = $2`,
        [JSON.stringify(JSON.stringify(["first_name"])), slug],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("sms_templates_variables_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const slug = `${TEST_PREFIX}sms_happy_${Date.now()}`;
    const caught = await badInsert(slug, JSON.stringify(["first_name"]));
    expect(caught).toBeNull();
  });

  it("accepts an INSERT with NULL variables (column is nullable)", async () => {
    const slug = `${TEST_PREFIX}sms_null_${Date.now()}`;
    let caught: unknown = null;
    try {
      await pool.query(
        `INSERT INTO sms_templates (slug, name, body, variables)
         VALUES ($1, $2, $3, NULL)`,
        [slug, "test", "hi"],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeNull();
  });
});
