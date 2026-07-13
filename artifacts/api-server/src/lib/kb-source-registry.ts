/**
 * KB transcript-source discovery + population (Task #2, step 15).
 *
 * Scans the three raw corpora for logical sources, screens each by name, and
 * upserts `kb_transcript_sources` rows. Idempotent: existing rows (including
 * human overrides) are never clobbered (ON CONFLICT (source_name) DO NOTHING).
 *
 * Shared by the admin `POST /admin/knowledgebase/sources/rescan` route.
 */

import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbTranscriptSourcesTable, coachesTable } from "@workspace/db/schema";
import {
  screenSourceName,
  resolveAuthorityRole,
  type SourceKind,
} from "./kb-source-screening.js";

const KB_DIR_CANDIDATES = [
  path.join(process.cwd(), "src/knowledge-base"),
  path.join(process.cwd(), "artifacts/api-server/src/knowledge-base"),
];
const DOCX_DIR_CANDIDATES = [
  path.join(process.cwd(), "src/data/coaching-transcripts"),
  path.join(process.cwd(), "artifacts/api-server/src/data/coaching-transcripts"),
];

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function buildCoachRoster(): Promise<Map<string, string>> {
  const rows = await db
    .select({ name: coachesTable.name, type: coachesTable.type })
    .from(coachesTable);
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.name) m.set(r.name.trim().toLowerCase(), r.type ?? "");
  }
  return m;
}

export interface DiscoveredSource {
  sourceName: string;
  sourceKind: SourceKind;
  coachName: string | null;
  trustedPool: boolean;
}

/** Scan the three raw corpora for logical sources (no DB writes). */
export function discoverSources(): DiscoveredSource[] {
  const out: DiscoveredSource[] = [];
  const kbDir = firstExisting(KB_DIR_CANDIDATES);

  if (kbDir) {
    // 1) Curriculum videos — video-transcripts.txt, one per "Title:" line.
    const vfile = path.join(kbDir, "video-transcripts.txt");
    if (fs.existsSync(vfile)) {
      const text = fs.readFileSync(vfile, "utf-8");
      for (const m of text.matchAll(/^Title:\s*(.+?)\s*$/gm)) {
        const name = m[1].trim();
        if (name) out.push({ sourceName: `video:${name}`, sourceKind: "video", coachName: null, trustedPool: true });
      }
    }
  }

  // 2) VA 1:1 docx pool — coaching-transcripts/<Coach>/*.docx.
  const docxDir = firstExisting(DOCX_DIR_CANDIDATES);
  if (docxDir) {
    const dirs = fs.readdirSync(docxDir).filter((d) => {
      try {
        return fs.statSync(path.join(docxDir, d)).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of dirs) {
      const coachDir = path.join(docxDir, dir);
      const files = fs.readdirSync(coachDir).filter((f) => f.toLowerCase().endsWith(".docx"));
      for (const f of files) {
        const base = f.replace(/\.docx$/i, "").trim();
        out.push({
          sourceName: `${dir}/${base}`,
          sourceKind: "va_docx",
          coachName: dir,
          trustedPool: true,
        });
      }
    }
  }

  return out;
}

export interface PopulateResult {
  discovered: number;
  inserted: number;
  quarantined: number;
}

/** Idempotent population sweep. Never clobbers an existing row / human override. */
export async function populateSources(): Promise<PopulateResult> {
  const roster = await buildCoachRoster();
  const discovered = discoverSources();
  let inserted = 0;
  let quarantined = 0;

  for (const d of discovered) {
    const screen = screenSourceName(d.sourceName, { trustedPool: d.trustedPool });
    const isQuarantined = screen.disposition === "quarantined";
    const { authorityRole, coachName } = resolveAuthorityRole(
      {
        sourceName: d.sourceName,
        sourceKind: d.sourceKind,
        coachName: d.coachName,
        quarantined: isQuarantined,
      },
      roster,
    );

    const result = await db
      .insert(kbTranscriptSourcesTable)
      .values({
        sourceName: d.sourceName,
        sourceKind: d.sourceKind,
        coachName,
        disposition: screen.disposition,
        authorityRole,
        notes: screen.reason,
      })
      .onConflictDoNothing({ target: kbTranscriptSourcesTable.sourceName })
      .returning({ id: kbTranscriptSourcesTable.id });

    if (result.length > 0) {
      inserted += 1;
      if (isQuarantined) quarantined += 1;
    }
  }

  return { discovered: discovered.length, inserted, quarantined };
}
