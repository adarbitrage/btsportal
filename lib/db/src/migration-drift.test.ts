import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PKG_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(DB_PKG_DIR, "drizzle");

const ADMIN_URL = process.env.DATABASE_URL;

function dbUrlFor(name: string): string {
  if (!ADMIN_URL) throw new Error("DATABASE_URL is not set");
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function resetDatabase(admin: pg.Client, name: string): Promise<void> {
  // Terminate any leftover connections from a previous interrupted run.
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  // The schema declares pgvector columns (ai_live_documents.embedding), so a
  // fresh database needs the extension BEFORE drizzle-kit push can create the
  // table — mirroring the api-server boot hook, which runs
  // CREATE EXTENSION IF NOT EXISTS vector ahead of any schema sync.
  await withClient(dbUrlFor(name), async (c) => {
    await c.query("CREATE EXTENSION IF NOT EXISTS vector");
  });
}

async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  await admin
    .query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    )
    .catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`).catch(() => undefined);
}

function applyDrizzlePush(dbUrl: string): void {
  execSync("pnpm exec drizzle-kit push --force --config ./drizzle.config.ts", {
    cwd: DB_PKG_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Error codes the SQL companion migrations are *expected* to hit when
// applied on top of an already-pushed schema. Drizzle-kit push is the
// source of truth for schema in this project; the .sql files in
// `lib/db/drizzle/` are hand-written companions that exist either to
// backfill data or to refresh constraints that push can't model cleanly,
// and they're written to be idempotent. When they re-create something
// push already made, we'll see "duplicate_object" / "duplicate_table"
// (for files that lack `IF NOT EXISTS` guards) — that's fine.
const TOLERATED_REPLAY_ERROR_CODES = new Set<string>([
  // "Already exists" — drizzle-kit push already created this object.
  "42P07", // duplicate_table
  "42710", // duplicate_object  (constraint, index, etc.)
  "42701", // duplicate_column
  "42P06", // duplicate_schema
  "42723", // duplicate_function
]);

async function applyRawMigrations(dbUrl: string): Promise<void> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  await withClient(dbUrl, async (client) => {
    for (const file of files) {
      const cleaned = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");

      // Drizzle-generated files use `--> statement-breakpoint` between
      // statements. Hand-written SQL files don't and may use transaction
      // blocks (BEGIN; ... COMMIT;) which must be executed as a unit.
      const hasBreakpoint = cleaned.includes("--> statement-breakpoint");
      const statements = hasBreakpoint
        ? cleaned
            .split(/-->\s*statement-breakpoint/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [cleaned];

      for (const stmt of statements) {
        try {
          await client.query(stmt);
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code && TOLERATED_REPLAY_ERROR_CODES.has(code)) continue;
          // If the failure happened inside a multi-statement transaction
          // block (BEGIN; ... COMMIT;), Postgres aborts the whole tx and
          // every later statement against the same connection would error
          // with `25P02`. Roll back so the next file gets a clean tx.
          try {
            await client.query("ROLLBACK");
          } catch {
            /* not in a tx — ignore */
          }
          // Hand-written files (no `--> statement-breakpoint`) run as a
          // single transactional block. When their inner statements
          // reference now-renamed / since-dropped objects, the entire
          // block aborts. That's expected historical drift and shows up
          // in the baseline diff — log and continue rather than failing
          // the test setup. Drizzle-generated files (with breakpoints)
          // run statement-by-statement, so any uncaught error there IS a
          // real problem worth surfacing.
          if (!hasBreakpoint) {
            // eslint-disable-next-line no-console
            console.warn(
              `[drift] skipping ${file} (${code ?? "unknown"}): ${(err as Error).message.split("\n")[0]}`,
            );
            break;
          }
          throw new Error(
            `Failed applying ${file}: ${(err as Error).message}\n` +
              `--- statement (truncated) ---\n${stmt.slice(0, 800)}`,
          );
        }
      }
    }
  });
}

interface DbSnapshot {
  tables: string[];
  columns: string[];
  constraints: string[];
  indexes: string[];
}

async function captureSnapshot(dbUrl: string): Promise<DbSnapshot> {
  return withClient(dbUrl, async (client) => {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'`,
    );

    const columnsRes = await client.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, udt_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );

    const constraintsRes = await client.query<{
      table_name: string;
      contype: string;
      def: string;
    }>(
      `SELECT c.conrelid::regclass::text AS table_name,
              c.contype::text         AS contype,
              pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'
          AND c.contype IN ('u','c','f','p')`,
    );

    const indexesRes = await client.query<{ tablename: string; def: string }>(
      `SELECT tablename,
              -- Strip the auto-generated index name so we compare on
              -- structure (columns, predicate, uniqueness), not on which
              -- side happened to pick a particular conventional name.
              regexp_replace(
                indexdef,
                '^(CREATE (?:UNIQUE )?INDEX )"?[^" ]+"?( ON )',
                '\\1<name>\\2'
              ) AS def
         FROM pg_indexes
        WHERE schemaname = 'public'`,
    );

    return {
      tables: tablesRes.rows.map((r) => r.table_name).sort(),
      columns: columnsRes.rows
        .map(
          (r) =>
            `${r.table_name}.${r.column_name} | ${r.udt_name} | ` +
            `${r.is_nullable === "NO" ? "NOT NULL" : "NULL"}`,
        )
        .sort(),
      constraints: constraintsRes.rows
        .map((r) => `${r.table_name} | ${r.contype} | ${r.def}`)
        .sort(),
      indexes: indexesRes.rows.map((r) => `${r.tablename} | ${r.def}`).sort(),
    };
  });
}

