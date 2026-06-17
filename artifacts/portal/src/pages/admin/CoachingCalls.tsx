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
import { Plus, Pencil, Trash2, Calendar, Video, Link2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminCoachingCalls,
  useCoachingCallCoaches,
  useCreateCoachingCall,
  useUpdateCoachingCall,
  useDeleteCoachingCall,
  type AdminCoachingCall,
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

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CallForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminCoachingCall | null>(null);

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

  const isMutating = createMutation.isPending || updateMutation.isPending;

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
    </PackCoachingAdminLayout>
  );
}
