/**
 * CLI entrypoint for the knowledgebase_docs re-scrub.
 *
 * The actual logic lives in ../lib/rescrub-knowledgebase-docs.ts (pure, no
 * side-effects) so it can be imported safely from server startup
 * (bootstrap-critical-prerequisites.ts) WITHOUT this CLI runner being bundled
 * into the production server. This file is only ever executed directly via tsx
 * (post-merge.sh) — keeping the `process.exit` runner out of the lib means the
 * server bundle can never accidentally trip it on boot.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/rescrub-knowledgebase-docs.ts
 */
import {
  rescrubKnowledgebaseDocs,
  findUnscrubbedTitles,
  type RescrubResult,
  type TitleLeak,
} from "../lib/rescrub-knowledgebase-docs";

export { rescrubKnowledgebaseDocs, findUnscrubbedTitles };
export type { RescrubResult, TitleLeak };

// Run directly as a CLI script (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  rescrubKnowledgebaseDocs((m) => console.log(m))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[rescrub] failed:", err);
      process.exit(1);
    });
}
