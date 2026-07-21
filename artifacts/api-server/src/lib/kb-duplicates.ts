/**
 * Duplicate grouping & live-corpus similarity (Task #1825).
 *
 * PURE helpers (unit-tested) that:
 *   1. normalize glossary-style titles ("What is X?") into concept keys that are
 *      tolerant of case, punctuation, dash, parenthetical and acronym-expansion
 *      variants ("LP Event CPC" vs "Landing-Page Event CPC (LP Event CPC)"),
 *   2. cluster needs-review staging drafts into likely-same-concept groups
 *      (title-key intersection, supplemented by content similarity),
 *   3. flag a pending draft that closely matches a non-deleted live AI document
 *      (normalized title or content similarity), excluding the draft's own
 *      explicit update target (update drafts intentionally match their target).
 *
 * Everything here is informational / review-aid only — nothing in this module
 * writes to the database or blocks approval.
 */

export interface DupDocInput {
  id: number;
  title: string;
  /** The draft's CURRENT text (editedContent ?? content). */
  content: string;
}

export interface LiveDocInput {
  id: number;
  title: string;
  content: string;
}

export interface LiveSimilarMatch {
  liveDocId: number;
  liveTitle: string;
  reason: "title" | "content";
  /** Content Jaccard similarity (0..1); 1 is reserved for exact-title matches. */
  similarity: number;
}

// Content-similarity thresholds. Clustering is stricter than the live-corpus
// indicator: merging drafts is a bigger action than an informational flag.
export const CLUSTER_CONTENT_SIM_THRESHOLD = 0.6;
export const LIVE_CONTENT_SIM_THRESHOLD = 0.45;

const LEADING_QUESTION_RE = /^\s*(?:what\s+(?:is|are)|what's)\s+/i;
const STOPWORDS = new Set(["the", "a", "an", "of"]);

/** Lowercase, strip the "What is …?" wrapper, punctuation/dashes, stopwords. */
export function normalizeConceptTitle(raw: string): string {
  let s = raw.replace(LEADING_QUESTION_RE, "");
  s = s.toLowerCase();
  // Dashes/slashes/punctuation → spaces (keeps token boundaries: "landing-page"
  // → "landing page").
  s = s.replace(/[^a-z0-9]+/g, " ");
  const tokens = s.split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
  return tokens.join(" ");
}

function extractParentheticals(raw: string): { base: string; parens: string[] } {
  const parens: string[] = [];
  const base = raw.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    if (inner.trim()) parens.push(inner.trim());
    return " ";
  });
  return { base, parens };
}

/**
 * Acronym-collapse variants: for a normalized key's tokens, additionally emit
 * variants where a contiguous run of 2–4 tokens is collapsed to its initials.
 * "landing page event cpc" → "lp event cpc" (run [landing,page] → "lp"), so an
 * expansion clusters with its literal acronym even without a parenthetical.
 */
function acronymCollapseVariants(key: string): string[] {
  const tokens = key.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 12) return [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let len = 2; len <= 4 && i + len <= tokens.length; len++) {
      // Never collapse the WHOLE title into one bare initialism ("ad angle" →
      // "aa") — full-title initials collide across unrelated concepts.
      if (len === tokens.length) continue;
      const initials = tokens
        .slice(i, i + len)
        .map((t) => t[0])
        .join("");
      const variant = [...tokens.slice(0, i), initials, ...tokens.slice(i + len)].join(" ");
      out.push(variant);
    }
  }
  return out;
}

/**
 * All normalized concept keys a title can be known by: the base title (without
 * parentheticals), each parenthetical on its own, the full title, plus
 * acronym-collapse variants of each. Two titles refer to the same concept when
 * their key sets intersect.
 */
