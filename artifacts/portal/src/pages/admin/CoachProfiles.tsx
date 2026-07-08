import { useRef, useState, type ChangeEvent } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
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
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  CalendarCheck,
  CalendarX,
  ChevronDown,
  ChevronUp,
  GripVertical,
  HardDrive,
  Link2Off,
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
  useSetCoachArchived,
  type AdminCoach,
  type CoachType,
  type CoachCallType,
  type CoachCallCalendar,
} from "@/lib/coaches-admin-api";

interface CoachForm {
  id?: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string;
  isActive: boolean;
  type: CoachType;
  doesGroupCalls: boolean;
  doesPrivateCoaching: boolean;
  doesOneOnOneVaCalls: boolean;
  // private_coaching calendar pair
  privateBookingCalendarId: string;
  privateBookingLocationId: string;
  privateConflictCalendarId: string;
  privateConflictLocationId: string;
  // one_on_one_va calendar pair
  vaBookingCalendarId: string;
  vaBookingLocationId: string;
  vaConflictCalendarId: string;
  vaConflictLocationId: string;
}

const EMPTY_FORM: CoachForm = {
  name: "",
  specialties: "",
  bio: "",
  photoUrl: "",
  isActive: true,
  type: "strategic_coach",
  doesGroupCalls: true,
  doesPrivateCoaching: false,
  doesOneOnOneVaCalls: false,
  privateBookingCalendarId: "",
  privateBookingLocationId: "",
  privateConflictCalendarId: "",
  privateConflictLocationId: "",
  vaBookingCalendarId: "",
  vaBookingLocationId: "",
  vaConflictCalendarId: "",
  vaConflictLocationId: "",
};

// Pull a coach's stored calendar pair for a given call type into the flat form
// string fields (empty string when absent).
function calendarPair(
  coach: AdminCoach,
  callType: CoachCallType,
): {
  bookingCalendarId: string;
  bookingLocationId: string;
  conflictCalendarId: string;
  conflictLocationId: string;
} {
  const found = (coach.callCalendars ?? []).find((c) => c.callType === callType);
  return {
    bookingCalendarId: found?.bookingCalendarId ?? "",
    bookingLocationId: found?.bookingLocationId ?? "",
    conflictCalendarId: found?.conflictCalendarId ?? "",
    conflictLocationId: found?.conflictLocationId ?? "",
  };
}

// The flat CoachForm keys backing the calendar text inputs.
type CalendarFieldKey =
  | "privateBookingCalendarId"
  | "privateBookingLocationId"
  | "privateConflictCalendarId"
  | "privateConflictLocationId"
  | "vaBookingCalendarId"
  | "vaBookingLocationId"
  | "vaConflictCalendarId"
  | "vaConflictLocationId";

