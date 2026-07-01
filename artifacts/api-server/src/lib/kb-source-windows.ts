import { createHash } from "node:crypto";

/**
 * Shared pure helpers for the Synthesis Engine full-source read (Task #1561).
 *
 * The topic-index classification and the synthesis map phase both used to feed
 * only a truncated prefix of each source to the model (9k / 6k chars). To read
 * the WHOLE of every source they now walk overlapping windows and merge the
 * per-window results. These helpers are deterministic and side-effect free so
 * they can be unit tested without a DB or the LLM.
 */

/**
 * Split `text` into overlapping windows of at most `windowSize` chars, each
 * starting `windowSize - overlap` chars after the previous. The overlap keeps a
 * fact that straddles a boundary intact in at least one window. Short text
 * (<= windowSize) yields a single window. Guards against a non-positive step.
 */
export function contentWindows(text: string, windowSize: number, overlap: number): string[] {
  const src = text ?? "";
  if (windowSize <= 0) return src.length > 0 ? [src] : [];
  if (src.length <= windowSize) return src.length > 0 ? [src] : [];
  const step = Math.max(1, windowSize - Math.max(0, overlap));
  const out: string[] = [];
  for (let start = 0; start < src.length; start += step) {
    out.push(src.slice(start, start + windowSize));
    if (start + windowSize >= src.length) break;
  }
  return out;
}

/** The literal marker a map extraction returns when a source has nothing usable. */
export const NONE_MARKER = "NONE";

/** True when an extract is blank (incl. whitespace-only) or the "NONE" marker (case-insensitive). */
export function isEmptyExtract(extract: string | null | undefined): boolean {
  const trimmed = extract?.trim();
  if (!trimmed) return true;
  return trimmed.toUpperCase() === NONE_MARKER;
}

/**
 * Merge the per-window extract fragments for ONE source into a single extract.
 * Drops "NONE"/empty fragments, splits into lines, and de-duplicates lines
 * (preserving first-seen order) so overlap between adjacent windows doesn't
 * repeat a fact. Returns the {@link NONE_MARKER} when nothing usable remains, so
 * the caller (and the extract cache) can record the "nothing here" verdict.
 */
export function mergeWindowExtracts(fragments: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const frag of fragments) {
    if (isEmptyExtract(frag)) continue;
    for (const rawLine of frag.split("\n")) {
      const line = rawLine.replace(/\s+$/g, "");
      const key = line.trim().replace(/\s+/g, " ").toLowerCase();
      if (key.length === 0) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines.length > 0 ? lines.join("\n") : NONE_MARKER;
}

/**
 * Content-addressed fingerprint of a source's content — the cache invalidation
 * key. A change to the content changes the fingerprint, forcing re-extraction.
 */
export function fingerprintContent(content: string): string {
  return createHash("sha256").update(content ?? "", "utf8").digest("hex");
}

/**
 * Partition `items` into batches whose combined size (per `sizeOf`) stays under
 * `budget` and whose count stays at or below `maxCount`. A single item larger
 * than the budget still gets its own batch (never dropped). Used to bound each
 * reduce/consolidation LLM call when a node has many/large source extracts.
 */
export function partitionByBudget<T>(
  items: T[],
  sizeOf: (item: T) => number,
  budget: number,
  maxCount: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const item of items) {
    const size = Math.max(0, sizeOf(item));
    const wouldExceedBudget = current.length > 0 && currentSize + size > budget;
    const wouldExceedCount = current.length >= Math.max(1, maxCount);
    if (wouldExceedBudget || wouldExceedCount) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Run `worker` over `items` with at most `limit` concurrent executions,
 * preserving input order in the results. Keeps the fan-out of per-window /
 * per-source LLM calls bounded now that the caps are gone.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const bound = Math.max(1, limit);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(bound, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}
