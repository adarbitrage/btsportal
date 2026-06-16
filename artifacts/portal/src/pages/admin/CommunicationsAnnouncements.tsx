import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { listAdminAnnouncements, createAnnouncement, type AdminAnnouncement } from "@/lib/admin-api";
import { Plus, Megaphone } from "lucide-react";
import { format } from "date-fns";

const TYPE_OPTIONS = [
  { value: "new_content", label: "New Content" },
  { value: "event", label: "Event" },
  { value: "milestone", label: "Milestone" },
  { value: "general", label: "General" },
];

const TYPE_COLORS: Record<string, string> = {
  new_content: "bg-blue-100 text-blue-800",
  event: "bg-purple-100 text-purple-800",
  milestone: "bg-green-100 text-green-800",
  general: "bg-gray-100 text-gray-800",
};

export default function CommunicationsAnnouncements() {
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "new_content" });

  async function load() {
    try {
      setLoading(true);
      setAnnouncements(await listAdminAnnouncements());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ title: "", body: "", type: "new_content" });
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Title and body are required", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      await createAnnouncement({
        title: form.title.trim(),
        body: form.body.trim(),
        type: form.type,
      });
      toast({
        title: "Announcement published",
        description:
          form.type === "new_content"
            ? "Opted-in members will receive a new-content text on the next scan."
            : "Announcement is now visible to members.",
      });
      setCreateOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CommunicationsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Announcements</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Publish announcements to members. New-content announcements trigger texts to opted-in members.
            </p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Announcement</Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : announcements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No announcements yet</div>
        ) : (
          <div className="grid gap-4">
            {announcements.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Megaphone className="w-4 h-4 text-primary shrink-0" />
                      <h3 className="font-semibold text-foreground truncate">{a.title}</h3>
                      <Badge className={TYPE_COLORS[a.type] || ""}>{a.type}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{a.body}</p>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {a.createdAt ? format(new Date(a.createdAt), "MMM d, yyyy") : ""}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
            <DialogDescription>
              "New Content" announcements text members who enabled new-content alerts (within ~15 min of publishing).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="New Track: Advanced Strategies" />
            </div>
            <div>
              <label className="text-sm font-medium">Body</label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} placeholder="What's new..." />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? "Publishing..." : "Publish"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
