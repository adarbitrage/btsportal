/**
 * ingest-kb.ts
 *
 * Ingests the BTS knowledge base files into the knowledgebase_docs table.
 * Safe to re-run — uses ON CONFLICT (title) DO NOTHING for idempotency.
 *
 * Usage:
 *   npx tsx src/scripts/ingest-kb.ts
 */

import { seedKnowledgebaseFromFiles } from "../lib/seed-kb.js";

async function main() {
  await seedKnowledgebaseFromFiles();
  process.exit(0);
}

main().catch((err) => {
  console.error("[ingest-kb] Fatal error:", err);
  process.exit(1);
});
