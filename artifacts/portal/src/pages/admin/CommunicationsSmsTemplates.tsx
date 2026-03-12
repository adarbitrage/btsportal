import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import { Plus, Pencil, Trash2, Search, Code, MessageSquare } from "lucide-react";

export default function CommunicationsSmsTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [form, setForm] = useState({ slug: "", name: "", body: "", variables: "" });

  async function load() {
    try {
      setLoading(true);
      setTemplates(await commsApi.listSmsTemplates());
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditTemplate(null);
    setForm({ slug: "", name: "", body: "", variables: "" });
    setEditOpen(true);
  }

  function openEdit(t: any) {
    setEditTemplate(t);
    setForm({ slug: t.slug, name: t.name, body: t.body, variables: (t.variables || []).join(", ") });
    setEditOpen(true);
  }

  async function handleSave() {
    try {
      const data = { ...form, variables: form.variables.split(",").map(v => v.trim()).filter(Boolean) };
      if (editTemplate) {
        await commsApi.updateSmsTemplate(editTemplate.id, data);
        toast({ title: "SMS template updated" });
      } else {
        await commsApi.createSmsTemplate(data);
        toast({ title: "SMS template created" });
      }
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this SMS template?")) return;
    try {
      await commsApi.deleteSmsTemplate(id);
      toast({ title: "SMS template deleted" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <CommunicationsLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">SMS Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage SMS message templates</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New SMS Template</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search SMS templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No SMS templates found</div>
        ) : (
          <div className="grid gap-4">
            {filtered.map(t => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      <h3 className="font-semibold text-foreground">{t.name}</h3>
                      <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground"><Code className="w-3 h-3 inline mr-1" />{t.slug}</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xl truncate">{t.body}</p>
                    {t.variables && t.variables.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {t.variables.map((v: string) => (
                          <span key={v} className="text-[10px] px-1.5 py-0.5 bg-primary/5 text-primary rounded font-mono">{`{{${v}}}`}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(t.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Edit SMS Template" : "New SMS Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Slug</label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} disabled={!!editTemplate} />
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Message Body</label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} />
              <p className="text-xs text-muted-foreground mt-1">{form.body.length}/160 characters</p>
            </div>
            <div>
              <label className="text-sm font-medium">Variables (comma-separated)</label>
              <Input value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editTemplate ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
