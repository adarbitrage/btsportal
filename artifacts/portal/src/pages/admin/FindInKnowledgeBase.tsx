import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Search, FileSearch, CheckCircle2, XCircle, SendHorizonal, Loader2 } from "lucide-react";
import {
  kbFindSnippet,
  kbFindExtractClaims,
  kbFindCheckAnswer,
  sendAiLiveDocumentToReview,
  type KbFindResult,
  type KbFindClaim,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { hasPermission, isAdminRole, type AdminRole } from "@/lib/permissions";

function ResultCard({ result, forClaim, canSendToReview }: { result: KbFindResult; forClaim?: string; canSendToReview: boolean }) {
  const { toast } = useToast();
  const [note, setNote] = useState(
    `Fact-check via Find in Knowledge Base.\n\nMatched passage:\n"${result.matchedPassage}"` +
      (forClaim ? `\n\nChecked claim:\n"${forClaim}"` : ""),
  );
  const [composing, setComposing] = useState(false);

  const sendToReview = useMutation({
    mutationFn: () => sendAiLiveDocumentToReview(result.docId, note),
    onSuccess: (data) => {
      setComposing(false);
      toast({ title: "Sent to review", description: `Draft #${data.draftId} created in the review queue.` });
    },
    onError: (err: any) => {
      toast({
        title: "Could not send to review",
        description: err?.message || "This document may already have an open revision in the review queue.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`kb-find-result-${result.docId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{result.title}</span>
        <Badge variant={result.matchType === "exact" ? "default" : "secondary"} className="text-[10px]">
          {result.matchType === "exact" ? "Exact match" : `Fuzzy (${result.score.toFixed(3)})`}
        </Badge>
        {result.docClass && <Badge variant="outline" className="text-[10px]">{result.docClass}</Badge>}
        <span className="text-xs text-muted-foreground">
          {[result.homeRoot, result.node].filter(Boolean).join(" › ") || result.category}
        </span>
        {canSendToReview && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={() => setComposing((v) => !v)}
            data-testid={`send-to-review-${result.docId}`}
          >
            <SendHorizonal className="mr-1 h-3 w-3" /> Send to Review
          </Button>
        )}
      </div>
      <div
        className="text-sm text-muted-foreground [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-800 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5"
        dangerouslySetInnerHTML={{ __html: result.excerpt }}
      />
      {composing && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            Creates a revision draft of this live document in the review queue with your note attached. The live
            document is untouched until an approval is pushed.
          </p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="text-xs" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => sendToReview.mutate()} disabled={sendToReview.isPending}>
              {sendToReview.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Confirm
            </Button>
            <Button size="sm" variant="outline" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FindInKnowledgeBase() {
  const [mode, setMode] = useState<"snippet" | "answer">("snippet");
  const [snippet, setSnippet] = useState("");
  const [answer, setAnswer] = useState("");
  const [claims, setClaims] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { user } = useAuth();
  // "Send to Review" hits a chat:manage endpoint — hide it for view-only roles.
  const canSendToReview =
    !!user && isAdminRole(user.role) && hasPermission(user.role as AdminRole, "chat:manage");

  const snippetSearch = useMutation({
    mutationFn: (q: string) => kbFindSnippet(q),
  });
  const extractClaims = useMutation({
    mutationFn: (a: string) => kbFindExtractClaims(a),
    onSuccess: (data) => {
      setClaims(data.claims);
      setSelected(new Set(data.claims.map((_, i) => i)));
      answerCheck.reset();
    },
  });
  const answerCheck = useMutation({
    mutationFn: (selectedClaims: string[]) => kbFindCheckAnswer(selectedClaims),
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Find in Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">
            Trace where a statement came from. Searches the live citable corpus only — this page never edits
            documents.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant={mode === "snippet" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("snippet")}
            data-testid="mode-snippet"
          >
            <Search className="mr-1 h-4 w-4" /> Exact snippet
          </Button>
          <Button
            variant={mode === "answer" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("answer")}
            data-testid="mode-answer"
          >
            <FileSearch className="mr-1 h-4 w-4" /> Whole answer
          </Button>
        </div>

        {mode === "snippet" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Search for a snippet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Paste a sentence or phrase from an assistant answer…"
                value={snippet}
                onChange={(e) => setSnippet(e.target.value)}
                rows={3}
                data-testid="snippet-input"
              />
              <Button
                onClick={() => snippetSearch.mutate(snippet.trim())}
                disabled={!snippet.trim() || snippetSearch.isPending}
                data-testid="snippet-search-button"
              >
                {snippetSearch.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                Search
              </Button>

              {snippetSearch.isError && (
                <p className="text-sm text-destructive">{(snippetSearch.error as Error)?.message}</p>
              )}
              {snippetSearch.data && (
                <div className="space-y-2">
                  {snippetSearch.data.results.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="no-results">
                      No match in the live knowledge base — this snippet does not come from a citable document.
                    </p>
                  ) : (
                    snippetSearch.data.results.map((r) => (
                      <ResultCard key={r.docId} result={r} canSendToReview={canSendToReview} />
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check a whole answer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Paste the full assistant answer. It will be split into individual claims for you to review before checking…"
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setClaims(null);
                  answerCheck.reset();
                }}
                rows={8}
                data-testid="answer-input"
              />
              <Button
                onClick={() => extractClaims.mutate(answer)}
                disabled={!answer.trim() || extractClaims.isPending}
                data-testid="extract-claims-button"
              >
                {extractClaims.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSearch className="mr-1 h-4 w-4" />}
                Extract claims
              </Button>
              {extractClaims.isError && (
                <p className="text-sm text-destructive">{(extractClaims.error as Error)?.message}</p>
              )}

              {claims && (
                <div className="space-y-2 rounded-md border p-3" data-testid="claim-checklist">
                  {claims.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No checkable claims found — the answer may be too short or purely conversational.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          {selected.size} of {claims.length} claims selected
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() =>
                            setSelected(
                              selected.size === claims.length
                                ? new Set()
                                : new Set(claims.map((_, i) => i)),
                            )
                          }
                        >
                          {selected.size === claims.length ? "Deselect all" : "Select all"}
                        </Button>
                      </div>
                      {claims.map((c, i) => (
                        <label key={i} className="flex items-start gap-2 text-sm" data-testid={`claim-checkbox-${i}`}>
                          <Checkbox
                            checked={selected.has(i)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selected);
                              if (checked) next.add(i);
                              else next.delete(i);
                              setSelected(next);
                            }}
                            className="mt-0.5"
                          />
                          <span>{c}</span>
                        </label>
                      ))}
                      <Button
                        onClick={() => answerCheck.mutate(claims.filter((_, i) => selected.has(i)))}
                        disabled={selected.size === 0 || answerCheck.isPending}
                        data-testid="answer-check-button"
                      >
                        {answerCheck.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSearch className="mr-1 h-4 w-4" />}
                        Check selected claims
                      </Button>
                    </>
                  )}
                </div>
              )}

              {answerCheck.isError && (
                <p className="text-sm text-destructive">{(answerCheck.error as Error)?.message}</p>
              )}
              {answerCheck.data && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground" data-testid="claim-summary">
                    {answerCheck.data.supportedCount} of {answerCheck.data.claimCount} claims found support in the
                    live knowledge base.
                  </p>
                  {answerCheck.data.claims.map((c: KbFindClaim, i: number) => (
                    <div key={i} className="rounded-md border p-3 space-y-2" data-testid={`claim-${i}`}>
                      <div className="flex items-start gap-2">
                        {c.supported ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <p className="text-sm">{c.claim}</p>
                      </div>
                      {c.results.length > 0 && (
                        <div className="space-y-2 pl-6">
                          {c.results.map((r) => (
                            <ResultCard key={`${i}-${r.docId}`} result={r} forClaim={c.claim} canSendToReview={canSendToReview} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
