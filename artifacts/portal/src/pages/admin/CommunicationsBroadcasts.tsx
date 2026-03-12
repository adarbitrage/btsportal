import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import {
  Plus, Megaphone, Send, Copy, Trash2, Pencil, Eye, Users,
  Calendar, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-800",
    scheduled: "bg-blue-100 text-blue-800",
    sending: "bg-yellow-100 text-yellow-800",
    sent: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  return <Badge className={colors[status] || ""}>{status}</Badge>;
}

export default function CommunicationsBroadcasts() {
  const { toast } = useToast();
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editBroadcast, setEditBroadcast] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sendConfirmData, setSendConfirmData] = useState<any>(null);
  const [form, setForm] = useState({
    name: "", channel: "email", subject: "", htmlBody: "", textBody: "", smsBody: "",
    segmentFilter: "{}", scheduledAt: "",
  });

  async function load() {
    try {
      setLoading(true);
      setBroadcasts(await commsApi.listBroadcasts());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditBroadcast(null);
    setForm({ name: "", channel: "email", subject: "", htmlBody: "", textBody: "", smsBody: "", segmentFilter: "{}", scheduledAt: "" });
    setEditOpen(true);
  }

  function openEdit(b: any) {
    setEditBroadcast(b);
    setForm({
      name: b.name, channel: b.channel, subject: b.subject || "", htmlBody: b.htmlBody || "",
      textBody: b.textBody || "", smsBody: b.smsBody || "",
      segmentFilter: JSON.stringify(b.segmentFilter || {}, null, 2),
      scheduledAt: b.scheduledAt ? new Date(b.scheduledAt).toISOString().slice(0, 16) : "",
    });
    setEditOpen(true);
  }

  async function handleSave() {
    try {
      let segmentFilter = {};
      try { segmentFilter = JSON.parse(form.segmentFilter); } catch { }
      const data = { ...form, segmentFilter };
      if (editBroadcast) {
        await commsApi.updateBroadcast(editBroadcast.id, data);
        toast({ title: "Broadcast updated" });
      } else {
        await commsApi.createBroadcast(data);
        toast({ title: "Broadcast created" });
      }
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this broadcast?")) return;
    try {
      await commsApi.deleteBroadcast(id);
      toast({ title: "Broadcast deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handlePreview(id: number) {
    try {
      const data = await commsApi.previewBroadcast(id);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleSend(id: number) {
    try {
      const result = await commsApi.sendBroadcast(id, false);
      if (result.requiresConfirmation) {
        setSendingId(id);
        setSendConfirmData(result);
        setConfirmSendOpen(true);
      } else {
        toast({ title: "Broadcast sent", description: `Sent to ${result.recipientCount} recipients` });
        load();
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function confirmSend() {
    if (!sendingId) return;
    try {
      const result = await commsApi.sendBroadcast(sendingId, true);
      toast({ title: "Broadcast sent", description: `Sent to ${result.recipientCount} recipients` });
      setConfirmSendOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDuplicate(id: number) {
    try {
      await commsApi.duplicateBroadcast(id);
      toast({ title: "Broadcast duplicated" });
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
            <h1 className="text-2xl font-bold text-foreground">Broadcasts</h1>
            <p className="text-sm text-muted-foreground mt-1">Send targeted communications to member segments</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Broadcast</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : broadcasts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No broadcasts found</div>
        ) : (
          <div className="grid gap-4">
            {broadcasts.map(b => (
              <Card key={b.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5">
                      <Megaphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{b.name}</h3>
                        <StatusBadge status={b.status} />
                        <Badge variant="outline">{b.channel}</Badge>
                      </div>
                      {b.subject && <p className="text-sm text-muted-foreground">Subject: {b.subject}</p>}
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {b.sentAt && <span>Sent {format(new Date(b.sentAt), "MMM d, yyyy h:mm a")}</span>}
                        {b.scheduledAt && b.status === "scheduled" && (
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Scheduled {format(new Date(b.scheduledAt), "MMM d, yyyy h:mm a")}</span>
                        )}
                        {b.totalRecipients > 0 && (
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{b.totalRecipients} recipients</span>
                        )}
                      </div>
                      {b.status === "sent" && (
                        <div className="flex items-center gap-3 mt-2 text-xs">
                          <span className="text-green-600">Sent: {b.sentCount}</span>
                          <span className="text-blue-600">Delivered: {b.deliveredCount}</span>
                          <span className="text-purple-600">Opened: {b.openedCount}</span>
                          <span className="text-amber-600">Clicked: {b.clickedCount}</span>
                          {b.bouncedCount > 0 && <span className="text-red-600">Bounced: {b.bouncedCount}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handlePreview(b.id)}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDuplicate(b.id)}><Copy className="w-4 h-4" /></Button>
                    {b.status === "draft" && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(b)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleSend(b.id)}><Send className="w-4 h-4 text-green-600" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(b.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editBroadcast ? "Edit Broadcast" : "New Broadcast"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="March Newsletter" />
              </div>
              <div>
                <label className="text-sm font-medium">Channel</label>
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.channel === "email" ? (
              <>
                <div>
                  <label className="text-sm font-medium">Subject</label>
                  <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                </div>
                <Tabs defaultValue="html">
                  <TabsList>
                    <TabsTrigger value="html">HTML Body</TabsTrigger>
                    <TabsTrigger value="text">Text Body</TabsTrigger>
                  </TabsList>
                  <TabsContent value="html">
                    <Textarea value={form.htmlBody} onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))} rows={10} className="font-mono text-xs" />
                  </TabsContent>
                  <TabsContent value="text">
                    <Textarea value={form.textBody} onChange={e => setForm(f => ({ ...f, textBody: e.target.value }))} rows={6} />
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <div>
                <label className="text-sm font-medium">SMS Body</label>
                <Textarea value={form.smsBody} onChange={e => setForm(f => ({ ...f, smsBody: e.target.value }))} rows={4} />
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Segment Filter (JSON)</label>
              <Textarea value={form.segmentFilter} onChange={e => setForm(f => ({ ...f, segmentFilter: e.target.value }))} rows={5} className="font-mono text-xs" placeholder='{"products": ["backroad"], "smsOptIn": true}' />
              <p className="text-xs text-muted-foreground mt-1">
                Keys: products (array), experienceLevel, smsOptIn (bool), registeredAfter, registeredBefore, lastLoginAfter, lastLoginBefore
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Schedule (optional)</label>
              <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editBroadcast ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Broadcast Preview</DialogTitle>
          </DialogHeader>
          {previewData && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-lg font-bold">{previewData.estimatedCount}</span>
                <span className="text-sm text-muted-foreground">estimated recipients</span>
              </div>
              {previewData.sampleRecipients?.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Sample Recipients</h4>
                  <div className="space-y-1">
                    {previewData.sampleRecipients.map((r: any) => (
                      <div key={r.id} className="text-sm flex items-center gap-2 py-1 px-2 bg-muted/50 rounded">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground">{r.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Confirm Send
            </DialogTitle>
            <DialogDescription>
              {sendConfirmData?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSendOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmSend}>Yes, Send to {sendConfirmData?.recipientCount} Recipients</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
