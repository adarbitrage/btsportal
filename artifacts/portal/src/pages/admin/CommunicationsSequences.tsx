import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import {
  Plus, Pencil, Trash2, Users, Pause, Play, GitBranch,
  ChevronDown, ChevronUp, UserPlus, UserX, ArrowUpDown,
} from "lucide-react";
import { format } from "date-fns";

export default function CommunicationsSequences() {
  const { toast } = useToast();
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editSeq, setEditSeq] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "", triggerEvent: "" });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [stepForm, setStepForm] = useState({ channel: "email", templateSlug: "", subject: "", delayMinutes: "0" });
  const [addStepOpen, setAddStepOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollUserId, setEnrollUserId] = useState("");

  async function load() {
    try {
      setLoading(true);
      setSequences(await commsApi.listSequences());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditSeq(null);
    setForm({ name: "", description: "", triggerEvent: "" });
    setEditOpen(true);
  }

  function openEdit(s: any) {
    setEditSeq(s);
    setForm({ name: s.name, description: s.description || "", triggerEvent: s.triggerEvent || "" });
    setEditOpen(true);
  }

  async function handleSave() {
    try {
      if (editSeq) {
        await commsApi.updateSequence(editSeq.id, form);
        toast({ title: "Sequence updated" });
      } else {
        await commsApi.createSequence(form);
        toast({ title: "Sequence created" });
      }
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this sequence and all its steps?")) return;
    try {
      await commsApi.deleteSequence(id);
      toast({ title: "Sequence deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function openDetail(id: number) {
    try {
      const data = await commsApi.getSequence(id);
      setDetail(data);
      setDetailOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function togglePause(id: number, currentStatus: string) {
    try {
      if (currentStatus === "active") {
        await commsApi.pauseSequence(id);
        toast({ title: "Sequence paused" });
      } else {
        await commsApi.resumeSequence(id);
        toast({ title: "Sequence resumed" });
      }
      load();
      if (detail && detail.id === id) {
        setDetail({ ...detail, status: currentStatus === "active" ? "paused" : "active" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleAddStep() {
    if (!detail) return;
    try {
      await commsApi.addStep(detail.id, {
        ...stepForm,
        delayMinutes: parseInt(stepForm.delayMinutes, 10) || 0,
      });
      toast({ title: "Step added" });
      setAddStepOpen(false);
      const updated = await commsApi.getSequence(detail.id);
      setDetail(updated);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDeleteStep(stepId: number) {
    if (!detail || !confirm("Delete this step?")) return;
    try {
      await commsApi.deleteStep(detail.id, stepId);
      toast({ title: "Step deleted" });
      const updated = await commsApi.getSequence(detail.id);
      setDetail(updated);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleEnroll() {
    if (!detail) return;
    try {
      await commsApi.enrollUser(detail.id, parseInt(enrollUserId, 10));
      toast({ title: "User enrolled" });
      setEnrollOpen(false);
      setEnrollUserId("");
      const updated = await commsApi.getSequence(detail.id);
      setDetail(updated);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleCancelEnrollment(enrollmentId: number) {
    if (!detail || !confirm("Cancel this enrollment?")) return;
    try {
      await commsApi.cancelEnrollment(detail.id, enrollmentId);
      toast({ title: "Enrollment cancelled" });
      const updated = await commsApi.getSequence(detail.id);
      setDetail(updated);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  return (
    <CommunicationsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sequences</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage automated communication sequences</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Sequence</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : sequences.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No sequences found</div>
        ) : (
          <div className="grid gap-4">
            {sequences.map(s => (
              <Card key={s.id} className="p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => openDetail(s.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{s.name}</h3>
                        <Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge>
                      </div>
                      {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span>{s.stepCount} steps</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.activeEnrollments} active</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => togglePause(s.id, s.status)}>
                      {s.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editSeq ? "Edit Sequence" : "New Sequence"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div>
              <label className="text-sm font-medium">Trigger Event</label>
              <Input value={form.triggerEvent} onChange={e => setForm(f => ({ ...f, triggerEvent: e.target.value }))} placeholder="e.g. user_registered, product_purchased" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editSeq ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Badge variant={detail.status === "active" ? "default" : "secondary"}>{detail.status}</Badge>
                {detail.triggerEvent && <Badge variant="outline">Trigger: {detail.triggerEvent}</Badge>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Steps ({detail.steps?.length || 0})</h3>
                  <Button size="sm" onClick={() => { setStepForm({ channel: "email", templateSlug: "", subject: "", delayMinutes: "0" }); setAddStepOpen(true); }}>
                    <Plus className="w-3 h-3 mr-1" />Add Step
                  </Button>
                </div>
                <div className="space-y-2">
                  {detail.steps?.map((step: any, idx: number) => (
                    <Card key={step.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">{step.channel}</Badge>
                              {step.templateSlug && <span className="text-xs font-mono text-muted-foreground">{step.templateSlug}</span>}
                              {step.subject && <span className="text-xs text-muted-foreground">{step.subject}</span>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Delay: {step.delayMinutes >= 1440
                                ? `${Math.floor(step.delayMinutes / 1440)}d ${step.delayMinutes % 1440 > 0 ? `${Math.floor((step.delayMinutes % 1440) / 60)}h` : ""}`
                                : step.delayMinutes >= 60
                                  ? `${Math.floor(step.delayMinutes / 60)}h ${step.delayMinutes % 60 > 0 ? `${step.delayMinutes % 60}m` : ""}`
                                  : `${step.delayMinutes}m`}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteStep(step.id)}>
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Enrollments ({detail.enrollments?.length || 0})</h3>
                  <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                    <UserPlus className="w-3 h-3 mr-1" />Enroll User
                  </Button>
                </div>
                {detail.enrollments?.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {detail.enrollments.map((e: any) => (
                      <div key={e.enrollment.id} className="flex items-center justify-between py-2 px-3 rounded bg-muted/50">
                        <div>
                          <p className="text-sm font-medium">{e.userName || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{e.userEmail}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={e.enrollment.status === "active" ? "default" : "secondary"} className="text-[10px]">{e.enrollment.status}</Badge>
                            <span className="text-[10px] text-muted-foreground">Enrolled {format(new Date(e.enrollment.enrolledAt), "MMM d, yyyy")}</span>
                          </div>
                        </div>
                        {e.enrollment.status === "active" && (
                          <Button variant="ghost" size="sm" onClick={() => handleCancelEnrollment(e.enrollment.id)}>
                            <UserX className="w-3 h-3 text-red-500" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No enrollments</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Sequence Step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Channel</label>
              <Select value={stepForm.channel} onValueChange={v => setStepForm(f => ({ ...f, channel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Template Slug (optional)</label>
              <Input value={stepForm.templateSlug} onChange={e => setStepForm(f => ({ ...f, templateSlug: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Subject (if no template)</label>
              <Input value={stepForm.subject} onChange={e => setStepForm(f => ({ ...f, subject: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Delay (minutes)</label>
              <Input type="number" value={stepForm.delayMinutes} onChange={e => setStepForm(f => ({ ...f, delayMinutes: e.target.value }))} />
              <p className="text-xs text-muted-foreground mt-1">Use 1440 for 1 day, 10080 for 1 week</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStepOpen(false)}>Cancel</Button>
            <Button onClick={handleAddStep}>Add Step</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll User</DialogTitle>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium">User ID</label>
            <Input type="number" value={enrollUserId} onChange={e => setEnrollUserId(e.target.value)} placeholder="Enter user ID" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button onClick={handleEnroll}>Enroll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
