import { useState } from "react";
import { ChevronDown, ChevronRight, BookOpen, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Per-message retrieval trace stored on assistant chat messages (Task #1925).
 * ADMIN-ONLY: the API only returns this field to requesters holding the
 * admin chat:view permission; members never receive it.
 */
export interface RetrievalTraceDoc {
  id: number;
  title: string;
  homeRoot: string | null;
  node: string | null;
  docClass: string | null;
  rank: number;
  semanticScore: number;
  grounded: boolean;
  clearedFloor: boolean;
}

export interface RetrievalTrace {
  version: 1;
  confident: boolean;
  usedInContext: boolean;
  topScore: number;
  topSemanticScore: number;
  lexicalFloor: number;
  semanticFloor: number;
  docs: RetrievalTraceDoc[];
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "0");

function DocRow({ doc, nearMiss }: { doc: RetrievalTraceDoc; nearMiss?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs ${
        nearMiss ? "border-dashed opacity-70" : ""
      }`}
      data-testid={`trace-doc-${doc.id}`}
    >
      <BookOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="font-medium">{doc.title}</span>
      {doc.docClass && <Badge variant="outline" className="text-[10px]">{doc.docClass}</Badge>}
      {(doc.homeRoot || doc.node) && (
        <span className="text-muted-foreground">
          {[doc.homeRoot, doc.node].filter(Boolean).join(" › ")}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 text-muted-foreground">
        {doc.grounded && <Badge variant="secondary" className="text-[10px]">nav-grounded</Badge>}
        <span title="Lexical ts_rank">lex {fmt(doc.rank)}</span>
        <span title="Semantic cosine similarity">sem {fmt(doc.semanticScore)}</span>
        {nearMiss && <Badge variant="outline" className="text-[10px]">below floor</Badge>}
      </span>
    </div>
  );
}

/** Admin-only expandable "Sources (N)" panel for one assistant message. */
export function RetrievalSourcesPanel({ trace }: { trace: RetrievalTrace | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [showNearMisses, setShowNearMisses] = useState(false);

  if (!trace || !Array.isArray(trace.docs)) return null;

  const used = trace.usedInContext ? trace.docs.filter((d) => d.clearedFloor) : [];
  const nearMisses = trace.docs.filter((d) => !used.includes(d));

  return (
    <div className="mt-2 rounded-md border bg-muted/30 text-xs" data-testid="retrieval-sources-panel">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        data-testid="retrieval-sources-toggle"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Sources ({used.length})
        <Badge variant={trace.confident ? "default" : "destructive"} className="ml-1 text-[10px]">
          {trace.confident ? "confident" : "below floor"}
        </Badge>
        <span className="ml-auto font-normal">
          top lex {fmt(trace.topScore)} / floor {fmt(trace.lexicalFloor)} · top sem {fmt(trace.topSemanticScore)} / floor{" "}
          {fmt(trace.semanticFloor)}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t px-2 py-2">
          {used.length === 0 && (
            <p className="text-muted-foreground">
              No documents were used in the answer context{trace.docs.length > 0 ? " — retrieval only found near-misses below the confidence floor." : "."}
            </p>
          )}
          {used.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
          {nearMisses.length > 0 && (
            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => setShowNearMisses((v) => !v)}
                data-testid="near-miss-toggle"
              >
                {showNearMisses ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                {showNearMisses ? "Hide" : "Show"} near-misses ({nearMisses.length})
              </Button>
              {showNearMisses && (
                <div className="mt-1.5 space-y-1.5">
                  {nearMisses.map((d) => (
                    <DocRow key={d.id} doc={d} nearMiss />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
