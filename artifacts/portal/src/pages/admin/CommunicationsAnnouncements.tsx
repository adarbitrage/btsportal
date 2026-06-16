import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { listAdminAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, type AdminAnnouncement } from "@/lib/admin-api";
import { Plus, Megaphone, Pencil, Trash2 } from "lucide-react";
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "new_content" });
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncement | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setEditingId(null);
    setForm({ title: "", body: "", type: "new_content" });
    setEditorOpen(true);
  }

  function openEdit(a: AdminAnnouncement) {
    setEditingId(a.id);
    setForm({ title: a.title, body: a.body, type: a.type });
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Title and body are required", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      if (editingId !== null) {
        await updateAnnouncement(editingId, {
          title: form.title.trim(),
          body: form.body.trim(),
          type: form.type,
        });
        toast({
          title: "Announcement updated",
          description: "Changes are saved. Members already texted won't be re-notified.",
        });
      } else {
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
      }
      setEditorOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteAnnouncement(deleteTarget.id);
      toast({ title: "Announcement deleted" });
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
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
                  <div className="flex items-start gap-3 shrink-0">
                    <div className="text-xs text-muted-foreground whitespace-nowrap pt-1">
                      {a.createdAt ? format(new Date(a.createdAt), "MMM d, yyyy") : ""}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(a)} aria-label="Edit announcement">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(a)} aria-label="Delete announcement">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            <DialogDescription>
              {editingId !== null
                ? "Editing won't re-text members who were already notified about this announcement."
                : '"New Content" announcements text members who enabled new-content alerts (within ~15 min of publishing).'}
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
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {editingId !== null
                ? (saving ? "Saving..." : "Save Changes")
                : (saving ? "Publishing..." : "Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed and members will no longer see it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CommunicationsLayout>
  );
}
