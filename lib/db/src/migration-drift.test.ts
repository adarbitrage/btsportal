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
  // "Doesn't exist" — old migrations reference columns / tables that
  // have since been renamed or dropped from the current schema. Skipping
  // these dependent statements doesn't compromise drift detection: any
  // *new* SQL migration that adds a UNIQUE / CHECK / FK / index on a
  // table that's still in the schema will succeed and show up in the
  // snapshot diff if the schema doesn't also declare it.
  "42703", // undefined_column
  "42P01", // undefined_table
  "42704", // undefined_object
]);

function preprocessSql(sql: string): string {
  // Some historical drizzle-generated migrations issue
  //   ALTER COLUMN "x" SET DATA TYPE jsonb;
  // without a USING clause, which Postgres rejects when there is no
  // implicit cast between the old and new types (text -> jsonb, etc.).
  // The column already has the target type after `drizzle-kit push`, so
  // this ALTER is a no-op in practice — we just need it to not error
  // when the planner can't find an implicit cast.
  return sql.replace(
    /ALTER COLUMN\s+("?\w+"?)\s+SET DATA TYPE\s+(\w+)(?!\s+USING\b)/gi,
    "ALTER COLUMN $1 SET DATA TYPE $2 USING $1::$2",
  );
}

async function applyRawMigrations(dbUrl: string): Promise<void> {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  await withClient(dbUrl, async (client) => {
    for (const file of files) {
      const raw = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const cleaned = preprocessSql(raw);

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
  constraints: string[];
  indexes: string[];
}

async function captureSnapshot(dbUrl: string): Promise<DbSnapshot> {
  return withClient(dbUrl, async (client) => {
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
// "known historical drift" — the SQL migration history in
// `lib/db/drizzle/` is NOT a faithful replayable database log (early
// files re-issue CREATE TABLEs and reference long-renamed columns), so
// there is real, pre-existing divergence between "run every migration on
// an empty DB" and "drizzle-kit push the schema." This baseline records
// exactly that divergence so the test still catches NEW drift the day it
// lands. Regenerate with `UPDATE_DRIFT_BASELINE=1 pnpm --filter
// @workspace/db test`.
const BASELINE_PATH = path.join(__dirname, "__fixtures__", "expected-drift.json");

interface DriftBaseline {
  constraints: { onlyInPush: string[]; onlyInMigrations: string[] };
  indexes: { onlyInPush: string[]; onlyInMigrations: string[] };
}

async function loadBaseline(): Promise<DriftBaseline> {
  try {
    const raw = await fs.readFile(BASELINE_PATH, "utf8");
    return JSON.parse(raw) as DriftBaseline;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        constraints: { onlyInPush: [], onlyInMigrations: [] },
        indexes: { onlyInPush: [], onlyInMigrations: [] },
      };
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
    // We then snapshot UNIQUE / CHECK / FK / PK constraints and indexes
    // (including partial indexes) from both, and compare the diff to a
    // stored baseline. A non-empty *unexpected* diff means a SQL
    // migration added a constraint the schema doesn't mirror, or the
    // schema declares one no migration creates — the exact failure mode
    // behind task #488 (the `webhook_logs.external_id` UNIQUE bug).
    applyDrizzlePush(dbUrlFor(pushDb));
    await applyRawMigrations(dbUrlFor(migrateDb));

    pushSnap = await captureSnapshot(dbUrlFor(pushDb));
    migrateSnap = await captureSnapshot(dbUrlFor(migrateDb));

    const constraintDiff = diff(pushSnap.constraints, migrateSnap.constraints);
    const indexDiff = diff(pushSnap.indexes, migrateSnap.indexes);
    const current: DriftBaseline = {
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
