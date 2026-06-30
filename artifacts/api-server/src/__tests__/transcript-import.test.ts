import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, knowledgebaseDocsTable, transcriptCleanerDocumentsTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";

import {
  buildImportPlan,
  executeImport,
  stitchParts,
  orderedKeepDocIds,
  buildProvenanceNote,
  parseImportedGroupId,
  IMPORT_PROVENANCE_PREFIX,
  type ManifestGroup,
} from "../lib/transcript-import";

const TAG = `tcimport-${randomUUID().slice(0, 8)}`;

let tmpDir: string;
const seededDocIds: number[] = [];
const idByPart: Record<string, number> = {};

async function seedDoc(key: string, title: string, content: string): Promise<number> {
  const [row] = await db
    .insert(knowledgebaseDocsTable)
    .values({ title: `${TAG} ${title}`, content, docClass: "transcript", category: "transcript" })
    .returning({ id: knowledgebaseDocsTable.id });
  seededDocIds.push(row.id);
  idByPart[key] = row.id;
  return row.id;
}

function writeManifest(groups: ManifestGroup[]): Promise<void> {
  const manifest = { task: 1483, generatedAt: "2026-06-30T00:00:00.000Z", groups };
  return fs.writeFile(path.join(tmpDir, "docs", "transcript-triage", "manifest.json"), JSON.stringify(manifest), "utf8");
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tc-import-"));
  await fs.mkdir(path.join(tmpDir, "docs", "transcript-triage"), { recursive: true });

  // A 3-part keeper, a single-part keeper, and an excluded group.
  const p1 = await seedDoc("p1", "Adam Field (Part 1)", "  Hello world.  ");
  const p2 = await seedDoc("p2", "Adam Field (Part 2)", "Second part here.");
  const p3 = await seedDoc("p3", "Adam Field (Part 3)", "  Third and final. ");
  const s1 = await seedDoc("single", "VA Onboarding", "A single-part VA call.");
  const x1 = await seedDoc("excl", "Internal Standup", "Staff-only content.");

  const groups: ManifestGroup[] = [
    {
      groupId: "G1",
      title: "Adam Field Meeting",
      disposition: "keep",
      folder: "Private Coaching",
      authorityRole: "strategic_coach",
      proposedTitle: "Private Coaching — Adam Field (Coach Sasha)",
      titleRenamed: true,
      // Deliberately shuffled: keepDocIds order != narrative order; partOrder
      // is the source of truth (p1 is part 2, p2 is part 3, p3 is part 1).
      keepDocIds: [p1, p2, p3],
      partOrder: [2, 3, 1],
      duplicateDropDocIds: [],
    },
    {
      groupId: "G2",
      title: "VA Onboarding Call",
      disposition: "keep",
      folder: "1-on-1 VA",
      authorityRole: "va",
      proposedTitle: "1-on-1 VA — Onboarding",
      titleRenamed: false,
      keepDocIds: [s1],
      partOrder: [null],
      duplicateDropDocIds: [99999999],
    },
    {
      groupId: "G3",
      title: "Internal Standup",
      disposition: "exclude",
      reason: "Staff-only ops content.",
      authorityRole: "internal",
      keepDocIds: [x1],
      partOrder: [null],
      duplicateDropDocIds: [],
    },
    {
      groupId: "G4",
      title: "Vanished Recording",
      disposition: "keep",
      folder: "Group Coaching",
      authorityRole: "strategic_coach",
      proposedTitle: "Group Coaching — Missing",
      titleRenamed: true,
      keepDocIds: [88888888],
      partOrder: [null],
      duplicateDropDocIds: [],
    },
  ];
  await writeManifest(groups);
});

