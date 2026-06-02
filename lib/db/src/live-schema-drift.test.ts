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
  /** Canonical Postgres type token (matches information_schema `udt_name`). */
  type: string;
  notNull: boolean;
}

// Drizzle's `getSQLType()` emits the DDL spelling of a type
// (e.g. "timestamp with time zone", "varchar(64)", "serial", "text[]").
// Postgres' `information_schema.columns.udt_name` reports the internal
// type name instead ("timestamptz", "varchar", "int4", "_text"). To
// compare the two we fold both onto the same canonical token — the
// `udt_name` spelling — so an honest match doesn't look like drift.
const DRIZZLE_TYPE_ALIASES: Record<string, string> = {
  boolean: "bool",
  bool: "bool",
  smallint: "int2",
  int2: "int2",
  integer: "int4",
  int: "int4",
  int4: "int4",
  bigint: "int8",
  int8: "int8",
  smallserial: "int2",
  serial: "int4",
  bigserial: "int8",
  real: "float4",
  float4: "float4",
  "double precision": "float8",
  float8: "float8",
  numeric: "numeric",
  decimal: "numeric",
  "timestamp with time zone": "timestamptz",
  timestamptz: "timestamptz",
  "timestamp without time zone": "timestamp",
  timestamp: "timestamp",
  "time with time zone": "timetz",
  "time without time zone": "time",
  time: "time",
  date: "date",
  "character varying": "varchar",
  varchar: "varchar",
  character: "bpchar",
  char: "bpchar",
  bpchar: "bpchar",
  text: "text",
  json: "json",
  jsonb: "jsonb",
  uuid: "uuid",
};

function normalizeDrizzleType(sqlType: string): string {
  const lower = sqlType.toLowerCase().trim();
  const isArray = lower.endsWith("[]");
  let base = isArray ? lower.slice(0, -2).trim() : lower;
  // Drop precision / length args: "numeric(10, 2)" -> "numeric", "varchar(64)" -> "varchar".
  base = base.replace(/\(.*\)$/, "").trim();
  const mapped = DRIZZLE_TYPE_ALIASES[base] ?? base;
  // Postgres prefixes array element types with an underscore in `udt_name`.
  return isArray ? `_${mapped}` : mapped;
}

interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

function collectSchemaTables(): SchemaTable[] {
  const out: SchemaTable[] = [];
  for (const exported of Object.values(schema as Record<string, unknown>)) {
    if (!exported || !is(exported as object, PgTable)) continue;
    const table = exported as PgTable;
    const tableName = getTableName(table);
    const cols = getTableColumns(table);
    const columns: SchemaColumn[] = [];
    for (const col of Object.values(cols)) {
      const c = col as { name: string; notNull: boolean; getSQLType: () => string };
      columns.push({
        table: tableName,
        column: c.name,
        type: normalizeDrizzleType(c.getSQLType()),
        notNull: Boolean(c.notNull),
      });
    }
    out.push({ name: tableName, columns });
  }
  return out;
}

interface LiveColumn {
  type: string;
  notNull: boolean;
}

interface LiveSchema {
  tables: Set<string>;
  /** keyed by `${table}.${column}` */
  columns: Map<string, LiveColumn>;
}

async function fetchLiveSchema(url: string): Promise<LiveSchema> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'`,
    );
    const colsRes = await client.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, udt_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    const columns = new Map<string, LiveColumn>();
    for (const r of colsRes.rows) {
      columns.set(`${r.table_name}.${r.column_name}`, {
        type: r.udt_name,
        notNull: r.is_nullable === "NO",
      });
    }
    return {
      tables: new Set(tablesRes.rows.map((r) => r.table_name)),
      columns,
    };
  } finally {
    await client.end();
  }
}