function diff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[] } {
  const setB = new Set(b);
  const setA = new Set(a);
  return {
    onlyInA: a.filter((x) => !setB.has(x)),
    onlyInB: b.filter((x) => !setA.has(x)),
  };
}

const skipReason = ADMIN_URL ? null : "DATABASE_URL is not set; skipping drift check";

// Path to the stored expected-drift baseline. Anything in this file is
// "known historical drift" between "run every migration on an empty DB"
// and "drizzle-kit push the schema." The early files (0001-0003) were
// reconciled in task #526 so they replay cleanly, but several later
// duplicate-numbered files and hand-written transactional .sql files
// still skip on this DB (see the [drift] warnings) and the divergent
// historical sequences / communication_log shapes are preserved through
// IF NOT EXISTS, so a non-trivial baseline diff is still expected. This
// file records that diff so the test catches NEW drift the day it lands.
// Regenerate with `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db
// test`.
const BASELINE_PATH = path.join(__dirname, "__fixtures__", "expected-drift.json");

interface DriftSection {
  onlyInPush: string[];
  onlyInMigrations: string[];
}

interface DriftBaseline {
  tables: DriftSection;
  columns: DriftSection;
  constraints: DriftSection;
  indexes: DriftSection;
}

const EMPTY_SECTION: DriftSection = { onlyInPush: [], onlyInMigrations: [] };