// The booking + conflict calendar id/location inputs for a single call type.
// Reused for the strategic private_coaching pair and the VA one_on_one_va pair.
// `fieldKeys` maps each input to the flat CoachForm key it edits so the parent
// holds a single form object.
function CalendarPairFields({
  testIdPrefix,
  bookingTitle,
  bookingHint,
  bookingCalendarId,
  bookingLocationId,
  conflictCalendarId,
  conflictLocationId,
  onChange,
  fieldKeys,
}: {
  testIdPrefix: string;
  bookingTitle: string;
  bookingHint: string;
  bookingCalendarId: string;
  bookingLocationId: string;
  conflictCalendarId: string;
  conflictLocationId: string;
  onChange: (patch: Partial<Record<CalendarFieldKey, string>>) => void;
  fieldKeys: {
    bookingCalendarId: CalendarFieldKey;
    bookingLocationId: CalendarFieldKey;
    conflictCalendarId: CalendarFieldKey;
    conflictLocationId: CalendarFieldKey;
  };
}) {
  return (
    <div
      className="space-y-3 rounded-lg border border-border/60 p-3"
      data-testid={`${testIdPrefix}-calendar-fields`}
    >
      <p className="text-sm font-medium text-foreground">{bookingTitle}</p>
      <p className="text-xs text-muted-foreground -mt-2">{bookingHint}</p>
      <div>
        <Label className="text-xs">Calendar ID</Label>
        <Input
          value={bookingCalendarId}
          onChange={(e) => onChange({ [fieldKeys.bookingCalendarId]: e.target.value })}
          placeholder="GHL calendar id"
          maxLength={128}
          data-testid={`${testIdPrefix}-booking-calendar-id`}
        />
      </div>
      <div>
        <Label className="text-xs">Location ID</Label>
        <Input
          value={bookingLocationId}
          onChange={(e) => onChange({ [fieldKeys.bookingLocationId]: e.target.value })}
          placeholder="GHL location id (optional)"
          maxLength={128}
          data-testid={`${testIdPrefix}-booking-location-id`}
        />
      </div>
      <div className="border-t border-border/60 pt-3">
        <p className="text-sm font-medium text-foreground">
          Conflict calendar (other company)
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Optional. The coach's calendar in the other company (e.g. Cherrington).
          When set, that calendar is checked at booking time and a busy block is
          mirrored onto it, so the two companies never double-book this coach.
          Leave blank to keep booking exactly as today.
        </p>
      </div>
      <div>
        <Label className="text-xs">Conflict Calendar ID</Label>
        <Input
          value={conflictCalendarId}
          onChange={(e) => onChange({ [fieldKeys.conflictCalendarId]: e.target.value })}
          placeholder="Other-company GHL calendar id (optional)"
          maxLength={128}
          data-testid={`${testIdPrefix}-conflict-calendar-id`}
        />
      </div>
      <div>
        <Label className="text-xs">Conflict Location ID</Label>
        <Input
          value={conflictLocationId}
          onChange={(e) => onChange({ [fieldKeys.conflictLocationId]: e.target.value })}
          placeholder="Other-company GHL location id (optional)"
          maxLength={128}
          data-testid={`${testIdPrefix}-conflict-location-id`}
        />
      </div>
    </div>
  );
}

function coachInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Small status pill used by the per-coach Connections panel.
function ConnectionPill({
  tone,
  icon: Icon,
  label,
  title,
  testId,
}: {
  tone: "ok" | "warn" | "muted";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title?: string;
  testId: string;
}) {
  const toneClass =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${toneClass}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

// One labeled status row in the per-coach Connections panel: a purpose label
// (what the integration is for) on the left and a status pill on the right.
function ConnectionRow({
  purpose,
  source,
  tone,
  icon,
  status,
  title,
  testId,
}: {
  purpose: string;
  source: string;
  tone: "ok" | "warn" | "muted";
  icon: React.ComponentType<{ className?: string }>;
  status: string;
  title?: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{purpose}</span>
        <span className="text-muted-foreground"> · {source}</span>
      </span>
      <ConnectionPill
        tone={tone}
        icon={icon}
        label={status}
        title={title}
        testId={testId}
      />
    </div>
  );
}

// Per-coach Connections panel. Surfaces the distinct capabilities that power a
// coach's 1-on-1 flow, each as its own purpose-labeled row:
//   1. Booking calendar    — GoHighLevel (the call type's bookingCalendarId)
//   1b. Conflict calendar  — other company (cross-company arbiter), when set
//   2. Recording uploads   — Google Drive
// Shown for strategic coaches that offer private coaching and for VAs that
// offer 1-on-1 calls; the relevant call type's calendar pair drives the rows.
// Group-only coaches have no 1-on-1 connections, so the panel is hidden.
function CoachConnections({ coach }: { coach: AdminCoach }) {
  const callType: CoachCallType | null =
    coach.type === "va"
      ? coach.doesOneOnOneVaCalls
        ? "one_on_one_va"
        : null
      : coach.doesPrivateCoaching
        ? "private_coaching"
        : null;
  if (callType == null) return null;

  const pair = (coach.callCalendars ?? []).find((c) => c.callType === callType);
  const bookingCalendarId = pair?.bookingCalendarId ?? null;
  const conflictCalendarId = pair?.conflictCalendarId ?? null;

  const google = coach.googleConnection;
  const googleEmail = google?.email ?? null;

  return (
    <div className="mt-2 space-y-1" data-testid={`coach-connections-${coach.id}`}>
      {/* 1. Booking calendar — GoHighLevel */}
      {bookingCalendarId ? (
        <ConnectionRow
          purpose="Booking calendar"
          source="GoHighLevel"
          tone="ok"
          icon={CalendarCheck}
          status="Connected"
          title={`GHL calendar: ${bookingCalendarId}`}
          testId={`coach-conn-ghl-${coach.id}`}
        />
      ) : (
        <ConnectionRow
          purpose="Booking calendar"
          source="GoHighLevel"
          tone="warn"
          icon={CalendarX}
          status="Not connected"
          title="Add a GHL calendar id so this coach can be booked."
          testId={`coach-conn-ghl-${coach.id}`}
        />
      )}

      {/* 1b. Conflict calendar — other company (cross-company arbiter). Always
          shown so admins can see at a glance whether cross-company arbitration
          is set up; absence is the expected default, not a warning (neutral tone). */}
      {conflictCalendarId ? (
        <ConnectionRow
          purpose="Conflict calendar"
          source="Other company"
          tone="ok"
          icon={CalendarCheck}
          status="Connected"
          title={`Conflict GHL calendar: ${conflictCalendarId}`}
          testId={`coach-conn-conflict-ghl-${coach.id}`}
        />
      ) : (
        <ConnectionRow
          purpose="Conflict calendar"
          source="Other company"
          tone="muted"
          icon={CalendarX}
          status="Not connected"
          title="Optional: add the coach's other-company GHL calendar to block cross-company double-booking."
          testId={`coach-conn-conflict-ghl-${coach.id}`}
        />
      )}

      {/* 2. Recording uploads — Google Drive (single Google grant) */}
      {google == null ? (
        <ConnectionRow
          purpose="Recording uploads"
          source="Google Drive"
          tone="muted"
          icon={Link2Off}
          status="No login linked"
          title="Link this coach to a portal login to connect Google."
          testId={`coach-conn-drive-${coach.id}`}
        />
      ) : google.connected ? (
        <ConnectionRow
          purpose="Recording uploads"
          source="Google Drive"
          tone="ok"
          icon={HardDrive}
          status="Connected"
          title={googleEmail ?? undefined}
          testId={`coach-conn-drive-${coach.id}`}
        />
      ) : (
        <ConnectionRow
          purpose="Recording uploads"
          source="Google Drive"
          tone="warn"
          icon={Link2Off}
          status="Not connected"
          title="The coach hasn't connected Google yet."
          testId={`coach-conn-drive-${coach.id}`}
        />
      )}
    </div>
  );
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
  onReassign,
  onDelete,
  onToggleArchive,
  archivePending,
  reorderDisabled,
}: {
  coach: AdminCoach;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onReassign: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
  archivePending: boolean;
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
                  title="Hidden from members, booking and scheduling. Past call history stays attributed."
                  className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  Archived
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
            <CoachConnections coach={coach} />
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
              onClick={onReassign}
              data-testid={`reassign-coach-${coach.id}`}
              aria-label={`Reassign ${coach.name}'s calls to another coach`}
              title="Reassign calls"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleArchive}
              disabled={archivePending}
              data-testid={`archive-coach-${coach.id}`}
              aria-label={
                coach.isActive
                  ? `Archive ${coach.name}`
                  : `Restore ${coach.name}`
              }
              title={coach.isActive ? "Archive coach" : "Restore coach"}
            >
              {coach.isActive ? (
                <Archive className="w-4 h-4" />
              ) : (
                <ArchiveRestore className="w-4 h-4" />
              )}
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
  const archiveMutation = useSetCoachArchived();

  const [open, setOpen] = useState(false);
  // Roster visibility filter: archived coaches stay on the admin roster
  // (labeled) but can be filtered out or viewed alone.
  const [rosterFilter, setRosterFilter] = useState<"all" | "active" | "archived">(
    "all",
  );
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoach | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignTarget, setReassignTarget] = useState<AdminCoach | null>(null);
  const [standaloneReassignTo, setStandaloneReassignTo] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const coaches = data?.coaches ?? [];
  const visibleCoaches =
    rosterFilter === "all"
      ? coaches
      : coaches.filter((c) => (rosterFilter === "active" ? c.isActive : !c.isActive));
  // Reordering rewrites sortOrder from the full ordered id list, so it is only
  // safe when the whole roster is visible.
  const reorderBlocked = rosterFilter !== "all";
  const isEditing = form.id !== undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // When a delete is in progress, load the coach's scheduled calls so we can
  // show what's blocking removal and offer to reassign or cancel them.
  const { data: callsData, isLoading: callsLoading } = useCoachCalls(
    deleteTarget?.id ?? null,
  );
  const blockingCalls = callsData?.calls ?? [];
  const hasBlockingCalls = blockingCalls.length > 0;
  // Coaches the calls can be reassigned to: anyone active but the one being
  // removed. Archived coaches are hidden from members and skipped by the
  // top-up job, so they can never be a reassignment destination.
  const reassignOptions = coaches.filter(
    (c) => c.id !== deleteTarget?.id && c.isActive,
  );
  const isClearingCalls =
    reassignMutation.isPending || cancelCallsMutation.isPending;

  // Standalone reassign flow: hand a coach's scheduled calls to someone else
  // without deleting either coach (e.g. covering for leave). Loads the target
  // coach's calls so the admin can see what's being moved.
  const { data: reassignCallsData, isLoading: reassignCallsLoading } =
    useCoachCalls(reassignTarget?.id ?? null);
  const reassignCalls = reassignCallsData?.calls ?? [];
  const standaloneReassignOptions = coaches.filter(
    (c) => c.id !== reassignTarget?.id && c.isActive,
  );

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
    const priv = calendarPair(coach, "private_coaching");
    const va = calendarPair(coach, "one_on_one_va");
    setForm({
      id: coach.id,
      name: coach.name,
      specialties: coach.specialties,
      bio: coach.bio,
      photoUrl: coach.photoUrl ?? "",
      isActive: coach.isActive,
      type: coach.type,
      doesGroupCalls: coach.doesGroupCalls,
      doesPrivateCoaching: coach.doesPrivateCoaching,
      doesOneOnOneVaCalls: coach.doesOneOnOneVaCalls,
      privateBookingCalendarId: priv.bookingCalendarId,
      privateBookingLocationId: priv.bookingLocationId,
      privateConflictCalendarId: priv.conflictCalendarId,
      privateConflictLocationId: priv.conflictLocationId,
      vaBookingCalendarId: va.bookingCalendarId,
      vaBookingLocationId: va.bookingLocationId,
      vaConflictCalendarId: va.conflictCalendarId,
      vaConflictLocationId: va.conflictLocationId,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const photoUrl = form.photoUrl.trim();
    if (
      photoUrl &&
      !/^https?:\/\//i.test(photoUrl) &&
      !photoUrl.startsWith("/objects/") &&
      !photoUrl.startsWith("/coaching-photos/")
    ) {
      toast({
        title: "Photo URL must start with http:// or https://",
        variant: "destructive",
      });
      return;
    }

    // Build the per-call-type calendar pairs. A coach is a VA or a strategic
    // coach; each contributes the calendar for the call type it's enabled for.
    // When a capability is off we still send the pair with cleared ids so a
    // toggled-off call type drops its stale calendar binding.
    const isVa = form.type === "va";
    const callCalendars: CoachCallCalendar[] = [];
    const privateOn = !isVa && form.doesPrivateCoaching;
    callCalendars.push({
      callType: "private_coaching",
      bookingCalendarId: privateOn ? form.privateBookingCalendarId.trim() || null : null,
      bookingLocationId: privateOn ? form.privateBookingLocationId.trim() || null : null,
      conflictCalendarId: privateOn ? form.privateConflictCalendarId.trim() || null : null,
      conflictLocationId: privateOn ? form.privateConflictLocationId.trim() || null : null,
    });
    const vaOn = isVa && form.doesOneOnOneVaCalls;
    callCalendars.push({
      callType: "one_on_one_va",
      bookingCalendarId: vaOn ? form.vaBookingCalendarId.trim() || null : null,
      bookingLocationId: vaOn ? form.vaBookingLocationId.trim() || null : null,
      conflictCalendarId: vaOn ? form.vaConflictCalendarId.trim() || null : null,
      conflictLocationId: vaOn ? form.vaConflictLocationId.trim() || null : null,
    });

    const payload = {
      name: form.name.trim(),
      specialties: form.specialties.trim(),
      bio: form.bio.trim(),
      photoUrl: photoUrl || null,
      isActive: form.isActive,
      type: form.type,
      // A VA never does group/private coaching; a strategic coach never does VA
      // calls. Force the off-type capabilities off so the data stays coherent.
      doesGroupCalls: isVa ? false : form.doesGroupCalls,
      doesPrivateCoaching: isVa ? false : form.doesPrivateCoaching,
      doesOneOnOneVaCalls: isVa ? form.doesOneOnOneVaCalls : false,
      callCalendars,
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
      const { reassigned, templatesReassigned } =
        await reassignMutation.mutateAsync({
          fromCoachId: deleteTarget.id,
          toCoachId: Number(reassignTo),
        });
      toast({
        title: `Reassigned ${reassigned} call${reassigned === 1 ? "" : "s"} and ${templatesReassigned} recurring schedule${templatesReassigned === 1 ? "" : "s"}`,
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

  function openReassign(coach: AdminCoach) {
    setReassignTarget(coach);
    setStandaloneReassignTo("");
  }

  function closeReassign() {
    setReassignTarget(null);
    setStandaloneReassignTo("");
  }

  // Standalone reassign: move all of the target coach's scheduled calls to the
  // chosen coach without deleting either one. Keeps the dialog open on success
  // so the (now empty) list reflects the change.
  async function handleStandaloneReassign() {
    if (!reassignTarget || !standaloneReassignTo) return;
    try {
      const { reassigned, templatesReassigned } =
        await reassignMutation.mutateAsync({
          fromCoachId: reassignTarget.id,
          toCoachId: Number(standaloneReassignTo),
        });
      toast({
        title: `Reassigned ${reassigned} call${reassigned === 1 ? "" : "s"} and ${templatesReassigned} recurring schedule${templatesReassigned === 1 ? "" : "s"}`,
      });
      setStandaloneReassignTo("");
    } catch (err) {
      toast({
        title: "Could not reassign calls",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  // Archive (or restore) a coach. Archiving is the supported way to "remove"
  // a coach who has past-call history: it hides them from all member-facing
  // surfaces, booking, scheduling and reassign dropdowns while keeping the
  // history attributed.
  async function handleToggleArchive(coach: AdminCoach): Promise<boolean> {
    try {
      await archiveMutation.mutateAsync({
        id: coach.id,
        archived: coach.isActive,
      });
      toast({
        title: coach.isActive
          ? `Archived ${coach.name}`
          : `Restored ${coach.name}`,
        description: coach.isActive
          ? "Hidden from members, booking and scheduling. Past call history stays intact."
          : "Visible to members and available for booking again.",
      });
      return true;
    } catch (err) {
      toast({
        title: coach.isActive
          ? "Could not archive coach"
          : "Could not restore coach",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    }
  }

  // Archive from within the delete dialog (the path offered when a hard
  // delete is blocked by call history). Only close the dialog on success so
  // a failed archive leaves the admin where they were, error toast visible.
  async function handleArchiveInsteadOfDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const succeeded = await handleToggleArchive(target);
    if (succeeded) closeDeleteDialog();
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

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coaches</h1>
            <p className="text-muted-foreground">
              Add, edit, or remove the coaches members see in the "Your Coaches"
              section on the Coaching page.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={rosterFilter}
              onValueChange={(v) =>
                setRosterFilter(v as "all" | "active" | "archived")
              }
            >
              <SelectTrigger
                className="w-[130px]"
                data-testid="coach-roster-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All coaches</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openCreate} data-testid="add-coach">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Coach
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-card rounded-xl" />
            ))}
          </div>
        ) : visibleCoaches.length === 0 ? (
          <Card>
            <CardContent
              className="p-12 text-center text-muted-foreground"
              data-testid="coach-roster-empty"
            >
              {coaches.length === 0
                ? "No coaches found yet."
                : rosterFilter === "archived"
                  ? "No archived coaches."
                  : "No active coaches."}
            </CardContent>
          </Card>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visibleCoaches.map((c) => c.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {visibleCoaches.map((coach, index) => (
                  <SortableCoachCard
                    key={coach.id}
                    coach={coach}
                    index={index}
                    total={visibleCoaches.length}
                    onMoveUp={() => moveCoach(index, -1)}
                    onMoveDown={() => moveCoach(index, 1)}
                    onEdit={() => openEdit(coach)}
                    onReassign={() => openReassign(coach)}
                    onDelete={() => setDeleteTarget(coach)}
                    onToggleArchive={() => handleToggleArchive(coach)}
                    archivePending={archiveMutation.isPending}
                    reorderDisabled={reorderMutation.isPending || reorderBlocked}
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
                  <Label htmlFor="coach-type" className="text-sm font-medium">
                    Coach type
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Strategic coaches run group + private coaching. VAs offer free
                    1-on-1 VA calls.
                  </p>
                </div>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm({ ...form, type: value as CoachType })
                  }
                >
                  <SelectTrigger className="w-44" data-testid="coach-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strategic_coach">Strategic coach</SelectItem>
                    <SelectItem value="va">Virtual assistant</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.type === "strategic_coach" && (
                <>
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
                </>
              )}

              {form.type === "va" && (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label
                      htmlFor="coach-va-calls"
                      className="text-sm font-medium"
                    >
                      Offers 1-on-1 VA calls
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      VAs with this on are listed to members for free 1-on-1 calls.
                    </p>
                  </div>
                  <Switch
                    id="coach-va-calls"
                    checked={form.doesOneOnOneVaCalls}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, doesOneOnOneVaCalls: checked })
                    }
                    data-testid="coach-va-calls"
                  />
                </div>
              )}
            </div>

            {form.type === "strategic_coach" && form.doesPrivateCoaching && (
              <CalendarPairFields
                testIdPrefix="coach-private"
                bookingTitle="Booking calendar (GoHighLevel)"
                bookingHint="Used to book this coach's private 1-on-1 sessions. Each calendar id can belong to only one coach."
                bookingCalendarId={form.privateBookingCalendarId}
                bookingLocationId={form.privateBookingLocationId}
                conflictCalendarId={form.privateConflictCalendarId}
                conflictLocationId={form.privateConflictLocationId}
                onChange={(patch) => setForm({ ...form, ...patch })}
                fieldKeys={{
                  bookingCalendarId: "privateBookingCalendarId",
                  bookingLocationId: "privateBookingLocationId",
                  conflictCalendarId: "privateConflictCalendarId",
                  conflictLocationId: "privateConflictLocationId",
                }}
              />
            )}

            {form.type === "va" && form.doesOneOnOneVaCalls && (
              <CalendarPairFields
                testIdPrefix="coach-va"
                bookingTitle="VA call booking calendar (GoHighLevel)"
                bookingHint="Used to book this VA's free 1-on-1 calls. Each calendar id can belong to only one coach."
                bookingCalendarId={form.vaBookingCalendarId}
                bookingLocationId={form.vaBookingLocationId}
                conflictCalendarId={form.vaConflictCalendarId}
                conflictLocationId={form.vaConflictLocationId}
                onChange={(patch) => setForm({ ...form, ...patch })}
                fieldKeys={{
                  bookingCalendarId: "vaBookingCalendarId",
                  bookingLocationId: "vaBookingLocationId",
                  conflictCalendarId: "vaConflictCalendarId",
                  conflictLocationId: "vaConflictLocationId",
                }}
              />
            )}
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
                ? `"${deleteTarget?.name}" is assigned to upcoming coaching calls and can't be removed until those calls (and any recurring schedules) are reassigned to another coach or cancelled. Past calls are kept as history — coaches with past call history can't be deleted, archive them instead.`
                : `"${deleteTarget?.name ?? ""}" will be removed from the member Coaching page. If removal is blocked by past call history, archive the coach instead.`}
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
                <Label className="text-xs">
                  Reassign these calls and any recurring schedules to
                </Label>
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
                  Or remove the upcoming calls entirely:
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
                    : "Cancel upcoming calls"}
                </Button>
              </div>
            </div>
          ) : null}

          {deleteTarget?.isActive && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
              <span className="text-xs text-muted-foreground">
                Keep history and hide from members instead:
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleArchiveInsteadOfDelete}
                disabled={archiveMutation.isPending || isClearingCalls}
                data-testid="archive-instead-of-delete"
              >
                {archiveMutation.isPending ? "Archiving…" : "Archive coach"}
              </Button>
            </div>
          )}

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
        open={reassignTarget !== null}
        onOpenChange={(o) => {
          if (!o) closeReassign();
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          data-testid="reassign-dialog"
        >
          <DialogHeader>
            <DialogTitle>Reassign calls</DialogTitle>
            <DialogDescription>
              Move all of {reassignTarget?.name ?? "this coach"}'s scheduled
              coaching calls and recurring schedules to another coach without
              removing either coach — useful for covering during leave.
            </DialogDescription>
          </DialogHeader>

          {reassignCallsLoading ? (
            <div
              className="py-4 text-sm text-muted-foreground"
              data-testid="reassign-calls-loading"
            >
              Loading scheduled calls…
            </div>
          ) : reassignCalls.length === 0 ? (
            <p
              className="py-4 text-sm text-muted-foreground"
              data-testid="reassign-calls-empty"
            >
              {reassignTarget?.name ?? "This coach"} has no scheduled calls to
              reassign.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 max-h-48 overflow-y-auto divide-y divide-border/60">
                {reassignCalls.map((call) => (
                  <div
                    key={call.id}
                    data-testid={`reassign-call-${call.id}`}
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
                <Label className="text-xs">
                  Reassign these calls and any recurring schedules to
                </Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={standaloneReassignTo}
                    onValueChange={setStandaloneReassignTo}
                  >
                    <SelectTrigger
                      className="flex-1"
                      data-testid="standalone-reassign-select"
                    >
                      <SelectValue placeholder="Choose a coach" />
                    </SelectTrigger>
                    <SelectContent>
                      {standaloneReassignOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleStandaloneReassign}
                    disabled={!standaloneReassignTo || reassignMutation.isPending}
                    data-testid="standalone-reassign-calls"
                  >
                    {reassignMutation.isPending ? "Reassigning…" : "Reassign"}
                  </Button>
                </div>
                {standaloneReassignOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Add another coach first to reassign these calls.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeReassign}
              data-testid="reassign-close"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
