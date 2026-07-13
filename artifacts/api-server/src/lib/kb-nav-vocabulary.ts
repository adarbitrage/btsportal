/**
 * Navigation coverage vocabulary (Task #1776).
 *
 * The FIXED, code-defined app vocabulary that governs navigation-gap flagging
 * and the Navigation Docs authoring page. Canonical names match the house-term
 * alias map spellings in transcript-cleaner.ts (Flexy, DIYTrax, MetricMover,
 * PixelPress, CropBot, ScrapeBot, MediaMavens, Caterpillar …).
 *
 * Three buckets:
 *  - Tier 1: core stack apps — flag navigation gaps normally.
 *  - Tier 2: secondary apps — flag at lower priority.
 *  - Ignore list: retired/commentary networks (MaxWeb, Affiliati, Taboola,
 *    Outbrain) — must NEVER generate gaps, even when action verbs
 *    fire around them.
 * Everything else (Zoom, Gmail, Canva, ChatGPT, …) is simply not in the
 * vocabulary and is never flagged.
 *
 * This is a pure code registry (kb-tool-tags "code baseline as authority"
 * pattern). No DB-managed additions exist today; if they ever do, expose the
 * merged vocabulary via a call-time getter — never a module-level snapshot.
 */

export type NavAppTier = 1 | 2;

export interface NavApp {
  /** Stable slug used as the flag/doc coverage key. */
  slug: string;
  /** Canonical display name (house-term spelling). */
  label: string;
  tier: NavAppTier;
  /** Lower-cased phrases that identify the app in transcript/extract text. */
  triggers: readonly string[];
  /** Suggested area labels, seeded from Blitz lesson titles. Free-form — the
   *  flagger proposes areas; these just seed the authoring UI + area matching. */
  suggestedAreas: readonly string[];
}

export const NAV_APPS: readonly NavApp[] = [
  {
    slug: "portal",
    label: "BTS Member Portal",
    tier: 1,
    triggers: ["member portal", "bts portal", "the portal", "members area", "member's area"],
    suggestedAreas: ["dashboard", "blitz training", "coaching calls", "book a session", "community", "support tickets", "account settings"],
  },
  {
    slug: "flexy",
    label: "Flexy",
    tier: 1,
    triggers: ["flexy", "flexi", "flexie", "flexxy", "flexey"],
    suggestedAreas: ["clone website", "connect domain", "custom values", "media upload", "page editor", "publish site"],
  },
  {
    slug: "diytrax",
    label: "DIYTrax",
    tier: 1,
    triggers: ["diytrax", "diy trax", "diy tracks", "diytracks"],
    suggestedAreas: ["campaign setup", "ipn integration", "offer links", "csv import", "reporting", "postback setup"],
  },
  {
    slug: "metricmover",
    label: "MetricMover",
    tier: 1,
    triggers: ["metricmover", "metric mover"],
    suggestedAreas: ["import data", "export data", "column mapping", "scheduled transfers"],
  },
  {
    slug: "clickbank",
    label: "ClickBank",
    tier: 1,
    triggers: ["clickbank", "click bank"],
    suggestedAreas: ["account setup", "marketplace", "hoplinks", "tracking ids", "reporting"],
  },
  {
    slug: "media-mavens",
    label: "MediaMavens",
    tier: 1,
    triggers: ["media mavens", "mediamavens", "media maven"],
    suggestedAreas: ["account setup", "offer selection", "affiliate links", "reporting"],
  },
  {
    slug: "caterpillar",
    label: "Caterpillar",
    tier: 1,
    triggers: ["caterpillar", "catapiller", "caterpiller", "catterpillar"],
    suggestedAreas: ["campaign creation", "ad upload", "budget settings", "targeting", "reporting"],
  },
  {
    slug: "grasshopper",
    label: "Grasshopper",
    tier: 1,
    triggers: ["grasshopper", "grass hopper"],
    suggestedAreas: ["campaign creation", "ad upload", "budget settings", "targeting", "reporting"],
  },
  {
    slug: "crane",
    label: "Crane",
    tier: 1,
    triggers: ["crane"],
    suggestedAreas: ["campaign creation", "ad upload", "budget settings", "targeting", "reporting"],
  },
  {
    slug: "cropbot",
    label: "CropBot",
    tier: 1,
    triggers: ["cropbot", "crop bot"],
    suggestedAreas: ["image upload", "crop sizes", "batch export"],
  },
  {
    slug: "pixelpress",
    label: "PixelPress",
    tier: 1,
    triggers: ["pixelpress", "pixel press"],
    suggestedAreas: ["image editing", "resize", "export"],
  },
  {
    slug: "scrapebot",
    label: "ScrapeBot",
    tier: 1,
    triggers: ["scrapebot", "scrape bot"],
    suggestedAreas: ["scrape setup", "export results"],
  },
  {
    slug: "affiliate-cmo",
    label: "AffiliateCMO",
    tier: 2,
    triggers: ["affiliatecmo", "affiliate cmo"],
    suggestedAreas: ["account setup", "generate copy"],
  },
  {
    slug: "freeadcopy",
    label: "FreeAdCopy",
    tier: 2,
    triggers: ["freeadcopy", "free ad copy"],
    suggestedAreas: ["generate copy", "export copy"],
  },
] as const;

export const NAV_APP_SLUGS: readonly string[] = NAV_APPS.map((a) => a.slug);

