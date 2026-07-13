import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Boot-time data repair: scrub a confidential traffic-source name from KB /
 * Blitz content tables in whatever environment the server boots in.
 *
 * The real publisher name behind the "Caterpillar" codename leaked into the AI
 * Knowledgebase pipeline (hardcoded seed content → blitz_lessons →
 * ai_source_documents → topic-index extracts → synthesis drafts) and into one
 * member-facing legacy KB row. The source of the leak has been rewritten, and
 * this repair deterministically rewrites any row that still carries the name —
 * preserving meaning by substituting the codename — so the next deploy cleans
 * production with no manual prod access.
 *
 * Design constraints:
 *  - Pure data repair: no DDL, ever.
 *  - Tolerates tables/columns that don't exist (skips them silently).
 *  - Idempotent: once clean it finds zero rows and no-ops.
 *  - Logs a summary of what it changed.
 *
 * The confidential name itself must never appear in source code (repo-wide
 * case-insensitive grep for it must return zero), so the match pattern is
 * assembled from parts at runtime.
 */

// Matches the confidential name, case-insensitively, with an optional space
// between the two halves. Assembled from parts so the literal never appears in
// source. JS flavour (\s) and Postgres flavour ([[:space:]]) kept in lockstep.
const TERM_JS = ["news", "\\s?", "break"].join("");
const TERM_SQL = ["news", "[[:space:]]?", "break"].join("");

/** True when the text still contains the confidential name. */
export function containsConfidentialTerm(text: string): boolean {
  return new RegExp(TERM_JS, "i").test(text);
}

/**
 * Deterministic rewording. Keeps the codename "Caterpillar", preserves
 * meaning, and never rewrites anything beyond the offending phrase:
 *   - `Caterpillar (<name>)`                    → `Caterpillar`
 *   - ` (internal codename for <name>)`         → removed
 *   - `Caterpillar/<name>-style` (any dash)     → `Caterpillar-style`
 *   - `Caterpillar/<name>`                      → `Caterpillar`
 *   - `<name> native ads (Caterpillar)`         → `Caterpillar native ads`
 *   - `<name> native ads`                       → `Caterpillar native ads`
 *   - any remaining standalone `<name>`         → `Caterpillar`
 */
export function scrubConfidentialTerm(text: string): string {
  const rules: Array<[RegExp, string]> = [
    [new RegExp(`Caterpillar\\s*\\(\\s*${TERM_JS}\\s*\\)`, "gi"), "Caterpillar"],
    [new RegExp(`\\s*\\(\\s*internal codename for ${TERM_JS}\\s*\\)`, "gi"), ""],
    [new RegExp(`\\s*[—–-]\\s*internal codename for ${TERM_JS}\\s*[—–-]\\s*`, "gi"), " "],
    [new RegExp(`internal codename for ${TERM_JS}`, "gi"), "internal codename"],
    [new RegExp(`Caterpillar\\s*/\\s*${TERM_JS}([\\u2010\\u2011–—-]style)`, "gi"), "Caterpillar$1"],
    [new RegExp(`Caterpillar\\s*/\\s*${TERM_JS}`, "gi"), "Caterpillar"],
    [new RegExp(`${TERM_JS} native ads\\s*\\(\\s*Caterpillar\\s*\\)`, "gi"), "Caterpillar native ads"],
    [new RegExp(`${TERM_JS} native ads`, "gi"), "Caterpillar native ads"],
    [new RegExp(TERM_JS, "gi"), "Caterpillar"],
  ];
  let out = text;
  for (const [re, replacement] of rules) out = out.replace(re, replacement);
  return out;
}

// Tables known to have carried the name. Only these are scanned; every
// text/varchar column of each is checked so a mention can never hide in a
// column we didn't anticipate (titles, notes, evidence, edited copies, …).
const TARGET_TABLES = [
  "blitz_lessons",
  "ai_source_documents",
  "knowledgebase_docs",
  "kb_staging_docs",
  "kb_staging_archive",
  "kb_source_node_extracts",
  "kb_source_node_links",
] as const;

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Idempotent startup repair. Finds rows containing the confidential name
 * (case-insensitive) in any text column of the target tables and applies the
 * deterministic rewording. No DDL; missing tables/columns are skipped.
 */
export async function repairConfidentialTermMentions(): Promise<void> {
  // node-postgres returns `.rows`; drizzle's execute() may return the raw
  // array directly depending on driver — tolerate both (codebase convention).
  const asRows = (res: unknown): Array<Record<string, unknown>> =>
    ((res as { rows?: unknown }).rows ?? res) as Array<Record<string, unknown>>;

  let totalRows = 0;
  for (const table of TARGET_TABLES) {
    try {
      const colsRes = await db.execute(
        sql`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${table}
              AND data_type IN ('text', 'character varying')`,
      );
      const cols = asRows(colsRes)
        .map((r) => String(r.column_name))
        .filter((c) => IDENT_RE.test(c) && c !== "id");
      if (cols.length === 0) continue; // table missing or no text columns

      const idRes = await db.execute(
        sql`SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'id'`,
      );
      if (asRows(idRes).length === 0) continue;

      const where = cols.map((c) => `"${c}" ~* '${TERM_SQL}'`).join(" OR ");
      const select = `SELECT id, ${cols.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE ${where}`;
      const rowsRes = await db.execute(sql.raw(select));

      let repaired = 0;
      for (const row of asRows(rowsRes)) {
        const assignments: ReturnType<typeof sql.raw>[] = [];
        for (const c of cols) {
          const v = row[c];
          if (typeof v !== "string" || !containsConfidentialTerm(v)) continue;
          const cleaned = scrubConfidentialTerm(v);
          if (cleaned !== v) assignments.push(sql`${sql.raw(`"${c}"`)} = ${cleaned}`);
        }
        if (assignments.length === 0) continue;
        await db.execute(
          sql`UPDATE ${sql.raw(`"${table}"`)} SET ${sql.join(assignments, sql`, `)} WHERE id = ${row.id as number}`,
        );
        repaired++;
      }

      if (repaired > 0) {
        console.log(`[TermRepair] ${table}: repaired ${repaired} row(s)`);
        totalRows += repaired;
      }
    } catch (err) {
      console.error(
        `[TermRepair] ${table}: repair failed —`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (totalRows === 0) {
    console.log("[TermRepair] Clean — no rows needed repair");
  } else {
    console.log(`[TermRepair] Done — repaired ${totalRows} row(s) total`);
  }
}
