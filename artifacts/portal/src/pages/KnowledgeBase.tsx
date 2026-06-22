import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  BookOpen,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Zap,
  Library,
  BookMarked,
  Wrench,
  HelpCircle,
  GraduationCap,
  Users,
  Rocket,
  Bookmark,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import {
  BLITZ_PHASES,
  BLITZ_SECTIONS,
  type BlitzPhaseKey,
} from "@workspace/blitz-curriculum";

interface KBResult {
  id: number;
  title: string;
  category: string;
  sourcePath: string | null;
  sourceLabel: string | null;
  snippet: string;
  rank: number;
  isBookmarked?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  blitz: "Blitz Guide",
  resource: "Resource Library",
  glossary: "Glossary",
  tools: "Apps & Tools",
  faq: "FAQ",
  curriculum: "Training",
  coaching: "Coaching",
  sop: "Internal",
};

const CATEGORY_COLORS: Record<string, string> = {
  blitz: "bg-blue-100 text-blue-800 border-blue-200",
  resource: "bg-purple-100 text-purple-800 border-purple-200",
  glossary: "bg-amber-100 text-amber-800 border-amber-200",
  tools: "bg-teal-100 text-teal-800 border-teal-200",
  faq: "bg-green-100 text-green-800 border-green-200",
  curriculum: "bg-indigo-100 text-indigo-800 border-indigo-200",
  coaching: "bg-orange-100 text-orange-800 border-orange-200",
};

const CATEGORY_CARD_STYLES: Record<string, { icon: React.ElementType; bg: string; iconColor: string; border: string }> = {
  blitz:      { icon: Zap,           bg: "bg-blue-50",   iconColor: "text-blue-600",   border: "border-blue-200 hover:border-blue-400" },
  resource:   { icon: Library,       bg: "bg-purple-50", iconColor: "text-purple-600", border: "border-purple-200 hover:border-purple-400" },
  glossary:   { icon: BookMarked,    bg: "bg-amber-50",  iconColor: "text-amber-600",  border: "border-amber-200 hover:border-amber-400" },
  tools:      { icon: Wrench,        bg: "bg-teal-50",   iconColor: "text-teal-600",   border: "border-teal-200 hover:border-teal-400" },
  faq:        { icon: HelpCircle,    bg: "bg-green-50",  iconColor: "text-green-600",  border: "border-green-200 hover:border-green-400" },
  curriculum: { icon: GraduationCap, bg: "bg-indigo-50", iconColor: "text-indigo-600", border: "border-indigo-200 hover:border-indigo-400" },
  coaching:   { icon: Users,         bg: "bg-orange-50", iconColor: "text-orange-600", border: "border-orange-200 hover:border-orange-400" },
};

const ALL_CATEGORIES = ["blitz", "resource", "glossary", "tools", "faq", "curriculum", "coaching"];

const PHASE_FIRST_LESSON: Partial<Record<BlitzPhaseKey, number>> = Object.fromEntries(
  BLITZ_PHASES.map((phase) => {
    const first = BLITZ_SECTIONS.find((s) => s.phase === phase.key);
    return [phase.key, first?.id];
  }).filter(([, id]) => id !== undefined),
) as Partial<Record<BlitzPhaseKey, number>>;

const PHASE_DESCRIPTIONS: Record<BlitzPhaseKey, string> = {
  intro: "What affiliate arbitrage is and how the system works.",
  build: "Set up your campaign, creative assets, and go live.",
  test:  "Run structured testing rounds to find your winners.",
  scale: "Maximize your best placements and grow revenue.",
};

const START_HERE_LESSONS = BLITZ_SECTIONS.filter((s) => s.id <= 3);

interface KBSearchResponse {
  results: KBResult[];
  usedFallback: boolean;
}

async function searchKB(
  query: string,
  category: string | null,
): Promise<KBSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  if (category) params.set("category", category);
  const data = await customFetch<{ results?: KBResult[]; usedFallback?: boolean }>(
    `/api/kb/search?${params}`,
  );
  return { results: data.results ?? [], usedFallback: data.usedFallback ?? false };
}

