import { useRef, useState, type ChangeEvent } from "react";
import { PackCoachingAdminLayout } from "@/components/layout/PackCoachingAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarOff,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminCoaches,
  useCreateCoach,
  useUpdateCoach,
  useDeleteCoach,
  uploadCoachPhoto,
  resolveCoachPhotoUrl,
  useReorderCoaches,
  useCoachCalls,
  useReassignCoachCalls,
  useCancelCoachCalls,
  useAddCoachAwayPeriod,
  useRemoveCoachAwayPeriod,
  type AdminCoach,
} from "@/lib/coaches-admin-api";

interface CoachForm {
  id?: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string;
  callTypes: string;
  timezone: string;
  isActive: boolean;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
}

const DEFAULT_TIMEZONE = "America/New_York";

const EMPTY_FORM: CoachForm = {
  name: "",
  specialties: "",
  bio: "",
  photoUrl: "",
  callTypes: "",
  timezone: DEFAULT_TIMEZONE,
  isActive: true,
  doesGroupCalls: true,
  doesPrivateCoaching: false,
};

function coachInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A single coach card that can be dragged to reorder. Wraps the existing card
// layout with a drag handle (dnd-kit) while keeping the up/down arrow controls
// as an accessible fallback.
function SortableCoachCard({
  coach,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onEdit,
  onOpenAway,
  onDelete,
  reorderDisabled,
}: {
  coach: AdminCoach;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onOpenAway: () => void;
  onDelete: () => void;
  reorderDisabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: coach.id, disabled: reorderDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        data-testid={`coach-${coach.id}`}
        className={isDragging ? "shadow-lg" : undefined}
      >
        <CardContent className="p-5 flex items-start gap-3">
          <button
            type="button"
            className={`flex items-center justify-center h-10 w-5 shrink-0 text-muted-foreground touch-none ${
              reorderDisabled
                ? "opacity-40 cursor-not-allowed"
                : "hover:text-foreground cursor-grab active:cursor-grabbing"
            }`}
            aria-label={`Drag to reorder ${coach.name}`}
            data-testid={`drag-coach-${coach.id}`}
            disabled={reorderDisabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-5 h-5" />
          </button>
          {coach.photoUrl ? (
            <img
              src={resolveCoachPhotoUrl(coach.photoUrl) ?? undefined}
              alt={coach.name}
              data-testid={`coach-photo-${coach.id}`}
              className="w-14 h-14 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              data-testid={`coach-initials-${coach.id}`}
              className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0"
            >
              {coachInitials(coach.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{coach.name}</h3>
              {!coach.isActive && (
                <span
                  data-testid={`coach-hidden-badge-${coach.id}`}
                  className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  Hidden
                </span>
              )}
              {(coach.awayPeriods ?? []).some((p) => p.isActive) && (
                <span
                  data-testid={`coach-away-badge-${coach.id}`}
                  className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
                >
                  Away now
                </span>
              )}
            </div>
            <p
              data-testid={`coach-specialty-${coach.id}`}
              className="text-xs font-medium text-primary mt-0.5"
            >
              {coach.specialties}
            </p>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {coach.bio}
            </p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="sm"
                onClick={onMoveUp}
                disabled={index === 0 || reorderDisabled}
                data-testid={`move-coach-up-${coach.id}`}
                aria-label={`Move ${coach.name} up`}
                title="Move up"
                className="h-6"
              >
                <ChevronUp className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onMoveDown}
                disabled={index === total - 1 || reorderDisabled}
                data-testid={`move-coach-down-${coach.id}`}
                aria-label={`Move ${coach.name} down`}
                title="Move down"
                className="h-6"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              data-testid={`edit-coach-${coach.id}`}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenAway}
              data-testid={`manage-away-${coach.id}`}
              aria-label={`Manage away periods for ${coach.name}`}
              title="Away periods"
            >
              <CalendarOff className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              data-testid={`delete-coach-${coach.id}`}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CoachProfiles() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminCoaches();
  const createMutation = useCreateCoach();
  const updateMutation = useUpdateCoach();
  const deleteMutation = useDeleteCoach();
  const reorderMutation = useReorderCoaches();
  const reassignMutation = useReassignCoachCalls();
  const cancelCallsMutation = useCancelCoachCalls();
  const addAwayMutation = useAddCoachAwayPeriod();
  const removeAwayMutation = useRemoveCoachAwayPeriod();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoach | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [awayTargetId, setAwayTargetId] = useState<number | null>(null);
  const [awayStart, setAwayStart] = useState("");
  const [awayEnd, setAwayEnd] = useState("");
  const [awayReason, setAwayReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coaches = data?.coaches ?? [];
  const isEditing = form.id !== undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // When a delete is in progress, load the coach's scheduled calls so we can
  // show what's blocking removal and offer to reassign or cancel them.
  const { data: callsData, isLoading: callsLoading } = useCoachCalls(
    deleteTarget?.id ?? null,
  );
  const blockingCalls = callsData?.calls ?? [];
  const hasBlockingCalls = blockingCalls.length > 0;
  // Coaches the calls can be reassigned to (anyone but the one being removed).
  const reassignOptions = coaches.filter((c) => c.id !== deleteTarget?.id);
  const isClearingCalls =
    reassignMutation.isPending || cancelCallsMutation.isPending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const objectPath = await uploadCoachPhoto(file);
      setForm((f) => ({ ...f, photoUrl: objectPath }));
      toast({ title: "Photo uploaded" });
    } catch (err) {
      toast({
        title: "Could not upload photo",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function openEdit(coach: AdminCoach) {
    setForm({
      id: coach.id,
      name: coach.name,
      specialties: coach.specialties,
      bio: coach.bio,
      photoUrl: coach.photoUrl ?? "",
      callTypes: coach.callTypes.join(", "),
      timezone: coach.timezone || DEFAULT_TIMEZONE,
      isActive: coach.isActive,
      doesGroupCalls: coach.doesGroupCalls,
      doesPrivateCoaching: coach.doesPrivateCoaching,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!form.specialties.trim()) {
      toast({ title: "Specialty is required", variant: "destructive" });
      return;
    }
    if (!form.bio.trim()) {
      toast({ title: "Bio is required", variant: "destructive" });
      return;
    }
    const photoUrl = form.photoUrl.trim();
    if (
      photoUrl &&
      !/^https?:\/\//i.test(photoUrl) &&
      !photoUrl.startsWith("/objects/")
    ) {
      toast({
        title: "Photo URL must start with http:// or https://",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: form.name.trim(),
      specialties: form.specialties.trim(),
      bio: form.bio.trim(),
      photoUrl: photoUrl || null,
      callTypes: form.callTypes
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
      isActive: form.isActive,
      doesGroupCalls: form.doesGroupCalls,
      doesPrivateCoaching: form.doesPrivateCoaching,
    };

    try {
      if (form.id !== undefined) {
        await updateMutation.mutateAsync({ id: form.id, ...payload });
        toast({ title: "Coach updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Coach added" });
      }
      setOpen(false);
    } catch (err) {
      toast({
        title: form.id !== undefined ? "Could not save coach" : "Could not add coach",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  // Move a coach one slot up or down in the display order and persist the whole
  // ordering. The cached list is already sorted by sortOrder, so we just swap the
  // adjacent ids and send the new full order to the server.
  async function moveCoach(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= coaches.length) return;
    const ids = coaches.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderMutation.mutateAsync(ids);
    } catch (err) {
      toast({
        title: "Could not reorder coaches",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setReassignTo("");
  }

  // Persist a drag reorder. dnd-kit gives us the dragged card (active) and the
  // card it was dropped onto (over); we arrayMove the cached order and send the
  // full ordered id list to the same endpoint the up/down arrows use.
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = coaches.findIndex((c) => c.id === active.id);
    const newIndex = coaches.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const ids = arrayMove(coaches, oldIndex, newIndex).map((c) => c.id);
    try {
      await reorderMutation.mutateAsync(ids);
    } catch (err) {
      toast({
        title: "Could not reorder coaches",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast({ title: "Coach removed" });
      closeDeleteDialog();
    } catch (err) {
      toast({
        title: "Could not remove coach",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleReassignCalls() {
    if (!deleteTarget || !reassignTo) return;
    try {
      const { reassigned } = await reassignMutation.mutateAsync({
        fromCoachId: deleteTarget.id,
        toCoachId: Number(reassignTo),
      });
      toast({
        title: `Reassigned ${reassigned} call${reassigned === 1 ? "" : "s"}`,
      });
      setReassignTo("");
    } catch (err) {
      toast({
        title: "Could not reassign calls",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleCancelCalls() {
    if (!deleteTarget) return;
    try {
      const { cancelled } = await cancelCallsMutation.mutateAsync(deleteTarget.id);
      toast({
        title: `Cancelled ${cancelled} call${cancelled === 1 ? "" : "s"}`,
      });
    } catch (err) {
      toast({
        title: "Could not cancel calls",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  // The coach whose away periods are being managed. Read live from the cached
  // list so the dialog reflects add/remove changes without local duplication.
  const awayTarget = coaches.find((c) => c.id === awayTargetId) ?? null;

  function openAway(coach: AdminCoach) {
    setAwayTargetId(coach.id);
    setAwayStart("");
    setAwayEnd("");
    setAwayReason("");
  }

  function closeAway() {
    setAwayTargetId(null);
  }

  async function handleAddAway() {
    if (!awayTarget) return;
    if (!awayStart || !awayEnd) {
      toast({ title: "Choose a start and end date", variant: "destructive" });
      return;
    }
    if (awayEnd < awayStart) {
      toast({
        title: "End date must be on or after the start date",
        variant: "destructive",
      });
      return;
    }
    try {
      await addAwayMutation.mutateAsync({
        coachId: awayTarget.id,
        startDate: awayStart,
        endDate: awayEnd,
        reason: awayReason.trim() || undefined,
      });
      toast({ title: "Away period added" });
      setAwayStart("");
      setAwayEnd("");
      setAwayReason("");
    } catch (err) {
      toast({
        title: "Could not add away period",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleRemoveAway(awayId: number) {
    if (!awayTarget) return;
    try {
      await removeAwayMutation.mutateAsync({ coachId: awayTarget.id, awayId });
      toast({ title: "Away period removed" });
    } catch (err) {
      toast({
        title: "Could not remove away period",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <PackCoachingAdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coach Profiles</h1>
            <p className="text-muted-foreground">
              Add, edit, or remove the coaches members see in the "Your Coaches"
              section on the Coaching page.
            </p>
          </div>
          <Button onClick={openCreate} data-testid="add-coach" className="shrink-0">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Coach
          </Button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-card rounded-xl" />
            ))}
          </div>
        ) : coaches.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No coaches found yet.
            </CardContent>
          </Card>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={coaches.map((c) => c.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {coaches.map((coach, index) => (
                  <SortableCoachCard
                    key={coach.id}
                    coach={coach}
                    index={index}
                    total={coaches.length}
                    onMoveUp={() => moveCoach(index, -1)}
                    onMoveDown={() => moveCoach(index, 1)}
                    onEdit={() => openEdit(coach)}
                    onOpenAway={() => openAway(coach)}
                    onDelete={() => setDeleteTarget(coach)}
                    reorderDisabled={reorderMutation.isPending}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Coach" : "Add Coach"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the profile members see on the Coaching page."
                : 'New coaches appear in the "Your Coaches" section right away.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={120}
                data-testid="coach-name"
              />
            </div>
            <div>
              <Label className="text-xs">Specialty *</Label>
              <Input
                value={form.specialties}
                onChange={(e) => setForm({ ...form, specialties: e.target.value })}
                maxLength={200}
                placeholder="e.g. Paid Traffic & Funnels"
                data-testid="coach-specialty"
              />
            </div>
            <div>
              <Label className="text-xs">Photo</Label>
              <div className="flex items-center gap-3 mt-1">
                {form.photoUrl.trim() ? (
                  <img
                    src={resolveCoachPhotoUrl(form.photoUrl) ?? undefined}
                    alt="Preview"
                    data-testid="coach-photo-preview"
                    className="w-16 h-16 rounded-full object-cover border border-border/60 shrink-0"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-muted border border-border/60 shrink-0" />
                )}
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                    data-testid="coach-photo-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    data-testid="coach-photo-upload"
                  >
                    {uploading ? "Uploading…" : "Upload image"}
                  </Button>
                  {form.photoUrl.trim() && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, photoUrl: "" })}
                      disabled={uploading}
                      data-testid="coach-photo-remove"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <Label className="text-xs mt-3 block text-muted-foreground">
                Or paste an image URL
              </Label>
              <Input
                value={form.photoUrl}
                onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
                placeholder="https://…"
                maxLength={2048}
                data-testid="coach-photo-url"
              />
            </div>
            <div>
              <Label className="text-xs">Bio *</Label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                rows={4}
                maxLength={2000}
                data-testid="coach-bio"
              />
            </div>
            <div>
              <Label className="text-xs">Call Types</Label>
              <Input
                value={form.callTypes}
                onChange={(e) => setForm({ ...form, callTypes: e.target.value })}
                placeholder="e.g. weekly_qa, strategy"
                data-testid="coach-call-types"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Comma-separated list of the call types this coach runs.
              </p>
            </div>
            <div>
              <Label className="text-xs">Timezone</Label>
              <Input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="America/New_York"
                maxLength={64}
                data-testid="coach-timezone"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                IANA timezone (e.g. America/New_York, Europe/London).
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="coach-active" className="text-sm font-medium">
                    Visible to members
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When off, this coach is hidden from the member "Your Coaches"
                    grid without being deleted.
                  </p>
                </div>
                <Switch
                  id="coach-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, isActive: checked })
                  }
                  data-testid="coach-active"
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="coach-group-calls" className="text-sm font-medium">
                    Runs group calls
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Group-call coaches appear in the member "Your Coaches" grid.
                  </p>
                </div>
                <Switch
                  id="coach-group-calls"
                  checked={form.doesGroupCalls}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, doesGroupCalls: checked })
                  }
                  data-testid="coach-group-calls"
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label
                    htmlFor="coach-private-coaching"
                    className="text-sm font-medium"
                  >
                    Offers private coaching
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Private-coaching coaches are bookable through credit packs.
                  </p>
                </div>
                <Switch
                  id="coach-private-coaching"
                  checked={form.doesPrivateCoaching}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, doesPrivateCoaching: checked })
                  }
                  data-testid="coach-private-coaching"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              data-testid="save-coach"
            >
              {isSaving ? "Saving…" : isEditing ? "Save" : "Add Coach"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) closeDeleteDialog();
        }}
      >
        <AlertDialogContent data-testid="delete-coach-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this coach?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasBlockingCalls
                ? `"${deleteTarget?.name}" is assigned to scheduled coaching calls and can't be removed until those calls are reassigned to another coach or cancelled.`
                : `"${deleteTarget?.name ?? ""}" will be removed from the member Coaching page.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {callsLoading ? (
            <div
              className="py-4 text-sm text-muted-foreground"
              data-testid="coach-calls-loading"
            >
              Checking scheduled calls…
            </div>
          ) : hasBlockingCalls ? (
            <div className="space-y-4" data-testid="coach-calls-blocking">
              <div className="rounded-lg border border-border/60 max-h-48 overflow-y-auto divide-y divide-border/60">
                {blockingCalls.map((call) => (
                  <div
                    key={call.id}
                    data-testid={`coach-call-${call.id}`}
                    className="px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {call.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(call.scheduledAt).toLocaleString()} ·{" "}
                        {call.registeredCount} registered
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Reassign these calls to</Label>
                <div className="flex items-center gap-2">
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger
                      className="flex-1"
                      data-testid="reassign-coach-select"
                    >
                      <SelectValue placeholder="Choose a coach" />
                    </SelectTrigger>
                    <SelectContent>
                      {reassignOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleReassignCalls}
                    disabled={!reassignTo || isClearingCalls}
                    data-testid="reassign-coach-calls"
                  >
                    {reassignMutation.isPending ? "Reassigning…" : "Reassign"}
                  </Button>
                </div>
                {reassignOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add another coach first to reassign these calls.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                <span className="text-xs text-muted-foreground">
                  Or remove the calls entirely:
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelCalls}
                  disabled={isClearingCalls}
                  data-testid="cancel-coach-calls"
                  className="text-destructive hover:text-destructive"
                >
                  {cancelCallsMutation.isPending
                    ? "Cancelling…"
                    : "Cancel all calls"}
                </Button>
              </div>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending || isClearingCalls}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={
                deleteMutation.isPending ||
                isClearingCalls ||
                callsLoading ||
                hasBlockingCalls
              }
              data-testid="confirm-delete-coach"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Removing…" : "Remove Coach"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={awayTarget !== null}
        onOpenChange={(o) => {
          if (!o) closeAway();
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          data-testid="away-dialog"
        >
          <DialogHeader>
            <DialogTitle>Away periods</DialogTitle>
            <DialogDescription>
              While {awayTarget?.name ?? "this coach"} is away they're hidden from
              the member "Your Coaches" grid and can't be booked for private
              coaching. They're restored automatically once the period ends.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              {(awayTarget?.awayPeriods.length ?? 0) === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="away-empty"
                >
                  No upcoming or active away periods.
                </p>
              ) : (
                <div className="rounded-lg border border-border/60 divide-y divide-border/60">
                  {awayTarget?.awayPeriods.map((p) => (
                    <div
                      key={p.id}
                      data-testid={`away-period-${p.id}`}
                      className="px-3 py-2 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {p.startDate} → {p.endDate}
                          </p>
                          {p.isActive && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">
                              Active
                            </span>
                          )}
                        </div>
                        {p.reason && (
                          <p className="text-xs text-muted-foreground truncate">
                            {p.reason}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAway(p.id)}
                        disabled={removeAwayMutation.isPending}
                        data-testid={`remove-away-${p.id}`}
                        className="text-destructive hover:text-destructive shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium text-foreground">Add an away period</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Start date</Label>
                  <Input
                    type="date"
                    value={awayStart}
                    onChange={(e) => setAwayStart(e.target.value)}
                    data-testid="away-start"
                  />
                </div>
                <div>
                  <Label className="text-xs">End date</Label>
                  <Input
                    type="date"
                    value={awayEnd}
                    onChange={(e) => setAwayEnd(e.target.value)}
                    data-testid="away-end"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Input
                  value={awayReason}
                  onChange={(e) => setAwayReason(e.target.value)}
                  placeholder="e.g. Vacation"
                  maxLength={200}
                  data-testid="away-reason"
                />
              </div>
              <Button
                onClick={handleAddAway}
                disabled={addAwayMutation.isPending}
                data-testid="add-away"
                className="w-full"
              >
                {addAwayMutation.isPending ? "Adding…" : "Add away period"}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAway} data-testid="away-close">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PackCoachingAdminLayout>
  );
}
