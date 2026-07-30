import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Guard against the portal calling API routes retired with the legacy
 * knowledge-base stack. The backend removed:
 *   - the legacy admin KB CRUD   (/admin/chat/knowledgebase, non-staging)
 *   - the member KB search/browse/bookmark API (/kb/...)
 *   - the gated triaged-transcript import (/admin/transcript-cleaner/import)
 * If any of these strings reappear in portal source, an admin or member would
 * hit a dead 404 path at runtime — fail fast here instead.
 *
 * NOTE: the modern staging pages live under /admin/chat/knowledgebase/review
 * and /admin/chat/knowledgebase/archivebackup (frontend routes only) and the
 * modern API namespace is /admin/knowledgebase/... — both stay allowed.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /["'`]\/admin\/transcript-cleaner\/import(\/preview)?["'`]/,
    why: "gated triaged-transcript import endpoints were retired",
  },
  {
    // Legacy admin KB CRUD calls: /api/admin/chat/knowledgebase optionally
    // followed by /:id — but NOT the frontend staging routes /review or
    // /archivebackup, and not the retired-marker query key.
    pattern: /adminFetch[^\n]*\/admin\/chat\/knowledgebase(?!(-retired|\/review|\/archivebackup))/,
    why: "legacy admin KB CRUD endpoints were retired",
  },
  {
    pattern: /["'`]\/kb\/(search|browse|counts|bookmarks?)/,
    why: "legacy member KB search/browse/bookmark endpoints were retired",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("retired legacy KB routes stay out of portal source", () => {
  it("no portal source file references a retired KB endpoint", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const content = fs.readFileSync(file, "utf-8");
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(content)) {
          offenders.push(`${path.relative(SRC_DIR, file)} — ${why} (${pattern})`);
        }
      }
    }
    expect(offenders, `Retired KB endpoint reference(s) found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