async function loadBaseline(): Promise<DriftBaseline> {
  const fallback: DriftBaseline = {
    tables: { ...EMPTY_SECTION },
    columns: { ...EMPTY_SECTION },
    constraints: { ...EMPTY_SECTION },
    indexes: { ...EMPTY_SECTION },
  };
  try {
    const raw = await fs.readFile(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DriftBaseline>;
    // Tolerate an older baseline file that predates the tables/columns
    // sections: default any missing section to empty so a stale fixture
    // can't crash the test (it'll simply flag any real drift instead).
    return {
      tables: parsed.tables ?? { ...EMPTY_SECTION },
      columns: parsed.columns ?? { ...EMPTY_SECTION },
      constraints: parsed.constraints ?? { ...EMPTY_SECTION },
      indexes: parsed.indexes ?? { ...EMPTY_SECTION },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw err;
  }
}

async function writeBaseline(b: DriftBaseline): Promise<void> {
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, JSON.stringify(b, null, 2) + "\n", "utf8");
}

describe.skipIf(skipReason !== null)("schema vs migration drift", () => {
  const suffix = `${process.pid}_${Date.now().toString(36)}`;
  const pushDb = `drift_push_${suffix}`;
  const migrateDb = `drift_migrate_${suffix}`;

  let admin: pg.Client;
  let pushSnap: DbSnapshot;
  let migrateSnap: DbSnapshot;
  let baseline: DriftBaseline;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await resetDatabase(admin, pushDb);
    await resetDatabase(admin, migrateDb);

    // Build each database the way the task description asks:
    //   - pushDb     <- only `drizzle-kit push` (schema = source of truth)
    //   - migrateDb  <- only the raw `lib/db/drizzle/*.sql` files
    //
    // We then snapshot tables, columns (with type + nullability), UNIQUE /
    // CHECK / FK / PK constraints and indexes (including partial indexes)
    // from both, and compare the diff to a stored baseline. A non-empty
    // *unexpected* diff means either a SQL migration added something the
    // schema doesn't mirror, or — the case this guard primarily targets —
    // the schema declares a table/column/constraint/index that NO committed
    // companion migration produces. That latter case (`onlyInPush`) is what
    // drops the shared post-merge into a slow interactive
    // `drizzle-kit push --force` that hangs in the non-interactive merge
    // environment. The constraint diff also catches the task #488 failure
    // mode (the `webhook_logs.external_id` UNIQUE bug).
    applyDrizzlePush(dbUrlFor(pushDb));
    await applyRawMigrations(dbUrlFor(migrateDb));

    pushSnap = await captureSnapshot(dbUrlFor(pushDb));
    migrateSnap = await captureSnapshot(dbUrlFor(migrateDb));

    const tableDiff = diff(pushSnap.tables, migrateSnap.tables);
    const columnDiff = diff(pushSnap.columns, migrateSnap.columns);
    const constraintDiff = diff(pushSnap.constraints, migrateSnap.constraints);
    const indexDiff = diff(pushSnap.indexes, migrateSnap.indexes);
    const current: DriftBaseline = {
      tables: {
        onlyInPush: tableDiff.onlyInA,
        onlyInMigrations: tableDiff.onlyInB,
      },
      columns: {
        onlyInPush: columnDiff.onlyInA,
        onlyInMigrations: columnDiff.onlyInB,
      },
      constraints: {
        onlyInPush: constraintDiff.onlyInA,
        onlyInMigrations: constraintDiff.onlyInB,
      },
      indexes: {
        onlyInPush: indexDiff.onlyInA,
        onlyInMigrations: indexDiff.onlyInB,
      },
    };

    if (process.env.UPDATE_DRIFT_BASELINE === "1") {
      await writeBaseline(current);
    }
    baseline = await loadBaseline();
    // Stash current for use in the assertion tests below.
    (globalThis as { __driftCurrent?: DriftBaseline }).__driftCurrent = current;
  });

  afterAll(async () => {
    if (admin) {
      await dropDatabase(admin, pushDb);
      await dropDatabase(admin, migrateDb);
      await admin.end();
    }
  });

  test("table drift matches the recorded baseline", () => {
    const current = (globalThis as { __driftCurrent?: DriftBaseline })
      .__driftCurrent!;
    expect(
      current.tables,
      "Table drift between drizzle-kit push (schema) and the committed raw\n" +
        "SQL migrations changed since the last baseline.\n\n" +
        "- New entries in `onlyInPush` mean a TABLE was added to\n" +
        "  `lib/db/src/schema/*.ts` but NO committed companion migration in\n" +
        "  `lib/db/drizzle/*.sql` creates it. This is the failure mode this\n" +
        "  guard exists to stop: on merge the shared post-merge setup falls\n" +
        "  back to a slow interactive `drizzle-kit push --force` that hangs\n" +
        "  in the non-interactive merge environment and breaks everyone's\n" +
        "  dev DB. FIX: write an idempotent `CREATE TABLE IF NOT EXISTS …`\n" +
        "  companion `.sql` in `lib/db/drizzle/` AND wire it into\n" +
        "  `scripts/post-merge.sh` (see the additive-table steps, e.g.\n" +
        "  step 13 / content_access_map).\n" +
        "- New entries in `onlyInMigrations` mean a migration creates a\n" +
        "  table the schema no longer declares. Remove the table from the\n" +
        "  migration set (or drop it explicitly in post-merge) or restore\n" +
        "  the schema definition.\n" +
        "- After verifying the diff is intentional, refresh the baseline\n" +
        "  with `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db test`.",
    ).toEqual(baseline.tables);
  });

  test("column drift matches the recorded baseline", () => {
    const current = (globalThis as { __driftCurrent?: DriftBaseline })
      .__driftCurrent!;
    expect(
      current.columns,
      "Column drift between drizzle-kit push (schema) and the committed raw\n" +
        "SQL migrations changed since the last baseline.\n\n" +
        "- New entries in `onlyInPush` mean a COLUMN (or its type /\n" +
        "  nullability) was added/changed in `lib/db/src/schema/*.ts` but\n" +
        "  NO committed companion migration in `lib/db/drizzle/*.sql`\n" +
        "  produces it. On merge this drops the shared post-merge into a\n" +
        "  slow interactive `drizzle-kit push --force` that hangs in the\n" +
        "  non-interactive merge environment. FIX: write an idempotent\n" +
        "  `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` companion `.sql` in\n" +
        "  `lib/db/drizzle/` AND wire it into `scripts/post-merge.sh` (see\n" +
        "  the additive-column steps, e.g. step 12).\n" +
        "- New entries in `onlyInMigrations` mean a migration creates a\n" +
        "  column the schema no longer declares. Reconcile the schema or\n" +
        "  the migration.\n" +
        "- After verifying the diff is intentional, refresh the baseline\n" +
        "  with `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db test`.",
    ).toEqual(baseline.columns);
  });

  test("UNIQUE / CHECK / FK / PK constraint drift matches the recorded baseline", () => {
    const current = (globalThis as { __driftCurrent?: DriftBaseline })
      .__driftCurrent!;
    expect(
      current.constraints,
      "Constraint drift between drizzle-kit push (schema) and raw SQL\n" +
        "migrations changed since the last baseline.\n\n" +
        "- New entries in `onlyInMigrations` mean a SQL migration adds a\n" +
        "  UNIQUE / CHECK / FK that the schema doesn't declare — this is\n" +
        "  the failure class that motivated task #488. Add the constraint\n" +
        "  to the matching `lib/db/src/schema/*.ts` file.\n" +
        "- New entries in `onlyInPush` mean the schema declares a constraint\n" +
        "  that no migration produces. Usually fine in this codebase (push\n" +
        "  is the deployment mechanism) but record it via\n" +
        "  `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db test` after\n" +
        "  reviewing the diff.",
    ).toEqual(baseline.constraints);
  });

  test("index drift (including partial indexes) matches the recorded baseline", () => {
    const current = (globalThis as { __driftCurrent?: DriftBaseline })
      .__driftCurrent!;
    expect(
      current.indexes,
      "Index drift between drizzle-kit push (schema) and raw SQL\n" +
        "migrations changed since the last baseline.\n\n" +
        "- New entries in `onlyInMigrations` mean a SQL migration creates\n" +
        "  an index (or partial-index predicate) the schema doesn't mirror.\n" +
        "  Add a matching `index(...)` / `uniqueIndex(...)` clause to the\n" +
        "  schema file for that table.\n" +
        "- After verifying the diff is intentional, refresh the baseline\n" +
        "  with `UPDATE_DRIFT_BASELINE=1 pnpm --filter @workspace/db test`.",
    ).toEqual(baseline.indexes);
  });
});