const NAV_APP_BY_SLUG: ReadonlyMap<string, NavApp> = new Map(NAV_APPS.map((a) => [a.slug, a]));

export function isNavApp(value: unknown): value is string {
  return typeof value === "string" && NAV_APP_BY_SLUG.has(value);
}

export function resolveNavApp(slug: string | null | undefined): NavApp | null {
  return slug ? NAV_APP_BY_SLUG.get(slug) ?? null : null;
}

/**
 * Explicit ignore list — retired networks / commentary-only mentions. These are
 * recognised (so tests can prove suppression) but never produce a gap flag.
 */
export const NAV_IGNORED_APPS: readonly { label: string; triggers: readonly string[] }[] = [
  { label: "MaxWeb",    triggers: ["maxweb", "max web"] },
  { label: "Affiliati", triggers: ["affiliati"] },
  { label: "Taboola",   triggers: ["taboola"] },
  { label: "Outbrain",  triggers: ["outbrain"] },
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Action-verb gated detection.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Member-performed action verbs. A mere app MENTION never flags; the app name
 * must co-occur (within a window) with one of these, or with dense
 * click/navigate transcript language.
 */
const ACTION_VERBS = [
  "clone", "cloning", "connect", "connecting", "import", "importing",
  "upload", "uploading", "configure", "configuring", "set up", "setting up",
  "setup", "log into", "log in to", "login to", "sign into", "sign in to",
  "paste", "pasting", "export", "exporting", "install", "create an account",
  "enter your", "fill in", "fill out", "submit",
] as const;

/** Dense demonstrative navigation language — a strong trigger on its own. */
const CLICK_LANGUAGE = [
  "click", "go to", "head over to", "navigate to", "open up", "tab", "menu",
  "button", "dropdown", "drop-down", "scroll down", "top right", "top left",
  "left-hand side", "right-hand side", "settings icon",
] as const;

/** Window (chars) around an app-name hit inside which a verb/click term counts. */
const CONTEXT_WINDOW = 240;
/** Minimum distinct click-language terms in-window to count as "dense". */
const DENSE_CLICK_MIN = 3;

function findTriggerIndices(haystack: string, trigger: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(trigger);
  while (i !== -1) {
    // crude word-boundary check to avoid e.g. "crane" inside another word
    const before = haystack[i - 1];
    const after = haystack[i + trigger.length];
    const boundaryBefore = i === 0 || !/[a-z0-9]/.test(before ?? "");
    const boundaryAfter = !after || !/[a-z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) out.push(i);
    i = haystack.indexOf(trigger, i + trigger.length);
  }
  return out;
}

export interface NavActionHit {
  app: NavApp;
  /** Trimmed evidence snippet around the strongest hit. */
  evidence: string;
  /** Best-matching suggested area for the app (keyword match), or null. */
  area: string | null;
}

/**
 * Detect member-performed actions in vocabulary apps within a text. Action-verb
 * gated: an app name only counts when an action verb appears within the
 * context window, OR the window carries dense click/navigate language
 * (>= DENSE_CLICK_MIN distinct terms). Ignore-listed apps never match.
 * Returns at most one hit per app (the strongest window).
 */
export function detectNavActions(text: string): NavActionHit[] {
  const lower = (text ?? "").toLowerCase();
  if (!lower) return [];
  const hits: NavActionHit[] = [];

  for (const app of NAV_APPS) {
    let best: { score: number; idx: number } | null = null;
    for (const trigger of app.triggers) {
      for (const idx of findTriggerIndices(lower, trigger)) {
        const start = Math.max(0, idx - CONTEXT_WINDOW);
        const end = Math.min(lower.length, idx + trigger.length + CONTEXT_WINDOW);
        const window = lower.slice(start, end);
        const verbHit = ACTION_VERBS.some((v) => window.includes(v));
        const clickCount = CLICK_LANGUAGE.filter((c) => window.includes(c)).length;
        const gated = verbHit || clickCount >= DENSE_CLICK_MIN;
        if (!gated) continue;
        const score = (verbHit ? 10 : 0) + clickCount;
        if (!best || score > best.score) best = { score, idx };
      }
    }
    if (best) {
      const start = Math.max(0, best.idx - 80);
      const end = Math.min(lower.length, best.idx + 160);
      const evidence = text.slice(start, end).replace(/\s+/g, " ").trim();
      hits.push({ app, evidence, area: matchSuggestedArea(app, lower, best.idx) });
    }
  }
  return hits;
}

/**
 * Best-matching suggested area near an app hit: the suggested-area label with
 * the most keyword overlap inside a wide window around the hit. Null when
 * nothing matches (the flag then aggregates under the app's "general" area).
 */
function matchSuggestedArea(app: NavApp, lower: string, idx: number): string | null {
  const start = Math.max(0, idx - 600);
  const end = Math.min(lower.length, idx + 600);
  const window = lower.slice(start, end);
  let best: { area: string; score: number } | null = null;
  for (const area of app.suggestedAreas) {
    const words = area.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const score = words.filter((w) => window.includes(w)).length / words.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { area, score };
  }
  return best?.area ?? null;
}

/** Fallback area label when the flagger can't propose a specific one. */
export const NAV_GENERAL_AREA = "general";

/** Normalize a free-form area label for use as an aggregation key. */
export function normalizeNavArea(area: string | null | undefined): string {
  const a = (area ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return a || NAV_GENERAL_AREA;
}
