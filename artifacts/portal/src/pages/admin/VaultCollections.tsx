import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  FolderOpen,
  FolderPlus,
  GripVertical,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  useAdminVaultCollections,
  useAdminCreateVaultCollection,
  useAdminUpdateVaultCollection,
  useAdminDeleteVaultCollection,
  type VaultCollection,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

const ENTITLEMENTS = [
  { value: "content:frontend", label: "Front-End Members" },
  { value: "content:advanced", label: "LaunchPad" },
  { value: "coaching:group", label: "3-Month Mentorship" },
  { value: "coaching:mastermind", label: "6-Month Mentorship" },
  { value: "access:lifetime", label: "Lifetime Mentorship" },
];

interface CollectionFormData {
  name: string;
  slug: string;
  description: string;
  icon: string;
  coverImageUrl: string;
  requiredEntitlement: string;
  parentId: number | null;
  isActive: boolean;
}

const defaultFormData: CollectionFormData = {
  name: "",
  slug: "",
  description: "",
  icon: "",
  coverImageUrl: "",
  requiredEntitlement: "content:frontend",
  parentId: null,
  isActive: true,
};

export default function VaultCollections() {
  const { data: collections, isLoading } = useAdminVaultCollections();
  const createCollection = useAdminCreateVaultCollection();
  const updateCollection = useAdminUpdateVaultCollection();
  const deleteCollection = useAdminDeleteVaultCollection();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CollectionFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const topLevel = (collections || []).filter(c => !c.parentId);
  const getChildren = (parentId: number) => (collections || []).filter(c => c.parentId === parentId);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreateDialog = (parentId: number | null = null) => {
    setEditingId(null);
    setFormData({ ...defaultFormData, parentId });
    setDialogOpen(true);
  };

  const openEditDialog = (collection: VaultCollection) => {
    setEditingId(collection.id);
    setFormData({
      name: collection.name,
      slug: collection.slug,
      description: collection.description || "",
      icon: collection.icon || "",
      coverImageUrl: collection.coverImageUrl || "",
      requiredEntitlement: collection.requiredEntitlement || "content:frontend",
      parentId: collection.parentId,
      isActive: collection.isActive,
    });
    setDialogOpen(true);
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const slug = formData.slug || generateSlug(formData.name);

    try {
      if (editingId) {
        await updateCollection.mutateAsync({ id: editingId, ...formData, slug });
        toast({ title: "Collection updated" });
      } else {
        await createCollection.mutateAsync({ ...formData, slug } as any);
        toast({ title: "Collection created" });
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCollection.mutateAsync(id);
      toast({ title: "Collection deleted" });
      setDeleteConfirmId(null);
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    }
  };

  const renderCollection = (collection: VaultCollection, depth: number = 0) => {
    const children = getChildren(collection.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(collection.id);

    return (
      <div key={collection.id}>
        <div
          className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors border-b border-border"
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab" />
          {hasChildren ? (
            <button onClick={() => toggleExpand(collection.id)} className="p-0.5">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <div className="w-5" />
          )}
          <FolderOpen className="w-4 h-4 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{collection.name}</span>
              {collection.icon && <span className="text-sm">{collection.icon}</span>}
              {!collection.isActive && <Badge variant="secondary" className="text-[9px]">Inactive</Badge>}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>/{collection.slug}</span>
              {collection.description && <span>· {collection.description}</span>}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">{collection.requiredEntitlement}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEditDialog(collection)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openCreateDialog(collection.id)}>
                <FolderPlus className="w-4 h-4 mr-2" /> Add Sub-Collection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteConfirmId(collection.id)} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isExpanded && children.map(child => renderCollection(child, depth + 1))}
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Collections</h1>
            <p className="text-muted-foreground">Organize resources into collections and sub-collections</p>
          </div>
          <Button onClick={() => openCreateDialog()}>
            <Plus className="w-4 h-4 mr-2" /> Add Collection
          </Button>
        </div>

        <Card>
          <div className="px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
            Collections ({(collections || []).length})
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading collections...</div>
          ) : topLevel.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No collections yet. Create your first collection to get started.
            </div>
          ) : (
            topLevel.map(c => renderCollection(c))
          )}
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Collection" : "Create Collection"}</DialogTitle>
              <DialogDescription>
                {formData.parentId ? "Create a sub-collection" : editingId ? "Update collection details" : "Add a new top-level collection"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => {
                    setFormData(prev => ({
                      ...prev,
                      name: e.target.value,
                      slug: editingId ? prev.slug : generateSlug(e.target.value),
                    }));
                  }}
                  placeholder="Collection name"
                />
              </div>
              <div>
                <Label>Slug</Label>
                <Input
                  value={formData.slug}
                  onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                  placeholder="collection-slug"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description"
                  rows={2}
                />
              </div>
              <div>
                <Label>Icon (emoji or text)</Label>
                <Input
                  value={formData.icon}
                  onChange={(e) => setFormData(prev => ({ ...prev, icon: e.target.value }))}
                  placeholder="📁"
                />
              </div>
              <div>
                <Label>Required Entitlement</Label>
                <Select
                  value={formData.requiredEntitlement}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, requiredEntitlement: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTITLEMENTS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(v) => setFormData(prev => ({ ...prev, isActive: v }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={createCollection.isPending || updateCollection.isPending}
              >
                {createCollection.isPending || updateCollection.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Collection</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this collection? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
              <Button
                variant="default"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
                disabled={deleteCollection.isPending}
              >
                {deleteCollection.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
