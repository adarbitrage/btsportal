import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Archive,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  FileText,
} from "lucide-react";
import { fetchKbArchiveDocs, type KbArchiveDoc } from "@/lib/admin-api";

// Read-only archive of the old staging review queue. No pipeline, no AI
// analysis, no writes — it exists purely so the old drafts can be browsed
// later and anything worth keeping can be copied out by hand.
export default function KnowledgeBaseArchive() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-kb-archive"],
    queryFn: fetchKbArchiveDocs,
  });

  const docs = data?.docs ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => d.category && set.add(d.category));
    return Array.from(set).sort();
  }, [docs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q) ||
        d.sourceVideoTitle.toLowerCase().includes(q)
      );
    });
  }, [docs, search, category]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Archive className="w-6 h-6" />
            Archived Review Drafts
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            A frozen, read-only backup of the old document-review queue. These
            drafts are no longer part of the live knowledge base or the review
            pipeline — they are kept here only so you can look back through them
            and reuse anything worthwhile. Nothing here affects the assistant.
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, content, or source…"
                className="pl-9"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading archive…
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Failed to load the archive.
            </CardContent>
          </Card>
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              The archive is empty.
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {filtered.length} of {docs.length} archived draft
              {docs.length !== 1 ? "s" : ""}.
            </p>
            <div className="space-y-2">
              {filtered.map((doc) => (
                <ArchiveCard
                  key={doc.id}
                  doc={doc}
                  open={expanded.has(doc.id)}
                  onToggle={() => toggle(doc.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function ArchiveCard({
  doc,
  open,
  onToggle,
}: {
  doc: KbArchiveDoc;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={onToggle}
          className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/40 transition-colors"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 mt-1 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 mt-1 flex-shrink-0 text-muted-foreground" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">{doc.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {doc.category && <Badge variant="secondary">{doc.category}</Badge>}
              {doc.source && <Badge variant="outline">{doc.source}</Badge>}
              {doc.status && <Badge variant="outline">{doc.status}</Badge>}
              {doc.sourceVideoTitle && (
                <span className="text-xs text-muted-foreground truncate">
                  from: {doc.sourceVideoTitle}
                </span>
              )}
            </div>
          </div>
        </button>
        {open && (
          <div className="px-4 pb-4 pl-11">
            <pre className="whitespace-pre-wrap break-words text-sm text-foreground/90 bg-muted/40 rounded-md p-3 max-h-[28rem] overflow-y-auto font-sans">
              {doc.content || "(no content)"}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
