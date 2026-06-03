/**
 * Idempotent seed for the blitz_phases table.
 *
 * Populates the four canonical Blitz phases and verifies that all 23
 * lesson→phase associations are consistent with the live BlitzHub.tsx
 * curriculum (via lib/blitz/sections.ts).
 *
 * ARCHITECTURE NOTE — where lesson→phase association lives:
 *   There is no `blitz_sections` DB table. The lesson→phase mapping is
 *   canonical in `lib/blitz/sections.ts` (BLITZ_SECTIONS array), which mirrors
 *   the hardcoded LESSONS array in BlitzHub.tsx. All backend services
 *   (coach dashboard, phase-gate, continue-resolver) import from sections.ts
 *   rather than querying a DB table. This script only writes the four *phase*
 *   rows to blitz_phases; the lesson associations live entirely in code.
 *   If a blitz_sections table is added in the future, this script is the
 *   natural place to extend with lesson→phase inserts.
 *
 * Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE so existing rows
 * are brought up to date rather than duplicated or errored.
 *
 * Usage:
 *   npx tsx artifacts/api-server/src/scripts/seed-blitz-phases.ts
 */

import { db } from "@workspace/db";
import { blitzPhasesTable } from "@workspace/db";
import { BLITZ_PHASES, BLITZ_SECTIONS } from "../lib/blitz/sections";

async function seedBlitzPhases() {
  console.log("Seeding blitz_phases...");

  for (const phase of BLITZ_PHASES) {
    const color = phase.color;
    await db
      .insert(blitzPhasesTable)
      .values({
        slug: phase.key,
        name: phase.label,
        sortOrder: phase.sortOrder,
        color,
      })
      .onConflictDoUpdate({
        target: blitzPhasesTable.slug,
        set: {
          name: phase.label,
          sortOrder: phase.sortOrder,
          color,
        },
      });
    console.log(`  ✓ phase "${phase.key}" → "${phase.label}" (color: ${color})`);
  }

  const inserted = await db
    .select()
    .from(blitzPhasesTable)
    .orderBy(blitzPhasesTable.sortOrder);

  console.log(`\nblitz_phases table now has ${inserted.length} rows:`);
  for (const row of inserted) {
    console.log(`  [${row.sortOrder}] ${row.slug} — "${row.name}" (${row.color})`);
  }

  console.log("\nVerifying lesson→phase mapping (lib/blitz/sections.ts):");
  const byPhase: Record<string, number[]> = {};
  for (const section of BLITZ_SECTIONS) {
    if (!byPhase[section.phase]) byPhase[section.phase] = [];
    byPhase[section.phase].push(section.id);
  }
  for (const phase of BLITZ_PHASES) {
    const ids = byPhase[phase.key] ?? [];
    console.log(`  ${phase.key}: ${ids.length} lesson(s) — ids [${ids.join(", ")}]`);
  }
  const total = BLITZ_SECTIONS.length;
  console.log(`\nTotal lessons with phase association: ${total} (expected: 23)`);
  if (total !== 23) {
    console.error(`ERROR: expected 23 lessons, found ${total}`);
    process.exit(1);
  }

  console.log("\nDone. Blitz phase seed complete.");
}

seedBlitzPhases()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
