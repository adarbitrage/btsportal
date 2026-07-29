import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  addGlossaryTerm,
  deleteGlossaryTerm,
  fetchGlossaryTerms,
  generateGlossaryBatch,
  regenerateGlossaryTerm,
  updateGlossaryTerm,
  type GlossaryTerm,
} from "@/lib/resource-hub-api";

/**
 * Resource Hub → Glossary review page (Task #2028).
 * AI drafts definitions grounded in the Live AI Docs corpus; a human approves
 * each term before it renders on the member hub. Reviewer edits always win.
 */
export default function ResourceHubGlossary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-resource-hub-glossary"],
    queryFn: fetchGlossaryTerms,
  });
  const [newTerm, setNewTerm] = useState("");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const terms = data?.terms ?? [];
  const draftCount = terms.filter((t) => t.status === "draft").length;
  const emptyCount = terms.filter((t) => t.status === "draft" && !t.definition).length;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-resource-hub-glossary"] });
    void queryClient.invalidateQueries({ queryKey: ["resource-hub"] });
  };

  const onError = (err: unknown) =>
    toast({
      title: "Action failed",
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    });

  const generateMutation = useMutation({
    mutationFn: generateGlossaryBatch,
    onSuccess: (result) => {
      invalidate();
      toast({
        title: `Drafted ${result.generated} definition${result.generated === 1 ? "" : "s"}`,
        description:
          result.remaining > 0
            ? `${result.remaining} term${result.remaining === 1 ? "" : "s"} still need drafts — run again.`
            : "All terms have drafts. Review and approve below.",
      });
    },
    onError,
  });

  const addMutation = useMutation({
    mutationFn: (term: string) => addGlossaryTerm(term),
    onSuccess: () => {
      setNewTerm("");
      invalidate();
    },
    onError,
  });

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      invalidate();
    } catch (err) {
      onError(err);
    } finally {
      setBusyId(null);
    }
  };

  const saveAndSetStatus = (t: GlossaryTerm, status: GlossaryTerm["status"]) => {
    const definition = edits[t.id] !== undefined ? edits[t.id] : t.definition;
    return act(t.id, () => updateGlossaryTerm(t.id, { definition, status }));
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold">Resource Hub — Glossary</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              AI drafts definitions from the Live AI Docs corpus. Only approved terms appear on the member hub —
              your edits always win over generated text.
            </p>
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || emptyCount === 0}
            data-testid="button-generate-batch"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {emptyCount > 0 ? `Draft definitions (${emptyCount} empty)` : "All terms drafted"}
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            placeholder="Add a term manually…"
            className="max-w-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTerm.trim()) addMutation.mutate(newTerm.trim());
            }}
            data-testid="input-new-term"
          />
          <Button
            variant="outline"
            onClick={() => newTerm.trim() && addMutation.mutate(newTerm.trim())}
            disabled={addMutation.isPending || !newTerm.trim()}
            data-testid="button-add-term"
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add
          </Button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading glossary…
          </div>
        )}
        {isError && <p className="text-sm text-destructive py-8">Couldn't load the glossary.</p>}

        {!isLoading && !isError && (
          <>
            <p className="text-sm text-muted-foreground">
              {terms.length} terms · {terms.filter((t) => t.status === "approved").length} approved · {draftCount} draft
            </p>
            <div className="space-y-3">
              {terms.map((t) => (
                <Card key={t.id} className="border-border/60" data-testid={`card-glossary-term-${t.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate">{t.term}</h3>
                        <Badge
                          variant={t.status === "approved" ? "default" : t.status === "rejected" ? "destructive" : "secondary"}
                          data-testid={`badge-status-${t.id}`}
                        >
                          {t.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          title="Regenerate draft"
                          onClick={() => act(t.id, () => regenerateGlossaryTerm(t.id))}
                          disabled={busyId === t.id || t.status === "approved"}
                          data-testid={`button-regenerate-${t.id}`}
                        >
                          {busyId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-destructive"
                          title="Delete term"
                          onClick={() => act(t.id, () => deleteGlossaryTerm(t.id))}
                          disabled={busyId === t.id}
                          data-testid={`button-delete-term-${t.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={edits[t.id] !== undefined ? edits[t.id] : t.definition}
                      onChange={(e) => setEdits({ ...edits, [t.id]: e.target.value })}
                      rows={2}
                      placeholder="No definition yet — draft with AI or write one here."
                      data-testid={`input-definition-${t.id}`}
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => saveAndSetStatus(t, "approved")}
                        disabled={busyId === t.id || !(edits[t.id] !== undefined ? edits[t.id] : t.definition).trim()}
                        data-testid={`button-approve-${t.id}`}
                      >
                        <Check className="w-3.5 h-3.5 mr-1.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveAndSetStatus(t, "rejected")}
                        disabled={busyId === t.id}
                        data-testid={`button-reject-${t.id}`}
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" /> Reject
                      </Button>
                      {edits[t.id] !== undefined && edits[t.id] !== t.definition && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => saveAndSetStatus(t, t.status)}
                          disabled={busyId === t.id}
                          data-testid={`button-save-definition-${t.id}`}
                        >
                          Save edit
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
