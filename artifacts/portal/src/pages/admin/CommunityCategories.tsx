import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PlusCircle, Pencil, Trash2, ArrowUp, ArrowDown, FolderOpen } from "lucide-react";
import { adminApi, type Category } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

export default function CommunityCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminApi.getCategories();
      setCategories(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "" });
    setDialogOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setForm({ name: cat.name, slug: cat.slug, description: cat.description || "" });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editing) {
        await adminApi.updateCategory(editing.id, {
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
        });
        toast({ title: "Category updated" });
      } else {
        await adminApi.createCategory({
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
        });
        toast({ title: "Category created" });
      }
      setDialogOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeactivate = async (cat: Category) => {
    if (!confirm(`Deactivate "${cat.name}"? Posts will remain but no new posts can be added.`)) return;
    try {
      await adminApi.deactivateCategory(cat.id);
      toast({ title: "Category deactivated" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReactivate = async (cat: Category) => {
    try {
      await adminApi.updateCategory(cat.id, { isActive: true });
      toast({ title: "Category reactivated" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const newCats = [...categories];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newCats.length) return;
    [newCats[index], newCats[swapIndex]] = [newCats[swapIndex], newCats[index]];
    const order = newCats.map((c, i) => ({ id: c.id, sortOrder: i }));
    try {
      const updated = await adminApi.reorderCategories(order);
      setCategories(updated);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const autoSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Community Categories</h1>
            <p className="text-muted-foreground mt-1">Manage discussion categories for the community</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Category" : "Create Category"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm(f => ({
                        ...f,
                        name,
                        slug: editing ? f.slug : autoSlug(name),
                      }));
                    }}
                    placeholder="e.g. Wins & Celebrations"
                  />
                </div>
                <div>
                  <Label>Slug</Label>
                  <Input
                    value={form.slug}
                    onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                    placeholder="e.g. wins"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
                <Button onClick={handleSubmit} className="w-full">
                  {editing ? "Update Category" : "Create Category"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading categories...</div>
        ) : categories.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No categories yet. Create your first category to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {categories.map((cat, index) => (
              <Card key={cat.id} className={!cat.isActive ? "opacity-60" : ""}>
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleMove(index, "up")}
                      disabled={index === 0}
                      className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleMove(index, "down")}
                      disabled={index === categories.length - 1}
                      className="p-1 rounded hover:bg-secondary disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{cat.name}</h3>
                      <Badge variant={cat.isActive ? "default" : "secondary"}>
                        {cat.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      /{cat.slug} · {cat.postsCount} posts
                      {cat.description && ` · ${cat.description}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(cat)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {cat.isActive ? (
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(cat)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => handleReactivate(cat)}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
