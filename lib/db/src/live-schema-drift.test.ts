import { describe, expect, test } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const skipReason = DATABASE_URL ? null : "DATABASE_URL is not set; skipping live-schema drift check";

interface SchemaColumn {
  table: string;
  column: string;
}

function collectSchemaColumns(): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  for (const exported of Object.values(schema as Record<string, unknown>)) {
    if (!exported || !is(exported as object, PgTable)) continue;
    const table = exported as PgTable;
    const tableName = getTableName(table);
    const cols = getTableColumns(table);
    for (const col of Object.values(cols)) {
      out.push({ table: tableName, column: (col as { name: string }).name });
    }
  }
  return out;
}

interface LiveColumn {
  table: string;
  column: string;
}

async function fetchLiveColumns(url: string): Promise<Set<string>> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<LiveColumn>(
      `SELECT table_name AS table, column_name AS column
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    return new Set(res.rows.map((r) => `${r.table}.${r.column}`));
  } finally {
    await client.end();
  }
}

describe.skipIf(skipReason !== null)("live database schema drift", () => {
  test("every column declared in lib/db/src/schema/ exists in the live database", async () => {
    const schemaCols = collectSchemaColumns();
    expect(schemaCols.length, "expected to introspect at least one schema column").toBeGreaterThan(0);

    const live = await fetchLiveColumns(DATABASE_URL!);

    const missing = schemaCols
      .filter(({ table, column }) => !live.has(`${table}.${column}`))
      .map(({ table, column }) => `${table}.${column}`)
      .sort();

    expect(
      missing,
      "The following columns are declared in `lib/db/src/schema/*.ts` but\n" +
        "are MISSING from the live database (DATABASE_URL):\n\n" +
        missing.map((m) => `  - ${m}`).join("\n") +
        "\n\n" +
        "This is the exact failure mode from task #561: a column was added\n" +
        "to the schema file but the dev database was never synced, so the\n" +
        "live database fell behind the code. Run\n" +
        "  `pnpm --filter @workspace/db sync-dev`\n" +
        "to apply the companion migrations and push the schema\n" +
        "non-interactively (plain `drizzle-kit push` can hang on a rename\n" +
        "prompt on a non-TTY shell), or revert the schema change.",
    ).toEqual([]);
  }, 30_000);
});
