import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlusCircle, Pencil, Trash2, FileText, Image, Mail, Share2 } from "lucide-react";
import { commissionAdminApi, type AffiliateResource } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";

const RESOURCE_TYPES = [
  { value: "email_swipe", label: "Email Swipe", icon: Mail },
  { value: "social_post", label: "Social Post", icon: Share2 },
  { value: "banner", label: "Banner Image", icon: Image },
  { value: "guideline", label: "Guideline", icon: FileText },
];

const EMPTY_FORM = {
  type: "email_swipe",
  title: "",
  description: "",
  content: "",
  fileUrl: "",
  thumbnailUrl: "",
  productSlug: "",
  sortOrder: "0",
  status: "active",
};

export default function CommissionResources() {
  const [resources, setResources] = useState<AffiliateResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AffiliateResource | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getResources();
      setResources(data.resources);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (r: AffiliateResource) => {
    setEditing(r);
    setForm({
      type: r.type,
      title: r.title,
      description: r.description || "",
      content: r.content || "",
      fileUrl: r.fileUrl || "",
      thumbnailUrl: r.thumbnailUrl || "",
      productSlug: r.productSlug || "",
      sortOrder: String(r.sortOrder),
      status: r.status,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    try {
      const data = {
        type: form.type,
        title: form.title,
        description: form.description || undefined,
        content: form.content || undefined,
        fileUrl: form.fileUrl || undefined,
        thumbnailUrl: form.thumbnailUrl || undefined,
        productSlug: form.productSlug || undefined,
        sortOrder: parseInt(form.sortOrder) || 0,
        status: form.status,
      };
      if (editing) {
        await commissionAdminApi.updateResource(editing.id, data);
        toast({ title: "Resource updated" });
      } else {
        await commissionAdminApi.createResource(data);
        toast({ title: "Resource created" });
      }
      setDialogOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this resource?")) return;
    try {
      await commissionAdminApi.deleteResource(id);
      toast({ title: "Resource deleted" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const typeIcon = (type: string) => {
    const t = RESOURCE_TYPES.find(rt => rt.value === type);
    return t ? t.icon : FileText;
  };

  const typeLabel = (type: string) => {
    const t = RESOURCE_TYPES.find(rt => rt.value === type);
    return t ? t.label : type;
  };

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Promotional Resources</h1>
            <p className="text-muted-foreground mt-1">Manage affiliate promotional materials</p>
          </div>
          <Button onClick={openCreate}>
            <PlusCircle className="w-4 h-4 mr-2" />
            Add Resource
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading resources...</div>
        ) : resources.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No promotional resources yet. Create your first resource.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {resources.map((r) => {
              const Icon = typeIcon(r.type);
              return (
                <Card key={r.id} className={r.status !== "active" ? "opacity-60" : ""}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5 text-primary" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground">{r.title}</h3>
                            <Badge variant="outline">{typeLabel(r.type)}</Badge>
                            <Badge variant={r.status === "active" ? "default" : "secondary"}>
                              {r.status}
                            </Badge>
                          </div>
                          {r.description && (
                            <p className="text-sm text-muted-foreground">{r.description}</p>
                          )}
                          {r.content && (
                            <p className="text-sm text-muted-foreground line-clamp-2 max-w-xl">{r.content}</p>
                          )}
                          {r.fileUrl && (
                            <a href={r.fileUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                              View file
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Resource" : "Add Resource"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Resource title"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description"
              />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Full text content (email swipe body, social post text, etc.)"
                rows={5}
              />
            </div>
            <div>
              <Label>File URL</Label>
              <Input
                value={form.fileUrl}
                onChange={(e) => setForm(f => ({ ...f, fileUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>Thumbnail URL</Label>
              <Input
                value={form.thumbnailUrl}
                onChange={(e) => setForm(f => ({ ...f, thumbnailUrl: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Product Slug</Label>
                <Input
                  value={form.productSlug}
                  onChange={(e) => setForm(f => ({ ...f, productSlug: e.target.value }))}
                  placeholder="e.g. launchpad"
                />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleSubmit}>
              {editing ? "Update Resource" : "Create Resource"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CommissionAdminLayout>
  );
}