export function conceptKeys(rawTitle: string): Set<string> {
  const { base, parens } = extractParentheticals(rawTitle);
  const keys = new Set<string>();
  const primary = [normalizeConceptTitle(base), normalizeConceptTitle(rawTitle), ...parens.map((p) => normalizeConceptTitle(p))].filter(Boolean);
  for (const k of primary) {
    keys.add(k);
    for (const v of acronymCollapseVariants(k)) keys.add(v);
  }
  return keys;
}

export function keysIntersect(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const k of small) if (large.has(k)) return true;
  return false;
}

// ── Content similarity ────────────────────────────────────────────────────────

function contentShingles(content: string): Set<string> {
  const tokens = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const set = new Set<string>();
  if (tokens.length < 5) {
    for (const t of tokens) set.add(t);
    return set;
  }
  for (let i = 0; i + 3 <= tokens.length; i++) {
    set.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return set;
}

export function contentSimilarity(a: string, b: string): number {
  const sa = contentShingles(a);
  const sb = contentShingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const s of small) if (large.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// ── Clustering ────────────────────────────────────────────────────────────────

export interface DupCluster {
  /** Representative concept key (shortest base key in the cluster). */
  key: string;
  docIds: number[];
}

/**
 * Group docs into likely-same-concept clusters (union-find). Two docs join
 * when their title concept-keys intersect, or their content similarity clears
 * CLUSTER_CONTENT_SIM_THRESHOLD. Singleton clusters are dropped — only docs
 * with at least one likely duplicate are returned.
 */
export function clusterDuplicates(docs: DupDocInput[]): DupCluster[] {
  const n = docs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const keySets = docs.map((d) => conceptKeys(d.title));
  const shingleCache = docs.map((d) => contentShingles(d.content));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (keysIntersect(keySets[i], keySets[j])) {
        union(i, j);
        continue;
      }
      const sa = shingleCache[i];
      const sb = shingleCache[j];
      if (sa.size === 0 || sb.size === 0) continue;
      let inter = 0;
      const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
      for (const s of small) if (large.has(s)) inter++;
      const sim = inter / (sa.size + sb.size - inter);
      if (sim >= CLUSTER_CONTENT_SIM_THRESHOLD) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const clusters: DupCluster[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    // Representative key: shortest normalized base title in the cluster.
    let key = "";
    for (const i of idxs) {
      const base = normalizeConceptTitle(extractParentheticals(docs[i].title).base);
      if (base && (key === "" || base.length < key.length)) key = base;
    }
    clusters.push({
      key: key || normalizeConceptTitle(docs[idxs[0]].title),
      docIds: idxs.map((i) => docs[i].id).sort((a, b) => a - b),
    });
  }
  clusters.sort((a, b) => b.docIds.length - a.docIds.length || a.key.localeCompare(b.key));
  return clusters;
}

// ── Live-corpus similarity ────────────────────────────────────────────────────

/**
 * Best "similar live doc" match for a pending draft, or null. Title-key
 * intersection wins over content similarity; the draft's own explicit update
 * target is always excluded (an update draft intentionally matches its target).
 * Informational only — never blocks approval, never touches the live doc.
 */
export function findLiveSimilar(
  draft: { title: string; content: string; targetLiveDocId?: number | null },
  liveDocs: LiveDocInput[],
): LiveSimilarMatch | null {
  const draftKeys = conceptKeys(draft.title);
  let best: LiveSimilarMatch | null = null;
  for (const live of liveDocs) {
    if (draft.targetLiveDocId != null && live.id === draft.targetLiveDocId) continue;
    if (keysIntersect(draftKeys, conceptKeys(live.title))) {
      return { liveDocId: live.id, liveTitle: live.title, reason: "title", similarity: 1 };
    }
    const sim = contentSimilarity(draft.content, live.content);
    if (sim >= LIVE_CONTENT_SIM_THRESHOLD && (best === null || sim > best.similarity)) {
      best = { liveDocId: live.id, liveTitle: live.title, reason: "content", similarity: Math.round(sim * 100) / 100 };
    }
  }
  return best;
}
