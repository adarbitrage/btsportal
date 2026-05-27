import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Search,
  Tag,
  AlertTriangle,
  ChevronLeft,
  Bot,
  Loader2,
} from "lucide-react";
import {
  useAdminKbDocs,
  useAdminGenerateQuestions,
  useAdminCreateAssistantQuestion,
  type KbDoc,
  type GenerateQuestionsCandidate,
} from "@/lib/admin-api";

type Step = "pick" | "count" | "generate" | "review";
type PickMode = "docs" | "tags";

interface CandidateRow {
  candidate: GenerateQuestionsCandidate;
  checked: boolean;
  editedBody: string;
  editing: boolean;
}

const PROGRESS_MESSAGES = [
  "Claude is generating candidate questions…",
  "Verifying candidates against knowledge base…",
  "Ranking by retrieval confidence…",
  "Finalising results…",
];

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 85
      ? "bg-green-100 text-green-800 border-green-200"
      : pct >= 65
        ? "bg-yellow-100 text-yellow-800 border-yellow-200"
        : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${color}`}
    >
      {value.toFixed(2)}
    </span>
  );
}

function KbDocPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: docs = [], isLoading } = useAdminKbDocs(search || undefined);

  function toggle(id: number) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  const grouped = docs.reduce<Record<string, KbDoc[]>>((acc, doc) => {
    const cat = doc.category || "Uncategorized";
    (acc[cat] ??= []).push(doc);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8"
          placeholder="Search documents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ScrollArea className="h-56 rounded-md border">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading documents…
          </div>
        ) : docs.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {search ? "No documents match your search." : "No KB documents found."}
          </p>
        ) : (
          <div className="p-2 space-y-3">
            {Object.entries(grouped).map(([category, catDocs]) => (
              <div key={category}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                  {category}
                </p>
                <div className="space-y-1">
                  {catDocs.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.includes(doc.id)}
                        onCheckedChange={() => toggle(doc.id)}
                      />
                      <span className="text-sm truncate">{doc.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      {selectedIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedIds.length} document{selectedIds.length !== 1 ? "s" : ""} selected
        </p>
      )}
    </div>
  );
}

function TagPicker({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Enter a tag and press Add…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addTag} disabled={!input.trim()}>
          Add
        </Button>
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1 cursor-pointer"
              onClick={() => removeTag(tag)}
            >
              <Tag className="w-3 h-3" />
              {tag}
              <span className="ml-0.5 text-muted-foreground">×</span>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No tags added yet.</p>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  cardId: number;
}

export function GenerateQuestionsModal({ open, onClose, cardId }: Props) {
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("pick");
  const [pickMode, setPickMode] = useState<PickMode>("docs");
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [targetCount, setTargetCount] = useState(30);
  const [progressIndex, setProgressIndex] = useState(0);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const generateMutation = useAdminGenerateQuestions();
  const createQuestion = useAdminCreateAssistantQuestion();

  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  function resetState() {
    setStep("pick");
    setPickMode("docs");
    setSelectedDocIds([]);
    setSelectedTags([]);
    setTargetCount(30);
    setProgressIndex(0);
    setCandidates([]);
    setWarning(undefined);
    setIsSaving(false);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function handleClose() {
    abortRef.current = true;
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    generateMutation.reset();
    resetState();
    onClose();
  }

  useEffect(() => {
    if (!open) resetState();
  }, [open]);

  async function handleGenerate() {
    abortRef.current = false;
    setStep("generate");
    setProgressIndex(0);

    progressTimerRef.current = setInterval(() => {
      setProgressIndex((p) => Math.min(p + 1, PROGRESS_MESSAGES.length - 1));
    }, 3500);

    try {
      const result = await generateMutation.mutateAsync({
        cardId,
        kbDocIds: pickMode === "docs" ? selectedDocIds : [],
        kbTags: pickMode === "tags" ? selectedTags : [],
        targetCount,
      });

      if (abortRef.current) return;

      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }

      setWarning(result.warning);
      setCandidates(
        result.candidates.map((c) => ({
          candidate: c,
          checked: true,
          editedBody: c.question_text,
          editing: false,
        })),
      );
      setStep("review");
    } catch (err) {
      if (abortRef.current) return;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      setStep("count");
    }
  }

  async function handleSave() {
    const toSave = candidates.filter((r) => r.checked);
    if (toSave.length === 0) {
      toast({ title: "No questions selected", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    let saved = 0;
    let failed = 0;

    for (const row of toSave) {
      try {
        await createQuestion.mutateAsync({
          cardId,
          body: row.editedBody.trim() || row.candidate.question_text,
          generatedBy: "ai",
          retrievalConfidence: row.candidate.retrieval_confidence,
          sourceKbDocIds: row.candidate.source_kb_doc_ids,
        });
        saved++;
      } catch {
        failed++;
      }
    }

    setIsSaving(false);

    if (failed === 0) {
      toast({ title: `${saved} question${saved !== 1 ? "s" : ""} added` });
      handleClose();
    } else {
      toast({
        title: `${saved} saved, ${failed} failed`,
        description: "Some questions could not be saved.",
        variant: "destructive",
      });
      if (saved > 0) handleClose();
    }
  }

  function toggleCandidate(index: number) {
    setCandidates((prev) =>
      prev.map((r, i) => (i === index ? { ...r, checked: !r.checked } : r)),
    );
  }

  function toggleAllCandidates(checked: boolean) {
    setCandidates((prev) => prev.map((r) => ({ ...r, checked })));
  }

  function startEditing(index: number) {
    setCandidates((prev) =>
      prev.map((r, i) => (i === index ? { ...r, editing: true } : r)),
    );
  }

  function commitEdit(index: number, value: string) {
    setCandidates((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, editedBody: value, editing: false } : r,
      ),
    );
  }

  const checkedCount = candidates.filter((r) => r.checked).length;
  const allChecked = candidates.length > 0 && checkedCount === candidates.length;

  const canGoToCount =
    pickMode === "docs" ? selectedDocIds.length > 0 : selectedTags.length > 0;

  function renderStep() {
    switch (step) {
      case "pick":
        return (
          <>
            <div className="flex gap-2 mb-4">
              <Button
                type="button"
                size="sm"
                variant={pickMode === "docs" ? "default" : "outline"}
                onClick={() => setPickMode("docs")}
              >
                By Document
              </Button>
              <Button
                type="button"
                size="sm"
                variant={pickMode === "tags" ? "default" : "outline"}
                onClick={() => setPickMode("tags")}
              >
                <Tag className="w-3.5 h-3.5 mr-1" />
                By Tag
              </Button>
            </div>

            {pickMode === "docs" ? (
              <KbDocPicker selectedIds={selectedDocIds} onChange={setSelectedDocIds} />
            ) : (
              <TagPicker tags={selectedTags} onChange={setSelectedTags} />
            )}
          </>
        );

      case "count":
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="target-count">Number of questions to generate</Label>
              <Input
                id="target-count"
                type="number"
                min={1}
                max={50}
                value={targetCount}
                onChange={(e) =>
                  setTargetCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))
                }
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Between 1 and 50 candidates will be returned.
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              {pickMode === "docs" ? (
                <span>
                  Generating from{" "}
                  <strong>{selectedDocIds.length}</strong> KB document
                  {selectedDocIds.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span>
                  Generating from tags:{" "}
                  {selectedTags.map((t) => (
                    <Badge key={t} variant="secondary" className="mr-1 text-xs">
                      {t}
                    </Badge>
                  ))}
                </span>
              )}
            </div>
          </div>
        );

      case "generate":
        return (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-center text-muted-foreground animate-pulse">
              {PROGRESS_MESSAGES[progressIndex]}
            </p>
            <p className="text-xs text-muted-foreground">This may take up to 15 seconds.</p>
          </div>
        );

      case "review":
        return (
          <div className="space-y-3">
            {warning && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2.5 text-sm text-yellow-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{warning}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => toggleAllCandidates(!!v)}
                />
                <span className="text-muted-foreground">
                  Select all ({checkedCount} / {candidates.length})
                </span>
              </label>
              <span className="text-xs text-muted-foreground">
                Sorted by confidence
              </span>
            </div>

            <ScrollArea className="h-72 rounded-md border">
              <div className="p-2 space-y-1.5">
                {candidates.map((row, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 rounded-md p-2 ${
                      row.checked ? "bg-muted/50" : "opacity-50"
                    }`}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={row.checked}
                      onCheckedChange={() => toggleCandidate(i)}
                    />

                    <div className="flex-1 min-w-0 space-y-1">
                      {row.editing ? (
                        <Textarea
                          autoFocus
                          rows={2}
                          defaultValue={row.editedBody}
                          className="text-sm resize-none"
                          onBlur={(e) => commitEdit(i, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              commitEdit(i, e.currentTarget.value);
                            }
                            if (e.key === "Escape") {
                              commitEdit(i, row.editedBody);
                            }
                          }}
                        />
                      ) : (
                        <p
                          className="text-sm cursor-text hover:bg-muted rounded px-1 -mx-1 py-0.5"
                          title="Click to edit"
                          onClick={() => startEditing(i)}
                        >
                          {row.editedBody}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Bot className="w-3 h-3 text-muted-foreground" />
                        <ConfidenceBadge value={row.candidate.retrieval_confidence} />
                        {!row.editing && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
                            onClick={() => startEditing(i)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        );
    }
  }

  function renderFooter() {
    switch (step) {
      case "pick":
        return (
          <>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => setStep("count")}
              disabled={!canGoToCount}
            >
              Next
            </Button>
          </>
        );
      case "count":
        return (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("pick")}
              className="mr-auto"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleGenerate}>
              <Sparkles className="w-4 h-4 mr-1" />
              Generate
            </Button>
          </>
        );
      case "generate":
        return (
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
        );
      case "review":
        return (
          <>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || checkedCount === 0}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Saving…
                </>
              ) : (
                `Add Selected (${checkedCount})`
              )}
            </Button>
          </>
        );
    }
  }

  const stepLabels: Record<Step, string> = {
    pick: "Select Knowledge Base",
    count: "Set Target Count",
    generate: "Generating…",
    review: "Review Candidates",
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Generate Questions with AI
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{stepLabels[step]}</p>
        </DialogHeader>

        <div className="py-1">{renderStep()}</div>

        <DialogFooter className="gap-2">{renderFooter()}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