describe.skipIf(skipReason !== null)("live database schema drift", () => {
  test("the live database matches every table/column declared in lib/db/src/schema/", async () => {
    const schemaTables = collectSchemaTables();
    const schemaCols = schemaTables.flatMap((t) => t.columns);
    expect(schemaCols.length, "expected to introspect at least one schema column").toBeGreaterThan(0);

    const live = await fetchLiveSchema(DATABASE_URL!);

    // 1) Whole tables that exist in the schema but are missing live
    //    (covers tables that were renamed or dropped out from under the
    //    code). Reported separately so we don't drown the message in one
    //    "missing column" line per column of the absent table.
    const missingTables = schemaTables
      .filter((t) => !live.tables.has(t.name))
      .map((t) => t.name)
      .sort();

    expect(
      missingTables,
      "The following tables are declared in `lib/db/src/schema/*.ts` but\n" +
        "do NOT exist in the live database (DATABASE_URL):\n\n" +
        missingTables.map((m) => `  - ${m}`).join("\n") +
        "\n\n" +
        "A table was added to the schema (or renamed/dropped in the live\n" +
        "database) without syncing. Run\n" +
        "  `pnpm --filter @workspace/db push`\n" +
        "to sync the database, or revert the schema change.",
    ).toEqual([]);

    // 2) Individual columns missing from a table that DOES exist. This is
    //    the original task #561 failure mode (column added to schema but
    //    `drizzle-kit push` never run).
    const missingColumns = schemaCols
      .filter(({ table }) => live.tables.has(table))
      .filter(({ table, column }) => !live.columns.has(`${table}.${column}`))
      .map(({ table, column }) => `${table}.${column}`)
      .sort();

    expect(
      missingColumns,
      "The following columns are declared in `lib/db/src/schema/*.ts` but\n" +
        "are MISSING from the live database (DATABASE_URL):\n\n" +
        missingColumns.map((m) => `  - ${m}`).join("\n") +
        "\n\n" +
        "This is the exact failure mode from task #561: a column was added\n" +
        "to the schema file but the dev database was never synced, so the\n" +
        "live database fell behind the code. Run\n" +
        "  `pnpm --filter @workspace/db sync-dev`\n" +
        "to apply the companion migrations and push the schema\n" +
        "non-interactively (plain `drizzle-kit push` can hang on a rename\n" +
        "prompt on a non-TTY shell), or revert the schema change.",
    ).toEqual([]);

    // 3) Columns that EXIST but whose data type or nullability has drifted
    //    from the schema definition. These pass a mere "does the column
    //    exist?" check while still breaking the app at runtime.
    const typeMismatches: string[] = [];
    const nullabilityMismatches: string[] = [];
    for (const sc of schemaCols) {
      const liveCol = live.columns.get(`${sc.table}.${sc.column}`);
      if (!liveCol) continue; // already reported as missing above
      if (liveCol.type !== sc.type) {
        typeMismatches.push(
          `${sc.table}.${sc.column}: schema=${sc.type} live=${liveCol.type}`,
        );
      }
      if (liveCol.notNull !== sc.notNull) {
        nullabilityMismatches.push(
          `${sc.table}.${sc.column}: schema=${sc.notNull ? "NOT NULL" : "NULL"} ` +
            `live=${liveCol.notNull ? "NOT NULL" : "NULL"}`,
        );
      }
    }
    typeMismatches.sort();
    nullabilityMismatches.sort();

    expect(
      typeMismatches,
      "The following columns exist but their DATA TYPE has drifted from\n" +
        "`lib/db/src/schema/*.ts`:\n\n" +
        typeMismatches.map((m) => `  - ${m}`).join("\n") +
        "\n\n" +
        "A type was changed in the schema file (or altered in the live\n" +
        "database) without the other side following. A column that exists\n" +
        "with the wrong type passes a mere existence check yet still breaks\n" +
        "the app at runtime. Run\n" +
        "  `pnpm --filter @workspace/db push`\n" +
        "to sync the database, or revert the schema change.",
    ).toEqual([]);

    expect(
      nullabilityMismatches,
      "The following columns exist but their NULLABILITY has drifted from\n" +
        "`lib/db/src/schema/*.ts`:\n\n" +
        nullabilityMismatches.map((m) => `  - ${m}`).join("\n") +
        "\n\n" +
        "A `.notNull()` was added/removed in the schema file (or the live\n" +
        "column's NOT NULL constraint changed) without the other side\n" +
        "following. Run\n" +
        "  `pnpm --filter @workspace/db push`\n" +
        "to sync the database, or revert the schema change.",
    ).toEqual([]);
  }, 30_000);
});
