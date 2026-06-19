import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Loader2, ChevronRight } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";


interface KBResult {
  id: number;
  title: string;
  category: string;
  sourcePath: string | null;
  sourceLabel: string | null;
  snippet: string;
  rank: number;
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

const ALL_CATEGORIES = ["blitz", "resource", "glossary", "tools", "faq", "curriculum", "coaching"];

async function searchKB(query: string, category: string | null): Promise<KBResult[]> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  if (category) params.set("category", category);
  const data = await customFetch<{ results: KBResult[] }>(`/api/kb/search?${params}`);
  return data.results ?? [];
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function ResultItem({ result }: { result: KBResult }) {
  const categoryLabel = result.sourceLabel ?? CATEGORY_LABELS[result.category] ?? result.category;
  const colorClass = CATEGORY_COLORS[result.category] ?? "bg-slate-100 text-slate-700 border-slate-200";

  const cleanSnippet = stripHtmlTags(result.snippet);

  const content = (
    <div className="group flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/40 transition-all cursor-pointer">
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
        {cleanSnippet && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {cleanSnippet}
          </p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
    </div>
  );

  if (result.sourcePath) {
    return (
      <Link href={result.sourcePath}>
        {content}
      </Link>
    );
  }

  return content;
}

export default function KnowledgeBase() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [results, setResults] = useState<KBResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runSearch = useCallback((q: string, category: string | null) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchKB(q.trim(), category);
        setResults(res);
      } catch {
        setError("Search failed. Please try again.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    runSearch(value, activeCategory);
  };

  const handleCategory = (cat: string | null) => {
    setActiveCategory(cat);
    runSearch(query, cat);
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

        {!hasQuery && (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-base font-medium">Start typing to search</p>
            <p className="text-sm mt-1 opacity-70">
              Find Blitz lessons, glossary definitions, resources, and training articles.
            </p>
          </div>
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
            <p className="text-xs text-muted-foreground">
              {results!.length} result{results!.length !== 1 ? "s" : ""}
              {activeCategory ? ` in ${CATEGORY_LABELS[activeCategory] ?? activeCategory}` : ""}
            </p>
            {results!.map((r) => (
              <ResultItem key={r.id} result={r} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
