import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  ChevronLeft,
  GripVertical,
  Bot,
  User,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useAdminAssistantGroups,
  useAdminAssistantCards,
  useAdminAssistantQuestions,
  useAdminCreateAssistantQuestion,
  useAdminUpdateAssistantQuestion,
  useAdminReorderAssistantQuestions,
  type AssistantCardQuestion,
} from "@/lib/admin-api";

function GeneratedByBadge({ question }: { question: AssistantCardQuestion }) {
  if (question.generatedBy === "ai") {
    const conf = question.retrievalConfidence != null
      ? ` • ${question.retrievalConfidence.toFixed(2)} confidence`
      : "";
    return (
      <Badge variant="secondary" className="text-xs shrink-0 gap-1">
        <Bot className="w-3 h-3" />
        AI-Generated{conf}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs shrink-0 gap-1">
      <User className="w-3 h-3" />
      Manual
    </Badge>
  );
}

function SortableQuestionRow({
  question,
  onEdit,
  onToggleActive,
  dragDisabled,
}: {
  question: AssistantCardQuestion;
  onEdit: (q: AssistantCardQuestion) => void;
  onToggleActive: (q: AssistantCardQuestion) => void;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `question-${question.id}`,
    disabled: dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={`border border-border ${!question.isActive ? "opacity-60" : ""} ${isDragging ? "shadow-lg" : ""}`}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none mt-0.5 ${
                dragDisabled ? "opacity-40 cursor-not-allowed" : "hover:text-foreground cursor-grab active:cursor-grabbing"
              }`}
              aria-label="Drag to reorder question"
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-5 h-5" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 flex-wrap">
                <p className={`text-sm flex-1 min-w-0 ${!question.isActive ? "line-through text-muted-foreground" : ""}`}>
                  {question.body}
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <GeneratedByBadge question={question} />
                {!question.isActive && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleActive(question)}
                title={question.isActive ? "Deactivate" : "Activate"}
              >
                {question.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(question)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface QuestionFormState {
  body: string;
  isActive: boolean;
}

function QuestionFormDialog({
  open,
  onClose,
  question,
  cardId,
}: {
  open: boolean;
  onClose: () => void;
  question: AssistantCardQuestion | null;
  cardId: number;
}) {
  const { toast } = useToast();
  const createMutation = useAdminCreateAssistantQuestion();
  const updateMutation = useAdminUpdateAssistantQuestion();

  const [form, setForm] = useState<QuestionFormState>(() => ({
    body: question?.body ?? "",
    isActive: question?.isActive ?? true,
  }));

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.body.trim()) {
      toast({ title: "Question text is required", variant: "destructive" });
      return;
    }
    try {
      if (question) {
        await updateMutation.mutateAsync({
          id: question.id,
          cardId,
          data: { body: form.body.trim(), isActive: form.isActive },
        });
        toast({ title: "Question updated" });
      } else {
        await createMutation.mutateAsync({
          cardId,
          body: form.body.trim(),
          generatedBy: "manual",
        });
        toast({ title: "Question added" });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: question ? "Failed to update question" : "Failed to add question",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{question ? "Edit Question" : "Add Question"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="question-body">Question text <span className="text-destructive">*</span></Label>
            <Textarea
              id="question-body"
              value={form.body}
              onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
              placeholder="e.g. How do I set up my first tracking URL?"
              rows={3}
              autoFocus
            />
          </div>
          {question && (
            <div className="flex items-center gap-3">
              <Switch
                id="question-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))}
              />
              <Label htmlFor="question-active" className="cursor-pointer select-none">
                Active (visible to members)
              </Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : question ? "Save changes" : "Add question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminAssistantQuestions() {
  const params = useParams<{ groupId: string; cardId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const groupId = parseInt(params.groupId ?? "0", 10);
  const cardId = parseInt(params.cardId ?? "0", 10);

  const { data: groups = [] } = useAdminAssistantGroups();
  const { data: allCards = [] } = useAdminAssistantCards();
  const { data: questions = [], isLoading } = useAdminAssistantQuestions(cardId);
  const updateMutation = useAdminUpdateAssistantQuestion();
  const reorderMutation = useAdminReorderAssistantQuestions();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<AssistantCardQuestion | null>(null);
  const [localQuestions, setLocalQuestions] = useState<AssistantCardQuestion[] | null>(null);

  const group = groups.find((g) => g.id === groupId);
  const card = allCards.find((c) => c.id === cardId);
  const displayQuestions = localQuestions ?? [...questions].sort((a, b) => a.sortOrder - b.sortOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreate() {
    setEditingQuestion(null);
    setDialogOpen(true);
  }

  function openEdit(question: AssistantCardQuestion) {
    setEditingQuestion(question);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingQuestion(null);
    setLocalQuestions(null);
  }

  async function handleToggleActive(question: AssistantCardQuestion) {
    try {
      await updateMutation.mutateAsync({
        id: question.id,
        cardId,
        data: { isActive: !question.isActive },
      });
      toast({ title: question.isActive ? "Question deactivated" : "Question activated" });
    } catch {
      toast({ title: "Failed to update question", variant: "destructive" });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayQuestions.findIndex((q) => `question-${q.id}` === active.id);
    const newIndex = displayQuestions.findIndex((q) => `question-${q.id}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayQuestions, oldIndex, newIndex);
    setLocalQuestions(reordered);

    try {
      await reorderMutation.mutateAsync({ cardId, ordered_ids: reordered.map((q) => q.id) });
      setLocalQuestions(null);
    } catch {
      toast({ title: "Failed to save new order", variant: "destructive" });
      setLocalQuestions(null);
    }
  }

  const dragDisabled = reorderMutation.isPending;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2 flex-wrap">
            <button
              className="hover:text-foreground transition-colors"
              onClick={() => navigate("/admin/assistant/groups")}
            >
              Groups
            </button>
            <span>/</span>
            <button
              className="hover:text-foreground transition-colors"
              onClick={() => navigate(`/admin/assistant/groups/${groupId}/cards`)}
            >
              {group?.name ?? `Group ${groupId}`}
            </button>
            <span>/</span>
            <span className="text-foreground font-medium">{card?.title ?? `Card ${cardId}`}</span>
          </nav>

          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground"
                  onClick={() => navigate(`/admin/assistant/groups/${groupId}/cards`)}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Cards
                </Button>
              </div>
              <h1 className="text-2xl font-bold text-foreground">
                {card?.title ?? "Questions"}
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage questions for this assistant card.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1" /> Add Question
              </Button>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Questions
              {questions.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({questions.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading questions…</div>
            ) : displayQuestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No questions yet. Add one manually or use the AI generator.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayQuestions.map((q) => `question-${q.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayQuestions.map((question) => (
                    <SortableQuestionRow
                      key={question.id}
                      question={question}
                      onEdit={openEdit}
                      onToggleActive={handleToggleActive}
                      dragDisabled={dragDisabled}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <QuestionFormDialog
          key={editingQuestion?.id ?? "new"}
          open={dialogOpen}
          onClose={closeDialog}
          question={editingQuestion}
          cardId={cardId}
        />
      </div>
    </AppLayout>
  );
}