afterAll(async () => {
  // Remove imported holding-store rows (matched by our provenance marker on the test groups).
  await db
    .delete(transcriptCleanerDocumentsTable)
    .where(like(transcriptCleanerDocumentsTable.provenanceNote, `${IMPORT_PROVENANCE_PREFIX} — group G%`))
    .catch(() => undefined);
  if (seededDocIds.length > 0) {
    await db.delete(knowledgebaseDocsTable).where(inArray(knowledgebaseDocsTable.id, seededDocIds));
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("stitchParts", () => {
  it("joins trimmed parts with a single space, no headings", () => {
    expect(stitchParts(["  a ", "b", "", "  c  "])).toBe("a b c");
  });
  it("returns the lone part as-is for single-part keepers", () => {
    expect(stitchParts(["  only part  "])).toBe("only part");
  });
});

describe("orderedKeepDocIds", () => {
  it("orders ids by partOrder rather than keepDocIds sequence", () => {
    const group = { keepDocIds: [10, 20, 30], partOrder: [3, 1, 2] } as ManifestGroup;
    expect(orderedKeepDocIds(group)).toEqual([20, 30, 10]);
  });
  it("keeps original order when partOrder is null/single-part", () => {
    const group = { keepDocIds: [10, 20], partOrder: [null, null] } as ManifestGroup;
    expect(orderedKeepDocIds(group)).toEqual([10, 20]);
  });
});

describe("provenance marker round-trip", () => {
  it("recovers the group id from the note it stamps", () => {
    const note = buildProvenanceNote({ groupId: "G7", keepDocIds: [1, 2] } as ManifestGroup);
    expect(parseImportedGroupId(note)).toBe("G7");
  });
  it("returns null for an unrelated note", () => {
    expect(parseImportedGroupId("Filed from Transcript Cleaner")).toBeNull();
  });
});

describe("buildImportPlan", () => {
  it("classifies keep / exclude / missing groups and rolls up a summary", async () => {
    const { entries, summary } = await buildImportPlan(db, tmpDir);
    const byId = Object.fromEntries(entries.map((e) => [e.groupId, e]));

    expect(byId.G1.action).toBe("import");
    expect(byId.G1.partCount).toBe(3);
    expect(byId.G1.transcriptType).toBe("private_coaching");
    expect(byId.G1.authorityRole).toBe("strategic_coach");

    expect(byId.G2.action).toBe("import");
    expect(byId.G2.transcriptType).toBe("one_on_one_va");

    expect(byId.G3.action).toBe("skip_excluded");
    expect(byId.G4.action).toBe("skip_missing_sources");

    expect(summary.toImport).toBe(2);
    expect(summary.stitched).toBe(1);
    expect(summary.singlePart).toBe(1);
    expect(summary.renamed).toBe(1);
    expect(summary.excluded).toBe(1);
    expect(summary.missingSources).toBe(1);
  });
});

describe("executeImport", () => {
  it("stitches, titles from proposedTitle, tags type+role, and is idempotent", async () => {
    const first = await executeImport(db, tmpDir);
    expect(first.summary.imported).toBe(2);

    const g1 = first.entries.find((e) => e.groupId === "G1");
    expect(g1?.documentId).toBeDefined();
    const [doc] = await db
      .select()
      .from(transcriptCleanerDocumentsTable)
      .where(inArray(transcriptCleanerDocumentsTable.id, [g1!.documentId!]));

    // Combined transcript: parts in partOrder (p3=1, p1=2, p2=3) joined by a
    // single space, trimmed — proving partOrder, not keepDocIds order, wins.
    expect(doc.originalContent).toBe("Third and final. Hello world. Second part here.");
    expect(doc.title).toBe("Private Coaching — Adam Field (Coach Sasha)");
    expect(doc.proposedTitle).toBe("Private Coaching — Adam Field (Coach Sasha)");
    expect(doc.transcriptType).toBe("private_coaching");
    expect(doc.authorityRole).toBe("strategic_coach");
    expect(doc.status).toBe("uploaded");
    expect(parseImportedGroupId(doc.provenanceNote)).toBe("G1");

    // Re-running imports nothing new (already-imported skip).
    const second = await executeImport(db, tmpDir);
    expect(second.summary.imported).toBe(0);
    expect(second.summary.alreadyImported).toBe(2);
  });
});
