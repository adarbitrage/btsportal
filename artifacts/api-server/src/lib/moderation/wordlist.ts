import { db } from "@workspace/db";
import { moderationWordlistTable } from "@workspace/db";

export interface WordlistMatch {
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
}

interface CachedEntry {
  id: number;
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
}

let cache: CachedEntry[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

async function loadWordlist(): Promise<CachedEntry[]> {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;
  const rows = await db.select().from(moderationWordlistTable);
  cache = rows.map((r) => ({
    id: r.id,
    word: r.word,
    category: r.category,
    severity: r.severity as "HARD" | "SOFT",
  }));
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

export function invalidateWordlistCache(): void {
  cache = null;
  cacheExpiry = 0;
}

export async function scanContent(body: string): Promise<WordlistMatch[]> {
  const wordlist = await loadWordlist();
  const lower = body.toLowerCase();
  const matches: WordlistMatch[] = [];

  for (const entry of wordlist) {
    const w = entry.word;
    const isAlphaOnly = /^[a-z]+$/.test(w);
    let found = false;
    if (isAlphaOnly) {
      const regex = new RegExp(`\\b${w}\\b`, "i");
      found = regex.test(lower);
    } else {
      found = lower.includes(w);
    }
    if (found) {
      matches.push({ word: w, category: entry.category, severity: entry.severity });
    }
  }

  return matches;
}
