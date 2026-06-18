import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Video,
  Link2,
  Repeat,
  Pause,
  Play,
  Clock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminCoachingCalls,
  useCoachingCallCoaches,
  useCreateCoachingCall,
  useUpdateCoachingCall,
  useDeleteCoachingCall,
  useCoachingCallTemplates,
  useCreateCoachingCallTemplate,
  useUpdateCoachingCallTemplate,
  useDeleteCoachingCallTemplate,
  useSetCoachingCallTemplateActive,
  type AdminCoachingCall,
  type CoachingCallTemplate,
} from "@/lib/coaching-calls-admin-api";

const CALL_TYPES = [
  { value: "weekly_qa", label: "Weekly Q&A" },
  { value: "strategy", label: "Strategy" },
  { value: "mastermind", label: "Mastermind" },
  { value: "vip_roundtable", label: "VIP Roundtable" },
];

const WEEKDAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

// Each "generate" pass / re-slot produces this many upcoming weeks. The daily
// top-up job keeps the runway full afterwards, so the admin never thinks about
// it — hence it isn't surfaced in the schedule form.
const DEFAULT_OCCURRENCES_PER_BATCH = 8;

interface CallForm {
  id?: number;
  title: string;
  description: string;
  callType: string;
  coachId: string;
  scheduledAt: string;
  durationMinutes: string;
  meetLink: string;
  requiredEntitlement: string;
}

const EMPTY_FORM: CallForm = {
  title: "",
  description: "",
  callType: "strategy",
  coachId: "",
  scheduledAt: "",
  durationMinutes: "60",
  meetLink: "",
  requiredEntitlement: "coaching:group",
};

interface TemplateForm {
  id?: number;
  title: string;
  description: string;
  callType: string;
  coachId: string;
  dayOfWeek: string;
  time: string;
  durationMinutes: string;
  meetLink: string;
  requiredEntitlement: string;
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  title: "",
  description: "",
  callType: "weekly_qa",
  coachId: "",
  dayOfWeek: "1",
  time: "12:00",
  durationMinutes: "60",
  meetLink: "",
  requiredEntitlement: "coaching:group",
};

// <input type="datetime-local"> wants "yyyy-MM-dd'T'HH:mm" in LOCAL time. The
// API stores a real timestamp, so convert in both directions through the
// browser's local timezone.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Resolve a weekly slot (day-of-week + HH:mm, both LOCAL) to the next future
// occurrence. This becomes the template's anchorAt — the grid origin the
// backend uses to lay out every upcoming week.
function nextDateForDayTime(dayOfWeek: number, hh: number, mm: number): Date {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  let add = (dayOfWeek - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= now.getTime()) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

function callTypeLabel(value: string): string {
  return CALL_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, " ");
}

function scheduleSummary(t: CoachingCallTemplate): string {
  const anchor = new Date(t.anchorAt);
  if (t.intervalDays === 7) {
    return `Every ${format(anchor, "EEEE")} • ${format(anchor, "h:mm a")}`;
  }
  return `Every ${t.intervalDays} days • ${format(anchor, "h:mm a")}`;
}