async function browseKB(category: string): Promise<KBResult[]> {
  const params = new URLSearchParams({ category, limit: "30" });
  const data = await customFetch<{ results: KBResult[] }>(`/api/kb/browse?${params}`);
  return data.results ?? [];
}

async function fetchKBCounts(): Promise<Record<string, number>> {
  const data = await customFetch<{ counts: Record<string, number> }>(`/api/kb/counts`);
  return data.counts ?? {};
}

async function fetchBookmarks(): Promise<KBResult[]> {
  const data = await customFetch<{ results: KBResult[] }>(`/api/kb/bookmarks`);
  return data.results ?? [];
}

async function toggleBookmark(docId: number): Promise<boolean> {
  const data = await customFetch<{ isBookmarked: boolean }>(
    `/api/kb/bookmarks/${docId}`,
    { method: "POST" },
  );
  return data.isBookmarked;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

const HL_SPLIT_RE = /\[\[\[HL\]\]\]([\s\S]*?)\[\[\[\/HL\]\]\]/;

/**
 * Render a `ts_headline` snippet with the matched terms highlighted.
 * The API wraps matches in `[[[HL]]] … [[[/HL]]]` markers (chosen so they
 * survive HTML stripping). We strip any other tags for safety, then split on
 * the markers and wrap matched segments in <mark> — never injecting raw HTML.
 */
function renderSnippet(snippet: string) {
  const clean = stripHtmlTags(snippet);
  const parts = clean.split(HL_SPLIT_RE);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="bg-yellow-200/70 text-foreground rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ResultItem({
  result,
  isBookmarked,
  onToggleBookmark,
}: {
  result: KBResult;
  isBookmarked: boolean;
  onToggleBookmark: (result: KBResult) => void;
}) {
  const categoryLabel = result.sourceLabel ?? CATEGORY_LABELS[result.category] ?? result.category;
  const colorClass = CATEGORY_COLORS[result.category] ?? "bg-slate-100 text-slate-700 border-slate-200";

  const hasSnippet = stripHtmlTags(result.snippet).trim().length > 0;

  const bookmarkButton = (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleBookmark(result);
      }}
      aria-pressed={isBookmarked}
      aria-label={isBookmarked ? "Remove bookmark" : "Save article"}
      title={isBookmarked ? "Remove bookmark" : "Save for later"}
      className="shrink-0 mt-0.5 p-1 -m-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
    >
      <Bookmark
        className={`w-4 h-4 transition-colors ${
          isBookmarked ? "fill-primary text-primary" : ""
        }`}
      />
    </button>
  );

  const body = (
    <>
      <div className="mt-0.5 shrink-0">
        <BookOpen className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
            {result.title}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] font-medium shrink-0 border ${colorClass}`}
          >
            {categoryLabel}
          </Badge>
        </div>
        {hasSnippet && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {renderSnippet(result.snippet)}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="group flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/40 transition-all">
      {result.sourcePath ? (
        <Link href={result.sourcePath} className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-3 flex-1 min-w-0">{body}</div>
      )}
      {bookmarkButton}
    </div>
  );
}

function BrowseLanding({
  onSelectCategory,
  counts,
  bookmarks,
  bookmarkedIds,
  onToggleBookmark,
}: {
  onSelectCategory: (cat: string) => void;
  counts: Record<string, number> | null;
  bookmarks: KBResult[];
  bookmarkedIds: Set<number>;
  onToggleBookmark: (result: KBResult) => void;
}) {
  return (
    <div className="space-y-8">
      {bookmarks.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Bookmark className="w-4 h-4 text-primary fill-primary" />
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
              Saved articles
            </h2>
            <Badge variant="outline" className="text-[10px] border ml-1">
              {bookmarks.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {bookmarks.map((r) => (
              <ResultItem
                key={r.id}
                result={r}
                isBookmarked={bookmarkedIds.has(r.id)}
                onToggleBookmark={onToggleBookmark}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            New to BTS? Start here
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {START_HERE_LESSONS.map((lesson) => (
            <Link key={lesson.id} href={`/blitz/guide/${lesson.id}`}>
              <div className="group flex flex-col gap-1.5 p-4 rounded-lg border border-blue-200 bg-blue-50 hover:border-blue-400 hover:bg-blue-100 transition-all cursor-pointer">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">
                  Lesson {lesson.id}
                </span>
                <span className="text-sm font-medium text-blue-900 group-hover:text-blue-700 leading-snug">
                  {lesson.title}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-600 mt-auto self-end transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">
          Browse by category
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {ALL_CATEGORIES.map((cat) => {
            const style = CATEGORY_CARD_STYLES[cat];
            const Icon = style?.icon ?? BookOpen;
            const count = counts ? (counts[cat] ?? 0) : undefined;
            return (
              <button
                key={cat}
                onClick={() => onSelectCategory(cat)}
                className={`group flex flex-col items-start gap-2 p-4 rounded-lg border ${style?.border ?? "border-border hover:border-primary"} ${style?.bg ?? "bg-muted"} transition-all text-left`}
              >
                <Icon className={`w-5 h-5 ${style?.iconColor ?? "text-primary"}`} />
                <span className="text-sm font-medium text-foreground">
                  {CATEGORY_LABELS[cat] ?? cat}
                </span>
                {count !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {count} {count === 1 ? "article" : "articles"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Blitz phases
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BLITZ_PHASES.filter((p) => p.key !== "intro").map((phase) => {
            const firstLesson = PHASE_FIRST_LESSON[phase.key];
            if (firstLesson === undefined) return null;
            const lessonCount = BLITZ_SECTIONS.filter((s) => s.phase === phase.key).length;
            return (
              <Link key={phase.key} href={`/blitz/guide/${firstLesson}`}>
                <div
                  className="group flex items-start gap-3 p-4 rounded-lg border transition-all cursor-pointer hover:shadow-sm"
                  style={{
                    borderColor: `${phase.color}40`,
                    backgroundColor: `${phase.color}0d`,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = `${phase.color}99`;
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = `${phase.color}1a`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = `${phase.color}40`;
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = `${phase.color}0d`;
                  }}
                >
                  <div
                    className="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                    style={{ backgroundColor: phase.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground group-hover:opacity-80 transition-opacity">
                        {phase.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {lessonCount} lessons
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {PHASE_DESCRIPTIONS[phase.key]}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CategoryBrowse({
  category,
  onBack,
  bookmarkedIds,
  onToggleBookmark,
}: {
  category: string;
  onBack: () => void;
  bookmarkedIds: Set<number>;
  onToggleBookmark: (result: KBResult) => void;
}) {
  const [results, setResults] = useState<KBResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    browseKB(category)
      .then((res) => { if (!cancelled) { setResults(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError("Failed to load. Please try again."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [category]);

  const style = CATEGORY_CARD_STYLES[category];
  const Icon = style?.icon ?? BookOpen;
  const colorClass = CATEGORY_COLORS[category] ?? "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to browse
      </button>

      <div className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${style?.iconColor ?? "text-primary"}`} />
        <h2 className="text-lg font-semibold">
          {CATEGORY_LABELS[category] ?? category}
        </h2>
        {results && (
          <Badge variant="outline" className={`text-[10px] border ml-1 ${colorClass}`}>
            {results.length} {results.length === 1 ? "article" : "articles"}
          </Badge>
        )}
      </div>

      {loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-40" />
          <p className="text-sm">Loading…</p>
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && results && results.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No articles in this category yet.</p>
        </div>
      )}

      {!loading && results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <ResultItem
              key={r.id}
              result={r}
              isBookmarked={bookmarkedIds.has(r.id)}
              onToggleBookmark={onToggleBookmark}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBase() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [results, setResults] = useState<KBResult[] | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [bookmarks, setBookmarks] = useState<KBResult[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchKBCounts()
      .then((c) => { if (!cancelled) setCounts(c); })
      .catch(() => { /* counts are non-critical; cards render without them */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBookmarks()
      .then((res) => {
        if (cancelled) return;
        setBookmarks(res);
        setBookmarkedIds(new Set(res.map((r) => r.id)));
      })
      .catch(() => {
        /* non-fatal: bookmarks just won't show */
      });
    return () => { cancelled = true; };
  }, []);

  const handleToggleBookmark = useCallback((result: KBResult) => {
    // Optimistically flip based on the *latest* state (functional updates),
    // never a closure-bound snapshot, so rapid repeated clicks stay consistent.
    let optimisticallyBookmarked = false;
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(result.id)) {
        next.delete(result.id);
        optimisticallyBookmarked = false;
      } else {
        next.add(result.id);
        optimisticallyBookmarked = true;
      }
      return next;
    });
    setBookmarks((prev) =>
      prev.some((b) => b.id === result.id)
        ? prev.filter((b) => b.id !== result.id)
        : [{ ...result, isBookmarked: true }, ...prev],
    );

    const setBookmarkState = (isBookmarked: boolean) => {
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (isBookmarked) next.add(result.id);
        else next.delete(result.id);
        return next;
      });
      setBookmarks((prev) => {
        if (isBookmarked) {
          if (prev.some((b) => b.id === result.id)) return prev;
          return [{ ...result, isBookmarked: true }, ...prev];
        }
        return prev.filter((b) => b.id !== result.id);
      });
    };

    toggleBookmark(result.id)
      .then((isBookmarked) => setBookmarkState(isBookmarked))
      .catch(() => setBookmarkState(!optimisticallyBookmarked));
  }, []);

  const runSearch = useCallback((q: string, category: string | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults(null);
      setUsedFallback(false);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchKB(q.trim(), category);
        setResults(res.results);
        setUsedFallback(res.usedFallback);
        setSubmittedQuery(q.trim());
      } catch {
        setError("Search failed. Please try again.");
        setResults(null);
        setUsedFallback(false);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    if (value.trim().length >= 2) {
      setBrowseCategory(null);
    }
    runSearch(value, activeCategory);
  };

  const handleCategory = (cat: string | null) => {
    setActiveCategory(cat);
    runSearch(query, cat);
  };

  const handleBrowseCategory = (cat: string) => {
    setBrowseCategory(cat);
  };

  const handleBackToLanding = () => {
    setBrowseCategory(null);
  };

  const hasQuery = query.trim().length >= 2;
  const hasResults = results !== null && results.length > 0;
  const noResults = results !== null && results.length === 0;

  return (
    <AppLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Knowledge Base</h1>
          </div>
          <p className="text-muted-foreground">
            Search across Blitz lessons, glossary terms, resources, and training articles.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search lessons, glossary terms, resources…"
            className="pl-10 h-11 text-base"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
          )}
        </div>

        {hasQuery && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleCategory(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeCategory === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
              }`}
            >
              All
            </button>
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategory(cat === activeCategory ? null : cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                }`}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </button>
            ))}
          </div>
        )}

        {!hasQuery && !browseCategory && (
          <BrowseLanding
            onSelectCategory={handleBrowseCategory}
            counts={counts}
            bookmarks={bookmarks}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={handleToggleBookmark}
          />
        )}

        {!hasQuery && browseCategory && (
          <CategoryBrowse
            category={browseCategory}
            onBack={handleBackToLanding}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={handleToggleBookmark}
          />
        )}

        {hasQuery && loading && !hasResults && (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin opacity-40" />
            <p className="text-sm">Searching…</p>
          </div>
        )}

        {hasQuery && error && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {hasQuery && noResults && !loading && !error && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-base font-medium">No results for "{query}"</p>
            <p className="text-sm mt-1 opacity-70">
              Try a different term, or ask the{" "}
              <Link href="/ai-assistant" className="underline underline-offset-2 hover:text-primary">
                AI Assistant
              </Link>{" "}
              for help.
            </p>
          </div>
        )}

        {hasResults && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-xs text-muted-foreground">
                {results!.length} result{results!.length !== 1 ? "s" : ""} for "
                {submittedQuery}"
                {activeCategory ? ` in ${CATEGORY_LABELS[activeCategory] ?? activeCategory}` : ""}
              </p>
              {usedFallback && (
                <p className="text-xs text-muted-foreground italic opacity-70">
                  Showing approximate matches
                </p>
              )}
            </div>
            {results!.map((r) => (
              <ResultItem
                key={r.id}
                result={r}
                isBookmarked={bookmarkedIds.has(r.id)}
                onToggleBookmark={handleToggleBookmark}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
