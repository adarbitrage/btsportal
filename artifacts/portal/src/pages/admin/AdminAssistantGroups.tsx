import { useState } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Layers,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  ChevronRight,
  GripVertical,
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
  useAdminCreateAssistantGroup,
  useAdminUpdateAssistantGroup,
  useAdminReorderAssistantGroups,
  type AssistantCardGroup,
} from "@/lib/admin-api";

interface GroupFormState {
  name: string;
  description: string;
  icon: string;
}

const EMPTY_FORM: GroupFormState = { name: "", description: "", icon: "" };

function SortableGroupRow({
  group,
  onEdit,
  onToggleActive,
  dragDisabled,
}: {
  group: AssistantCardGroup;
  onEdit: (g: AssistantCardGroup) => void;
  onToggleActive: (g: AssistantCardGroup) => void;
  dragDisabled: boolean;
}) {
  const [, navigate] = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group-${group.id}`,
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
      <Card className={`border border-border ${!group.isActive ? "opacity-60" : ""} ${isDragging ? "shadow-lg" : ""}`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none ${
                dragDisabled ? "opacity-40 cursor-not-allowed" : "hover:text-foreground cursor-grab active:cursor-grabbing"
              }`}
              aria-label={`Drag to reorder ${group.name}`}
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-5 h-5" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {group.icon && (
                  <span className="text-base">{group.icon}</span>
                )}
                <span className="font-semibold">{group.name}</span>
                {!group.isActive && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                )}
              </div>
              {group.description && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">{group.description}</p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleActive(group)}
                title={group.isActive ? "Deactivate" : "Activate"}
              >
                {group.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(group)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`/admin/assistant/groups/${group.id}/cards`)}
                title="Manage cards"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GroupFormDialog({
  open,
  onClose,
  group,
}: {
  open: boolean;
  onClose: () => void;
  group: AssistantCardGroup | null;
}) {
  const { toast } = useToast();
  const createMutation = useAdminCreateAssistantGroup();
  const updateMutation = useAdminUpdateAssistantGroup();

  const [form, setForm] = useState<GroupFormState>(() =>
    group
      ? { name: group.name, description: group.description ?? "", icon: group.icon ?? "" }
      : EMPTY_FORM
  );

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  function setField<K extends keyof GroupFormState>(key: K, value: GroupFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      if (group) {
        await updateMutation.mutateAsync({
          id: group.id,
          data: {
            name: form.name.trim(),
            description: form.description.trim() || null,
            icon: form.icon.trim() || null,
          },
        });
        toast({ title: "Group updated" });
      } else {
        await createMutation.mutateAsync({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          icon: form.icon.trim() || undefined,
        });
        toast({ title: "Group created" });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: group ? "Failed to update group" : "Failed to create group",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? "Edit Group" : "New Group"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="group-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="e.g. Portal Navigation"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-description">Description</Label>
            <Textarea
              id="group-description"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Optional description for this group"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-icon">Icon (lucide icon name)</Label>
            <Input
              id="group-icon"
              value={form.icon}
              onChange={(e) => setField("icon", e.target.value)}
              placeholder="e.g. Layers, BookOpen, Zap"
            />
            <p className="text-xs text-muted-foreground">
              Enter a lucide-react icon name (e.g. "Layers", "BookOpen", "Zap").
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : group ? "Save changes" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminAssistantGroups() {
  const { toast } = useToast();
  const { data: groups = [], isLoading } = useAdminAssistantGroups();
  const updateMutation = useAdminUpdateAssistantGroup();
  const reorderMutation = useAdminReorderAssistantGroups();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<AssistantCardGroup | null>(null);
  const [localGroups, setLocalGroups] = useState<AssistantCardGroup[] | null>(null);

  const displayGroups = localGroups ?? [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreate() {
    setEditingGroup(null);
    setDialogOpen(true);
  }

  function openEdit(group: AssistantCardGroup) {
    setEditingGroup(group);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingGroup(null);
    setLocalGroups(null);
  }

  async function handleToggleActive(group: AssistantCardGroup) {
    try {
      await updateMutation.mutateAsync({ id: group.id, data: { isActive: !group.isActive } });
      toast({ title: group.isActive ? "Group deactivated" : "Group activated" });
    } catch {
      toast({ title: "Failed to update group", variant: "destructive" });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayGroups.findIndex((g) => `group-${g.id}` === active.id);
    const newIndex = displayGroups.findIndex((g) => `group-${g.id}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayGroups, oldIndex, newIndex);
    setLocalGroups(reordered);

    try {
      await reorderMutation.mutateAsync(reordered.map((g) => g.id));
      setLocalGroups(null);
    } catch {
      toast({ title: "Failed to save new order", variant: "destructive" });
      setLocalGroups(null);
    }
  }

  const dragDisabled = reorderMutation.isPending;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Assistant Card Groups</h1>
            <p className="text-muted-foreground mt-1">
              Manage groups that organize the AI assistant empty-state cards.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> New Group
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5" />
              Groups
              {groups.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({groups.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading groups…</div>
            ) : displayGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No groups yet. Create one to get started.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayGroups.map((g) => `group-${g.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayGroups.map((group) => (
                    <SortableGroupRow
                      key={group.id}
                      group={group}
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

        <GroupFormDialog
          key={editingGroup?.id ?? "new"}
          open={dialogOpen}
          onClose={closeDialog}
          group={editingGroup}
        />
      </div>
    </AppLayout>
  );
}
