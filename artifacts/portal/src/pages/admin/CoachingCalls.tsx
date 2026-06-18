import { useState } from "react";
import { PackCoachingAdminLayout } from "@/components/layout/PackCoachingAdminLayout";
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
import { Plus, Pencil, Trash2, Calendar, Video, Link2, Repeat, CalendarPlus, Pause, Play, UserCog, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminCoachingCalls,
  useCoachingCallCoaches,
  useCreateCoachingCall,
  useUpdateCoachingCall,
  useDeleteCoachingCall,
  useReassignCoachingCall,
  useCoachingCallTemplates,
  useCreateCoachingCallTemplate,
  useUpdateCoachingCallTemplate,
  useGenerateCoachingCallTemplate,
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
  callType: "weekly_qa",
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
  anchorAt: string;
  durationMinutes: string;
  occurrencesPerBatch: string;
  meetLink: string;
  requiredEntitlement: string;
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  title: "",
  description: "",
  callType: "weekly_qa",
  coachId: "",
  anchorAt: "",
  durationMinutes: "60",
  occurrencesPerBatch: "8",
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

function callTypeLabel(value: string): string {
  return CALL_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, " ");
}

export default function CoachingCalls() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminCoachingCalls();
  const { data: coachData } = useCoachingCallCoaches();
  const createMutation = useCreateCoachingCall();
  const updateMutation = useUpdateCoachingCall();
  const deleteMutation = useDeleteCoachingCall();
  const reassignMutation = useReassignCoachingCall();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CallForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoachingCall | null>(null);
  const [reassigningId, setReassigningId] = useState<number | null>(null);

  const calls = data?.calls ?? [];
  const coaches = coachData?.coaches ?? [];

  function openNew() {
    setForm({ ...EMPTY_FORM, coachId: coaches[0] ? String(coaches[0].id) : "" });
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

  async function handleReassign(call: AdminCoachingCall, coachId: number) {
    if (coachId === call.coachId) return;
    const coachName = coaches.find((c) => c.id === coachId)?.name ?? "the new coach";
    setReassigningId(call.id);
    try {
      await reassignMutation.mutateAsync({ id: call.id, coachId });
      toast({
        title: "Call reassigned",
        description: `"${call.title}" is now hosted by ${coachName}.`,
      });
    } catch (err) {
      toast({
        title: "Could not reassign call",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setReassigningId(null);
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // --- Recurring templates ---------------------------------------------------
  const { data: templateData } = useCoachingCallTemplates();
  const createTemplateMutation = useCreateCoachingCallTemplate();
  const updateTemplateMutation = useUpdateCoachingCallTemplate();
  const generateTemplateMutation = useGenerateCoachingCallTemplate();
  const deleteTemplateMutation = useDeleteCoachingCallTemplate();
  const setTemplateActiveMutation = useSetCoachingCallTemplateActive();

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);
  const [templateDeleteTarget, setTemplateDeleteTarget] =
    useState<CoachingCallTemplate | null>(null);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const templates = templateData?.templates ?? [];

  function openNewTemplate() {
    setTemplateForm({
      ...EMPTY_TEMPLATE_FORM,
      coachId: coaches[0] ? String(coaches[0].id) : "",
    });
    setTemplateOpen(true);
  }

  function openEditTemplate(t: CoachingCallTemplate) {
    setTemplateForm({
      id: t.id,
      title: t.title,
      description: t.description ?? "",
      callType: t.callType,
      coachId: String(t.coachId),
      anchorAt: toLocalInput(t.anchorAt),
      durationMinutes: String(t.durationMinutes),
      occurrencesPerBatch: String(t.occurrencesPerBatch),
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
    if (!templateForm.id && !templateForm.anchorAt) {
      toast({ title: "First call date & time is required", variant: "destructive" });
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
    const batch = parseInt(templateForm.occurrencesPerBatch, 10);
    if (!Number.isInteger(batch) || batch <= 0) {
      toast({
        title: "Weeks to Generate must be a positive number",
        variant: "destructive",
      });
      return;
    }
    const base = {
      title: templateForm.title.trim(),
      description: templateForm.description.trim(),
      callType: templateForm.callType,
      coachId: parseInt(templateForm.coachId, 10),
      durationMinutes: duration,
      occurrencesPerBatch: batch,
      meetLink: templateForm.meetLink.trim() || null,
      requiredEntitlement: templateForm.requiredEntitlement.trim() || "coaching:group",
    };

    try {
      if (templateForm.id) {
        await updateTemplateMutation.mutateAsync({ id: templateForm.id, ...base });
        toast({ title: "Recurring schedule updated" });
      } else {
        const res = await createTemplateMutation.mutateAsync({
          ...base,
          anchorAt: new Date(templateForm.anchorAt).toISOString(),
        });
        toast({
          title: "Recurring schedule created",
          description: `Scheduled the next ${res.generated} call${res.generated === 1 ? "" : "s"}.`,
        });
      }
      setTemplateOpen(false);
    } catch (err) {
      toast({
        title: "Could not save recurring schedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleGenerate(t: CoachingCallTemplate) {
    setGeneratingId(t.id);
    try {
      const res = await generateTemplateMutation.mutateAsync(t.id);
      toast({
        title: res.generated > 0 ? "More calls scheduled" : "Already up to date",
        description:
          res.generated > 0
            ? `Added ${res.generated} more call${res.generated === 1 ? "" : "s"}.`
            : "No new calls were needed.",
      });
    } catch (err) {
      toast({
        title: "Could not generate calls",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingId(null);
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
      toast({ title: "Recurring schedule removed" });
      setTemplateDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not remove recurring schedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const isTemplateMutating =
    createTemplateMutation.isPending || updateTemplateMutation.isPending;

  return (
    <PackCoachingAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Group Calls</h1>
            <p className="text-muted-foreground">
              Manage the weekly live coaching schedule and Meet links members see on
              the Coaching page.
            </p>
          </div>
          <Button onClick={openNew} data-testid="add-call">
            <Plus className="w-4 h-4 mr-2" />
            Add Call
          </Button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-card rounded-xl" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No coaching calls scheduled yet. Add your first call to populate the
              schedule.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
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
                      {call.templateId ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] gap-1"
                          data-testid={`call-series-${call.id}`}
                        >
                          <Repeat className="w-3 h-3" />
                          Recurring
                        </Badge>
                      ) : null}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reassigningId === call.id}
                          data-testid={`reassign-call-${call.id}`}
                          title="Reassign this call to another coach"
                        >
                          <UserCog className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel>Reassign to coach</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {coaches.map((coach) => (
                          <DropdownMenuItem
                            key={coach.id}
                            disabled={
                              coach.id === call.coachId || reassigningId === call.id
                            }
                            onSelect={() => handleReassign(call, coach.id)}
                            data-testid={`reassign-call-${call.id}-coach-${coach.id}`}
                          >
                            <span className="flex-1 truncate">{coach.name}</span>
                            {coach.id === call.coachId ? (
                              <Check className="w-4 h-4 text-primary shrink-0" />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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

        <div className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Repeat className="w-4 h-4 text-primary" />
                Recurring Schedules
              </h2>
              <p className="text-sm text-muted-foreground">
                Define a weekly slot once and auto-generate the upcoming weeks. Editing
                or deleting a single call above never affects the rest of the series.
              </p>
            </div>
            <Button variant="outline" onClick={openNewTemplate} data-testid="add-template">
              <Plus className="w-4 h-4 mr-2" />
              Add Recurring
            </Button>
          </div>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No recurring schedules yet. Add one to stop re-creating each week by
                hand.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => (
                <Card
                  key={t.id}
                  data-testid={`template-${t.id}`}
                  data-active={t.active}
                  className={t.active ? undefined : "border-dashed bg-muted/40"}
                >
                  <CardContent className="p-5 flex items-start gap-4">
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
                        <Badge variant="outline" className="text-[10px]">
                          {callTypeLabel(t.callType)}
                        </Badge>
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
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          {t.intervalDays === 7
                            ? `Every ${format(new Date(t.anchorAt), "EEEE")} • ${format(new Date(t.anchorAt), "h:mm a")}`
                            : `Every ${t.intervalDays} days • ${format(new Date(t.anchorAt), "h:mm a")}`}
                        </span>
                        <span>{t.durationMinutes} min</span>
                        <span>with {t.coachName}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {t.active ? (
                          <>
                            {t.lastGeneratedAt
                              ? `Scheduled through ${format(new Date(t.lastGeneratedAt), "EEE, MMM d")}`
                              : "No calls generated yet"}
                            {" • generates "}
                            {t.occurrencesPerBatch} at a time
                          </>
                        ) : (
                          "Paused — no new calls will be generated until resumed"
                        )}
                      </p>
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
                        onClick={() => handleGenerate(t)}
                        disabled={generatingId === t.id || !t.active}
                        data-testid={`generate-template-${t.id}`}
                        title={
                          t.active
                            ? "Generate more weeks"
                            : "Resume the schedule to generate calls"
                        }
                      >
                        <CalendarPlus className="w-4 h-4" />
                      </Button>
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
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Call" : "Add Call"}</DialogTitle>
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
            <DialogTitle>Delete call?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes{" "}
            <strong className="text-foreground">{deleteTarget?.title}</strong> from the
            schedule. Members will no longer see it.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete-call"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {templateForm.id ? "Edit Recurring Schedule" : "Add Recurring Schedule"}
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
            {templateForm.id ? (
              <p className="text-xs text-muted-foreground">
                The first-call time and weekly cadence are locked once a series is
                created. Edits here only affect calls generated from now on — already
                scheduled calls are left untouched.
              </p>
            ) : (
              <div>
                <Label className="text-xs">First Call (Date &amp; Time) *</Label>
                <Input
                  type="datetime-local"
                  value={templateForm.anchorAt}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, anchorAt: e.target.value })
                  }
                  data-testid="template-anchor-at"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Repeats weekly on this day &amp; time.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
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
                <Label className="text-xs">Weeks to Generate</Label>
                <Input
                  type="number"
                  value={templateForm.occurrencesPerBatch}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      occurrencesPerBatch: e.target.value,
                    })
                  }
                  data-testid="template-batch"
                />
              </div>
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
              {isTemplateMutating ? "Saving…" : templateForm.id ? "Save" : "Create & Schedule"}
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
            <DialogTitle>Remove recurring schedule?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This stops{" "}
            <strong className="text-foreground">{templateDeleteTarget?.title}</strong>{" "}
            from generating new weeks. Calls already on the schedule stay put — delete
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
    </PackCoachingAdminLayout>
  );
}
