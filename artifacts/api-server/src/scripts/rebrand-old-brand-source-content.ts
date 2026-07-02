/**
 * CLI entrypoint for the old-brand source-content rebrand backfill.
 *
 * The actual logic lives in ../lib/rebrand-old-brand-source-content.ts (pure, no
 * side-effects) so it can be imported safely from server startup
 * (bootstrap-critical-prerequisites.ts) WITHOUT this CLI runner being bundled
 * into the production server. This file is only ever executed directly via tsx
 * (post-merge.sh) — keeping the `process.exit` runner out of the lib means the
 * server bundle can never accidentally trip it on boot.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/rebrand-old-brand-source-content.ts
 */
import {
  rebrandOldBrandSourceContent,
  type RebrandOldBrandResult,
  type RebrandTableResult,
} from "../lib/rebrand-old-brand-source-content";

export { rebrandOldBrandSourceContent };
export type { RebrandOldBrandResult, RebrandTableResult };

// Run directly as a CLI script (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  rebrandOldBrandSourceContent((m) => console.log(m))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[rebrand] failed:", err);
      process.exit(1);
    });
}
