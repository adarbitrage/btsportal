import { useState, useEffect } from "react";
import { CommunicationsLayout } from "@/components/layout/CommunicationsLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { commsApi } from "@/lib/communications-api";
import { Plus, Pencil, Trash2, Eye, History, RotateCcw, Search, Code } from "lucide-react";
import { format } from "date-fns";

export default function CommunicationsTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", subject: "", htmlBody: "", textBody: "", category: "transactional", fromName: "", variables: "" });

  async function loadTemplates() {
    try {
      setLoading(true);
      const data = await commsApi.listEmailTemplates();
      setTemplates(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTemplates(); }, []);

  function openCreate() {
    setEditTemplate(null);
    setForm({ slug: "", name: "", subject: "", htmlBody: "", textBody: "", category: "transactional", fromName: "", variables: "" });
    setEditOpen(true);
  }

  function openEdit(t: any) {
    setEditTemplate(t);
    setForm({
      slug: t.slug, name: t.name, subject: t.subject, htmlBody: t.htmlBody, textBody: t.textBody,
      category: t.category, fromName: t.fromName || "", variables: (t.variables || []).join(", "),
    });
    setEditOpen(true);
  }

  async function handleSave() {
    try {
      const data = {
        ...form,
        variables: form.variables.split(",").map(v => v.trim()).filter(Boolean),
      };
      if (editTemplate) {
        await commsApi.updateEmailTemplate(editTemplate.id, data);
        toast({ title: "Template updated" });
      } else {
        await commsApi.createEmailTemplate(data);
        toast({ title: "Template created" });
      }
      setEditOpen(false);
      loadTemplates();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this template?")) return;
    try {
      await commsApi.deleteEmailTemplate(id);
      toast({ title: "Template deleted" });
      loadTemplates();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handlePreview(id: number) {
    try {
      const data = await commsApi.previewEmailTemplate(id);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleVersions(id: number) {
    try {
      const data = await commsApi.getTemplateVersions(id);
      setVersions(data);
      setSelectedTemplateId(id);
      setVersionsOpen(true);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  async function handleRestore(versionId: number) {
    if (!selectedTemplateId || !confirm("Restore this version?")) return;
    try {
      await commsApi.restoreTemplateVersion(selectedTemplateId, versionId);
      toast({ title: "Version restored" });
      setVersionsOpen(false);
      loadTemplates();
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
            <h1 className="text-2xl font-bold text-foreground">Email Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage email templates with versioning and preview</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Template</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No templates found</div>
        ) : (
          <div className="grid gap-4">
            {filtered.map(t => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{t.name}</h3>
                      <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Active" : "Inactive"}</Badge>
                      <Badge variant="outline">{t.category}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground"><Code className="w-3 h-3 inline mr-1" />{t.slug}</p>
                    <p className="text-sm text-muted-foreground mt-1">Subject: {t.subject}</p>
                    {t.variables && t.variables.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {t.variables.map((v: string) => (
                          <span key={v} className="text-[10px] px-1.5 py-0.5 bg-primary/5 text-primary rounded font-mono">{`{{${v}}}`}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handlePreview(t.id)}><Eye className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleVersions(t.id)}><History className="w-4 h-4" /></Button>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTemplate ? "Edit Template" : "New Email Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Slug</label>
                <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} disabled={!!editTemplate} placeholder="welcome_email" />
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Welcome Email" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Subject</label>
              <Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Welcome to {{member_name}}!" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transactional">Transactional</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="notification">Notification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">From Name</label>
                <Input value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} placeholder="Build Test Scale" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Variables (comma-separated)</label>
              <Input value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))} placeholder="member_name, portal_url, product_name" />
            </div>
            <Tabs defaultValue="html">
              <TabsList>
                <TabsTrigger value="html">HTML Body</TabsTrigger>
                <TabsTrigger value="text">Text Body</TabsTrigger>
              </TabsList>
              <TabsContent value="html">
                <Textarea value={form.htmlBody} onChange={e => setForm(f => ({ ...f, htmlBody: e.target.value }))} rows={12} className="font-mono text-xs" placeholder="<html>..." />
              </TabsContent>
              <TabsContent value="text">
                <Textarea value={form.textBody} onChange={e => setForm(f => ({ ...f, textBody: e.target.value }))} rows={8} placeholder="Plain text version..." />
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editTemplate ? "Save Changes" : "Create Template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
          </DialogHeader>
          {previewData && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Subject</label>
                <p className="text-sm bg-muted p-2 rounded">{previewData.subject}</p>
              </div>
              <Tabs defaultValue="rendered">
                <TabsList>
                  <TabsTrigger value="rendered">Rendered HTML</TabsTrigger>
                  <TabsTrigger value="text">Plain Text</TabsTrigger>
                </TabsList>
                <TabsContent value="rendered">
                  <div className="border rounded-lg overflow-hidden">
                    <iframe srcDoc={previewData.htmlBody} className="w-full h-[400px]" title="Preview" sandbox="" />
                  </div>
                </TabsContent>
                <TabsContent value="text">
                  <pre className="text-xs bg-muted p-4 rounded whitespace-pre-wrap">{previewData.textBody}</pre>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Template Versions</DialogTitle>
          </DialogHeader>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No previous versions found</p>
          ) : (
            <div className="space-y-3">
              {versions.map(v => (
                <Card key={v.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Version {v.version}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(v.createdAt), "MMM d, yyyy h:mm a")}</p>
                      <p className="text-xs text-muted-foreground">Subject: {v.subject}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleRestore(v.id)}>
                      <RotateCcw className="w-3 h-3 mr-1" />Restore
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CommunicationsLayout>
  );
}