export default function CoachingCalls() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminCoachingCalls();
  const { data: coachData } = useCoachingCallCoaches();
  const createMutation = useCreateCoachingCall();
  const updateMutation = useUpdateCoachingCall();
  const deleteMutation = useDeleteCoachingCall();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CallForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoachingCall | null>(null);

  const calls = data?.calls ?? [];
  const coaches = coachData?.coaches ?? [];

  // One-off calls have no recurring schedule (strategy / mastermind / VIP
  // sessions, or legacy stragglers). They keep their own simple list.
  const oneOffCalls = calls
    .filter((c) => c.templateId == null)
    .sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );

  function openNewOneOff() {
    setForm({
      ...EMPTY_FORM,
      coachId: coaches[0] ? String(coaches[0].id) : "",
    });
    setOpen(true);
  }

  function openEdit(call: AdminCoachingCall) {
    setForm({
      id: call.id,
      title: call.title,
      description: call.description ?? "",
      callType: call.callType,
      coachId: String(call.coachId),
      scheduledAt: toLocalInput(call.scheduledAt),
      durationMinutes: String(call.durationMinutes),
      meetLink: call.meetLink ?? "",
      requiredEntitlement: call.requiredEntitlement,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!form.coachId) {
      toast({ title: "Please pick a coach", variant: "destructive" });
      return;
    }
    if (!form.scheduledAt) {
      toast({ title: "Date & time is required", variant: "destructive" });
      return;
    }
    const duration = parseInt(form.durationMinutes, 10);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      callType: form.callType,
      coachId: parseInt(form.coachId, 10),
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      durationMinutes: Number.isInteger(duration) && duration > 0 ? duration : 60,
      meetLink: form.meetLink.trim() || null,
      requiredEntitlement: form.requiredEntitlement.trim() || "coaching:group",
    };

    try {
      if (form.id) {
        await updateMutation.mutateAsync({ id: form.id, ...payload });
        toast({ title: "Call updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Call added" });
      }
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not save call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast({ title: "Call deleted" });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // --- Recurring schedules ---------------------------------------------------
  const { data: templateData } = useCoachingCallTemplates();
  const createTemplateMutation = useCreateCoachingCallTemplate();
  const updateTemplateMutation = useUpdateCoachingCallTemplate();
  const deleteTemplateMutation = useDeleteCoachingCallTemplate();
  const setTemplateActiveMutation = useSetCoachingCallTemplateActive();

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);
  const [templateDeleteTarget, setTemplateDeleteTarget] =
    useState<CoachingCallTemplate | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [templateFilter, setTemplateFilter] = useState<"all" | "active" | "paused">(
    "all",
  );

  const templates = [...(templateData?.templates ?? [])].sort((a, b) => {
    const aw = new Date(a.anchorAt);
    const bw = new Date(b.anchorAt);
    return (
      aw.getDay() - bw.getDay() ||
      aw.getHours() * 60 + aw.getMinutes() - (bw.getHours() * 60 + bw.getMinutes()) ||
      a.title.localeCompare(b.title)
    );
  });
  const pausedCount = templates.filter((t) => !t.active).length;
  const activeCount = templates.length - pausedCount;
  const visibleTemplates = templates.filter((t) =>
    templateFilter === "all"
      ? true
      : templateFilter === "active"
        ? t.active
        : !t.active,
  );

  function openNewTemplate() {
    setTemplateForm({
      ...EMPTY_TEMPLATE_FORM,
      coachId: coaches[0] ? String(coaches[0].id) : "",
    });
    setTemplateOpen(true);
  }

  function openEditTemplate(t: CoachingCallTemplate) {
    const anchor = new Date(t.anchorAt);
    setTemplateForm({
      id: t.id,
      title: t.title,
      description: t.description ?? "",
      callType: t.callType,
      coachId: String(t.coachId),
      dayOfWeek: String(anchor.getDay()),
      time: format(anchor, "HH:mm"),
      durationMinutes: String(t.durationMinutes),
      meetLink: t.meetLink ?? "",
      requiredEntitlement: t.requiredEntitlement,
    });
    setTemplateOpen(true);
  }

  async function handleSaveTemplate() {
    if (!templateForm.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!templateForm.coachId) {
      toast({ title: "Please pick a coach", variant: "destructive" });
      return;
    }
    const [hhStr, mmStr] = templateForm.time.split(":");
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
      toast({ title: "A valid time is required", variant: "destructive" });
      return;
    }
    const duration = parseInt(templateForm.durationMinutes, 10);
    if (!Number.isInteger(duration) || duration <= 0) {
      toast({
        title: "Duration must be a positive number of minutes",
        variant: "destructive",
      });
      return;
    }
    const anchorAt = nextDateForDayTime(parseInt(templateForm.dayOfWeek, 10), hh, mm);
    const payload = {
      title: templateForm.title.trim(),
      description: templateForm.description.trim(),
      callType: templateForm.callType,
      coachId: parseInt(templateForm.coachId, 10),
      durationMinutes: duration,
      occurrencesPerBatch: DEFAULT_OCCURRENCES_PER_BATCH,
      meetLink: templateForm.meetLink.trim() || null,
      requiredEntitlement: templateForm.requiredEntitlement.trim() || "coaching:group",
      anchorAt: anchorAt.toISOString(),
    };

    try {
      if (templateForm.id) {
        await updateTemplateMutation.mutateAsync({ id: templateForm.id, ...payload });
        toast({
          title: "Schedule updated",
          description: "Upcoming open dates were moved to match. Booked calls stay put.",
        });
      } else {
        const res = await createTemplateMutation.mutateAsync(payload);
        toast({
          title: "Weekly call scheduled",
          description: `Scheduled the next ${res.generated} week${res.generated === 1 ? "" : "s"}.`,
        });
      }
      setTemplateOpen(false);
    } catch (err) {
      toast({
        title: "Could not save schedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleToggleActive(t: CoachingCallTemplate) {
    const next = !t.active;
    setTogglingId(t.id);
    try {
      await setTemplateActiveMutation.mutateAsync({ id: t.id, active: next });
      toast({
        title: next ? "Schedule resumed" : "Schedule paused",
        description: next
          ? "New calls will be generated again."
          : "Generation is halted until you resume it. Existing calls are unaffected.",
      });
    } catch (err) {
      toast({
        title: next ? "Could not resume schedule" : "Could not pause schedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDeleteTemplate() {
    if (!templateDeleteTarget) return;
    try {
      await deleteTemplateMutation.mutateAsync(templateDeleteTarget.id);
      toast({ title: "Schedule removed" });
      setTemplateDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not remove schedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const isTemplateMutating =
    createTemplateMutation.isPending || updateTemplateMutation.isPending;

  const nothingScheduled =
    !isLoading && templates.length === 0 && oneOffCalls.length === 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Group Calls</h1>
            <p className="text-muted-foreground">
              Manage the recurring weekly coaching schedule members see on the
              Coaching page. Set a slot once — upcoming weeks are filled in
              automatically.
            </p>
          </div>
          <Button onClick={openNewTemplate} data-testid="add-weekly-call">
            <Plus className="w-4 h-4 mr-2" />
            Add Weekly Call
          </Button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-card rounded-xl" />
            ))}
          </div>
        ) : nothingScheduled ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No weekly calls scheduled yet. Add your first weekly call to build the
              schedule — every upcoming week is generated for you.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {templates.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1.5"
                data-testid="template-filter"
              >
                {([
                  { value: "all", label: `All (${templates.length})` },
                  { value: "active", label: `Active (${activeCount})` },
                  { value: "paused", label: `Paused (${pausedCount})` },
                ] as const).map((opt) => (
                  <Button
                    key={opt.value}
                    variant={templateFilter === opt.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTemplateFilter(opt.value)}
                    data-testid={`template-filter-${opt.value}`}
                    aria-pressed={templateFilter === opt.value}
                  >
                    {opt.value === "paused" && <Pause className="w-3.5 h-3.5 mr-1.5" />}
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
            {templates.length > 0 && visibleTemplates.length === 0 ? (
              <Card>
                <CardContent
                  className="p-8 text-center text-muted-foreground text-sm"
                  data-testid="template-filter-empty"
                >
                  {templateFilter === "paused"
                    ? "No paused schedules — every series is running."
                    : "No active schedules — all series are paused."}
                </CardContent>
              </Card>
            ) : (
              visibleTemplates.map((t) => {
                return (
                <Card
                  key={t.id}
                  data-testid={`template-${t.id}`}
                  data-active={String(t.active)}
                  className={t.active ? undefined : "border-dashed bg-muted/40"}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                          t.active ? "bg-primary/10" : "bg-muted"
                        }`}
                      >
                        <Repeat
                          className={`w-5 h-5 ${t.active ? "text-primary" : "text-muted-foreground"}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3
                            className={`font-semibold ${
                              t.active ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {t.title}
                          </h3>
                          {!t.active && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] gap-1"
                              data-testid={`template-paused-badge-${t.id}`}
                            >
                              <Pause className="w-3 h-3" />
                              Paused
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            {scheduleSummary(t)}
                          </span>
                          <span>{t.durationMinutes} min</span>
                          <span>with {t.coachName}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div
                          className="flex items-center gap-1.5"
                          title={t.active ? "Pause this schedule" : "Resume this schedule"}
                        >
                          {t.active ? (
                            <Pause className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Play className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <Switch
                            checked={t.active}
                            disabled={togglingId === t.id}
                            onCheckedChange={() => handleToggleActive(t)}
                            data-testid={`toggle-template-${t.id}`}
                            aria-label={t.active ? "Pause schedule" : "Resume schedule"}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditTemplate(t)}
                          data-testid={`edit-template-${t.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setTemplateDeleteTarget(t)}
                          data-testid={`delete-template-${t.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                );
              })
            )}
          </div>
        )}

        {/* One-off / special sessions: no recurring schedule. */}
        {(oneOffCalls.length > 0 || !isLoading) && (
          <div className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Video className="w-4 h-4 text-primary" />
                  One-off Calls
                </h2>
                <p className="text-sm text-muted-foreground">
                  Strategy, mastermind, or VIP sessions that don't repeat weekly.
                </p>
              </div>
              <Button variant="outline" onClick={openNewOneOff} data-testid="add-call">
                <Plus className="w-4 h-4 mr-2" />
                Add One-off
              </Button>
            </div>

            {oneOffCalls.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  No one-off calls. Recurring weekly calls live in the schedule above.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {oneOffCalls.map((call) => (
                  <Card key={call.id} data-testid={`call-${call.id}`}>
                    <CardContent className="p-5 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Video className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">{call.title}</h3>
                          <Badge variant="outline" className="text-[10px]">
                            {callTypeLabel(call.callType)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 shrink-0" />
                            {format(new Date(call.scheduledAt), "EEE, MMM d • h:mm a")}
                          </span>
                          <span>{call.durationMinutes} min</span>
                          <span>with {call.coachName}</span>
                        </div>
                        {call.meetLink ? (
                          <a
                            href={call.meetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-primary mt-1.5 truncate max-w-full hover:underline"
                          >
                            <Link2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{call.meetLink}</span>
                          </a>
                        ) : (
                          <p className="text-xs text-amber-600 mt-1.5">No Meet link set</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(call)}
                          data-testid={`edit-call-${call.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(call)}
                          data-testid={`delete-call-${call.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* One-off call create / single-occurrence edit dialog. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Call" : "Add One-off Call"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                data-testid="call-title"
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Call Type</Label>
                <Select
                  value={form.callType}
                  onValueChange={(value) => setForm({ ...form, callType: value })}
                >
                  <SelectTrigger data-testid="call-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Coach *</Label>
                <Select
                  value={form.coachId}
                  onValueChange={(value) => setForm({ ...form, coachId: value })}
                >
                  <SelectTrigger data-testid="call-coach">
                    <SelectValue placeholder="Select coach" />
                  </SelectTrigger>
                  <SelectContent>
                    {coaches.map((coach) => (
                      <SelectItem key={coach.id} value={String(coach.id)}>
                        {coach.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Date & Time *</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                  data-testid="call-scheduled-at"
                />
              </div>
              <div>
                <Label className="text-xs">Duration (min)</Label>
                <Input
                  type="number"
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Meet Link</Label>
              <Input
                value={form.meetLink}
                onChange={(e) => setForm({ ...form, meetLink: e.target.value })}
                placeholder="https://meet.google.com/…"
                data-testid="call-meet-link"
              />
            </div>
            <div>
              <Label className="text-xs">Required Entitlement</Label>
              <Input
                value={form.requiredEntitlement}
                onChange={(e) =>
                  setForm({ ...form, requiredEntitlement: e.target.value })
                }
                placeholder="coaching:group"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isMutating}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isMutating} data-testid="save-call">
              {isMutating ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this call?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes{" "}
            <strong className="text-foreground">{deleteTarget?.title}</strong> on{" "}
            {deleteTarget
              ? format(new Date(deleteTarget.scheduledAt), "EEE, MMM d")
              : ""}{" "}
            from the schedule. Members will no longer see it. The rest of the series
            is untouched.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete-call"
            >
              {deleteMutation.isPending ? "Cancelling…" : "Cancel call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurring schedule create / edit dialog. */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {templateForm.id ? "Edit Weekly Call" : "Add Weekly Call"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Title *</Label>
              <Input
                value={templateForm.title}
                onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })}
                data-testid="template-title"
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={templateForm.description}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Call Type</Label>
                <Select
                  value={templateForm.callType}
                  onValueChange={(value) =>
                    setTemplateForm({ ...templateForm, callType: value })
                  }
                >
                  <SelectTrigger data-testid="template-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Coach *</Label>
                <Select
                  value={templateForm.coachId}
                  onValueChange={(value) =>
                    setTemplateForm({ ...templateForm, coachId: value })
                  }
                >
                  <SelectTrigger data-testid="template-coach">
                    <SelectValue placeholder="Select coach" />
                  </SelectTrigger>
                  <SelectContent>
                    {coaches.map((coach) => (
                      <SelectItem key={coach.id} value={String(coach.id)}>
                        {coach.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Day of Week *</Label>
                <Select
                  value={templateForm.dayOfWeek}
                  onValueChange={(value) =>
                    setTemplateForm({ ...templateForm, dayOfWeek: value })
                  }
                >
                  <SelectTrigger data-testid="template-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Time *</Label>
                <Input
                  type="time"
                  value={templateForm.time}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, time: e.target.value })
                  }
                  data-testid="template-time"
                />
              </div>
            </div>
            {templateForm.id && (
              <p className="text-xs text-muted-foreground">
                Changing the day, time, coach, or details moves every upcoming open
                date to match. Calls members have already booked are left untouched.
              </p>
            )}
            <div>
              <Label className="text-xs">Duration (min)</Label>
              <Input
                type="number"
                value={templateForm.durationMinutes}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, durationMinutes: e.target.value })
                }
                data-testid="template-duration"
              />
            </div>
            <div>
              <Label className="text-xs">Meet Link</Label>
              <Input
                value={templateForm.meetLink}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, meetLink: e.target.value })
                }
                placeholder="https://meet.google.com/…"
                data-testid="template-meet-link"
              />
            </div>
            <div>
              <Label className="text-xs">Required Entitlement</Label>
              <Input
                value={templateForm.requiredEntitlement}
                onChange={(e) =>
                  setTemplateForm({ ...templateForm, requiredEntitlement: e.target.value })
                }
                placeholder="coaching:group"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateOpen(false)}
              disabled={isTemplateMutating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={isTemplateMutating}
              data-testid="save-template"
            >
              {isTemplateMutating
                ? "Saving…"
                : templateForm.id
                  ? "Save"
                  : "Create & Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!templateDeleteTarget}
        onOpenChange={(o) => !o && setTemplateDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove weekly schedule?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This stops{" "}
            <strong className="text-foreground">{templateDeleteTarget?.title}</strong>{" "}
            from generating new weeks. Calls already on the schedule stay put — cancel
            those individually if you also want them gone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateDeleteTarget(null)}
              disabled={deleteTemplateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTemplate}
              disabled={deleteTemplateMutation.isPending}
              data-testid="confirm-delete-template"
            >
              {deleteTemplateMutation.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
