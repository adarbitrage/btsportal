import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingBag,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  X,
  Upload,
  GripVertical,
  FolderPlus,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useAdminMediaMavensProducts,
  useAdminCreateMediaMavensProduct,
  useAdminUpdateMediaMavensProduct,
  useAdminDeleteMediaMavensProduct,
  useAdminReorderMediaMavensProducts,
  useAdminMediaMavensCategories,
  useAdminCreateMediaMavensCategory,
  useAdminUpdateMediaMavensCategory,
  useAdminDeleteMediaMavensCategory,
  useAdminReorderMediaMavensCategories,
  useAdminTapfiliatePrograms,
  type AdminMediaMavensProduct,
  type AdminMediaMavensCategory,
  type MediaMavensProductFormData,
  type MediaMavensCategoryFormData,
  adminMediaMavensApi,
} from "@/lib/admin-api";

const EMPTY_FORM: MediaMavensProductFormData = {
  slug: "",
  name: "",
  tagline: "",
  category: "",
  imageUrl: null,
  description: "",
  costToConsumer: "",
  affiliateCommission: "",
  salesPageUrl: "",
  logoDriveUrl: "",
  affiliateLink: "",
  tapfiliateProgramId: null,
  tapfiliateProgramTitle: null,
  displayOrder: 0,
  isActive: true,
};

function productToForm(p: AdminMediaMavensProduct): MediaMavensProductFormData {
  return {
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    category: p.category,
    imageUrl: p.imageUrl,
    description: p.description,
    costToConsumer: p.costToConsumer,
    affiliateCommission: p.affiliateCommission,
    salesPageUrl: p.salesPageUrl,
    logoDriveUrl: p.logoDriveUrl,
    affiliateLink: p.affiliateLink,
    tapfiliateProgramId: p.tapfiliateProgramId,
    tapfiliateProgramTitle: p.tapfiliateProgramTitle,
    displayOrder: p.displayOrder,
    isActive: p.isActive,
  };
}

function ImageUploader({
  imageUrl,
  onChange,
}: {
  imageUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await adminMediaMavensApi.getImageUploadUrl();
      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      onChange(objectPath);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload image. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const displaySrc = imageUrl
    ? imageUrl.startsWith("http://") || imageUrl.startsWith("https://")
      ? imageUrl
      : `${import.meta.env.BASE_URL}api${imageUrl}`
    : null;

  return (
    <div className="space-y-2">
      {displaySrc && (
        <div className="relative inline-block border rounded-md overflow-hidden bg-white p-2">
          <img src={displaySrc} alt="Product image preview" className="max-h-24 max-w-40 object-contain" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <label className="cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          <Button type="button" variant="outline" size="sm" asChild>
            <span>
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Uploading…" : "Upload image"}
            </span>
          </Button>
        </label>
        {imageUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Or enter URL:</span>
        <Input
          placeholder="https://..."
          value={imageUrl?.startsWith("http") ? imageUrl : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-7 text-xs flex-1"
        />
      </div>
    </div>
  );
}

function ProductFormDialog({
  open,
  onClose,
  product,
  defaultCategory,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  product: AdminMediaMavensProduct | null;
  defaultCategory: string;
  categories: AdminMediaMavensCategory[];
}) {
  const { toast } = useToast();
  const isEdit = Boolean(product);
  const [form, setForm] = useState<MediaMavensProductFormData>(() =>
    product ? productToForm(product) : { ...EMPTY_FORM, category: defaultCategory }
  );

  const createMutation = useAdminCreateMediaMavensProduct();
  const updateMutation = useAdminUpdateMediaMavensProduct();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const { data: tapfiliatePrograms, isLoading: tapfiliateLoading, isError: tapfiliateError, error: tapfiliateErrorObj } = useAdminTapfiliatePrograms();
  const tapfiliateNotConfigured = tapfiliateError && tapfiliateErrorObj instanceof Error && tapfiliateErrorObj.message.includes("TAPFILIATE_API_KEY");

  function set<K extends keyof MediaMavensProductFormData>(key: K, value: MediaMavensProductFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: MediaMavensProductFormData = {
      ...form,
      imageUrl: form.imageUrl || null,
    };
    try {
      if (isEdit && product) {
        await updateMutation.mutateAsync({ id: product.id, data: payload });
        toast({ title: "Product updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Product created" });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: isEdit ? "Update failed" : "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${product?.name}` : "Add Product"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} required className="mt-1" />
            </div>
            <div>
              <Label>Slug *</Label>
              <Input
                value={form.slug}
                onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                required
                className="mt-1"
                placeholder="e.g. my-product"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tagline</Label>
              <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} className="mt-1" placeholder="Short descriptor shown under the name" />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="mt-1"
              rows={5}
              placeholder="Full product description shown on the card"
            />
          </div>

          <div>
            <Label>Product Image</Label>
            <div className="mt-1">
              <ImageUploader imageUrl={form.imageUrl} onChange={(url) => set("imageUrl", url)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cost to Consumer</Label>
              <Input value={form.costToConsumer} onChange={(e) => set("costToConsumer", e.target.value)} className="mt-1" placeholder="e.g. $79" />
            </div>
            <div>
              <Label>Affiliate Commission</Label>
              <Input value={form.affiliateCommission} onChange={(e) => set("affiliateCommission", e.target.value)} className="mt-1" placeholder="e.g. $100 CPA" />
            </div>
          </div>

          <div>
            <Label>Sales Page URL</Label>
            <Input value={form.salesPageUrl} onChange={(e) => set("salesPageUrl", e.target.value)} className="mt-1" placeholder="https://..." type="url" />
          </div>

          <div>
            <Label>Download Official Logo URL (Google Drive)</Label>
            <Input value={form.logoDriveUrl} onChange={(e) => set("logoDriveUrl", e.target.value)} className="mt-1" placeholder="https://drive.google.com/..." type="url" />
          </div>

          <div>
            <Label>Affiliate Link (fallback template)</Label>
            <Input value={form.affiliateLink} onChange={(e) => set("affiliateLink", e.target.value)} className="mt-1" placeholder="https://..." type="url" />
            <p className="text-xs text-muted-foreground mt-1">Used when no Tapfiliate program is assigned, or as a fallback if the API is unavailable.</p>
          </div>

          <div>
            <Label>Tapfiliate Program</Label>
            {tapfiliateNotConfigured ? (
              <p className="text-xs text-amber-600 mt-1">Tapfiliate not configured — set TAPFILIATE_API_KEY to enable program selection.</p>
            ) : tapfiliateError ? (
              <p className="text-xs text-red-600 mt-1">Failed to load Tapfiliate programs — check API connectivity and try again.</p>
            ) : tapfiliateLoading || !tapfiliatePrograms ? (
              <div className="mt-1 flex h-10 items-center rounded-md border border-input px-3 text-sm text-muted-foreground">
                Loading programs…
              </div>
            ) : (
              <Select
                value={tapfiliatePrograms.some((p) => p.id === form.tapfiliateProgramId) ? form.tapfiliateProgramId! : "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    set("tapfiliateProgramId", null);
                    set("tapfiliateProgramTitle", null);
                  } else {
                    const prog = (tapfiliatePrograms ?? []).find((p) => p.id === v);
                    set("tapfiliateProgramId", v);
                    set("tapfiliateProgramTitle", prog?.title ?? null);
                  }
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={tapfiliatePrograms ? "None (use fallback link)" : "Loading programs…"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (use fallback link)</SelectItem>
                  {(tapfiliatePrograms ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {form.tapfiliateProgramId && (
              <p className="text-xs text-emerald-700 mt-1">Members will get their personal referral URL for this program.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
            <Label className="cursor-pointer select-none">Active (visible to members)</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : isEdit ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryFormDialog({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: AdminMediaMavensCategory | null;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(category);
  const [form, setForm] = useState<MediaMavensCategoryFormData>(() =>
    category ? { slug: category.slug, name: category.name, isActive: category.isActive } : { slug: "", name: "", isActive: true }
  );

  const createMutation = useAdminCreateMediaMavensCategory();
  const updateMutation = useAdminUpdateMediaMavensCategory();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEdit && category) {
        await updateMutation.mutateAsync({ id: category.id, data: form });
        toast({ title: "Category updated" });
      } else {
        await createMutation.mutateAsync(form);
        toast({ title: "Category created" });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: isEdit ? "Update failed" : "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${category?.name}` : "Create Category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  name,
                  slug: isEdit ? prev.slug : name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                }));
              }}
              required
              className="mt-1"
              placeholder="e.g. Fitness"
            />
          </div>
          <div>
            <Label>Slug *</Label>
            <Input
              value={form.slug}
              onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
              required
              className="mt-1"
              placeholder="e.g. fitness"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.isActive ?? true} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
            <Label className="cursor-pointer select-none">Active (visible to members)</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : isEdit ? "Save changes" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SortableProductRow({
  product,
  onToggleActive,
  onEdit,
  onDelete,
  toggleDisabled,
  dragDisabled,
}: {
  product: AdminMediaMavensProduct;
  onToggleActive: (p: AdminMediaMavensProduct) => void;
  onEdit: (p: AdminMediaMavensProduct) => void;
  onDelete: (p: AdminMediaMavensProduct) => void;
  toggleDisabled: boolean;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `product-${product.id}`,
    disabled: dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  const imageSrc = product.imageUrl
    ? product.imageUrl.startsWith("http://") || product.imageUrl.startsWith("https://")
      ? product.imageUrl
      : `${import.meta.env.BASE_URL}api${product.imageUrl}`
    : null;
  return (
    <div ref={setNodeRef} style={style}>
      <Card className={`border border-border ${!product.isActive ? "opacity-60" : ""} ${isDragging ? "shadow-lg" : ""}`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none ${
                dragDisabled ? "opacity-40 cursor-not-allowed" : "hover:text-foreground cursor-grab active:cursor-grabbing"
              }`}
              aria-label={`Drag to reorder ${product.name}`}
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-5 h-5" />
            </button>
            <div className="w-14 h-10 flex items-center justify-center rounded border border-border shrink-0 bg-white overflow-hidden">
              {imageSrc ? (
                <img src={imageSrc} alt={product.name} className="max-h-9 max-w-12 object-contain" />
              ) : (
                <ShoppingBag className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{product.name}</span>
                <span className="text-xs text-muted-foreground font-mono">{product.slug}</span>
                {!product.isActive && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{product.tagline}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => onToggleActive(product)} disabled={toggleDisabled} title={product.isActive ? "Deactivate" : "Activate"}>
                {product.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(product)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(product)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SortableCategorySection({
  category,
  products,
  onAddProductInCategory,
  onEditCategory,
  onDeleteCategory,
  onToggleProductActive,
  onEditProduct,
  onDeleteProduct,
  onProductReorder,
  toggleDisabled,
  dragDisabled,
}: {
  category: AdminMediaMavensCategory;
  products: AdminMediaMavensProduct[];
  onAddProductInCategory: (categoryName: string) => void;
  onEditCategory: (c: AdminMediaMavensCategory) => void;
  onDeleteCategory: (c: AdminMediaMavensCategory) => void;
  onToggleProductActive: (p: AdminMediaMavensProduct) => void;
  onEditProduct: (p: AdminMediaMavensProduct) => void;
  onDeleteProduct: (p: AdminMediaMavensProduct) => void;
  onProductReorder: (categoryName: string, reordered: AdminMediaMavensProduct[]) => void;
  toggleDisabled: boolean;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `category-${category.id}`,
    disabled: dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.9 : undefined,
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleProductDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = products.findIndex((p) => `product-${p.id}` === active.id);
    const newIndex = products.findIndex((p) => `product-${p.id}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(products, oldIndex, newIndex);
    onProductReorder(category.name, reordered);
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className={`rounded-xl border-2 border-emerald-300 dark:border-emerald-700/60 overflow-hidden ${isDragging ? "shadow-xl" : ""} ${!category.isActive ? "opacity-60" : ""}`}>
        <div className="flex items-center gap-2 px-4 py-3 bg-card">
          <button
            type="button"
            className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none ${
              dragDisabled ? "opacity-40 cursor-not-allowed" : "hover:text-foreground cursor-grab active:cursor-grabbing"
            }`}
            aria-label={`Drag to reorder ${category.name} category`}
            disabled={dragDisabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold tracking-wide flex-1">{category.name}</h2>
          <Badge variant="outline" className="text-xs">{products.length}</Badge>
          {!category.isActive && (
            <Badge variant="outline" className="text-xs text-muted-foreground">Hidden</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => onAddProductInCategory(category.name)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add product
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEditCategory(category)} title="Edit category">
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteCategory(category)} title="Delete category">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-t border-emerald-300 dark:border-emerald-700/60 p-3 space-y-2 bg-card">
          {products.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">No products in this category yet.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProductDragEnd}>
              <SortableContext items={products.map((p) => `product-${p.id}`)} strategy={verticalListSortingStrategy}>
                {products.map((p) => (
                  <SortableProductRow
                    key={p.id}
                    product={p}
                    onToggleActive={onToggleProductActive}
                    onEdit={onEditProduct}
                    onDelete={onDeleteProduct}
                    toggleDisabled={toggleDisabled}
                    dragDisabled={dragDisabled}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminMediaMavens() {
  const { toast } = useToast();
  const { data: products = [], isLoading: productsLoading } = useAdminMediaMavensProducts();
  const { data: categories = [], isLoading: categoriesLoading } = useAdminMediaMavensCategories();
  const deleteProductMutation = useAdminDeleteMediaMavensProduct();
  const updateProductMutation = useAdminUpdateMediaMavensProduct();
  const reorderProductsMutation = useAdminReorderMediaMavensProducts();
  const deleteCategoryMutation = useAdminDeleteMediaMavensCategory();
  const reorderCategoriesMutation = useAdminReorderMediaMavensCategories();

  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminMediaMavensProduct | null>(null);
  const [productDefaultCategory, setProductDefaultCategory] = useState<string>("");
  const [productDeleteTarget, setProductDeleteTarget] = useState<AdminMediaMavensProduct | null>(null);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminMediaMavensCategory | null>(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<AdminMediaMavensCategory | null>(null);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [categories]
  );

  const productsByCategory = useMemo(() => {
    const map = new Map<string, AdminMediaMavensProduct[]>();
    for (const c of sortedCategories) map.set(c.name, []);
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    for (const list of map.values()) list.sort((a, b) => a.displayOrder - b.displayOrder);
    return map;
  }, [products, sortedCategories]);

  const orphanProducts = useMemo(() => {
    const catNames = new Set(sortedCategories.map((c) => c.name));
    return products.filter((p) => !catNames.has(p.category)).sort((a, b) => a.displayOrder - b.displayOrder);
  }, [products, sortedCategories]);

  const categorySensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreateProduct(categoryName?: string) {
    setEditingProduct(null);
    setProductDefaultCategory(categoryName ?? sortedCategories[0]?.name ?? "");
    setProductDialogOpen(true);
  }
  function openEditProduct(p: AdminMediaMavensProduct) {
    setEditingProduct(p);
    setProductDefaultCategory(p.category);
    setProductDialogOpen(true);
  }
  function openCreateCategory() {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  }
  function openEditCategory(c: AdminMediaMavensCategory) {
    setEditingCategory(c);
    setCategoryDialogOpen(true);
  }

  async function handleToggleActive(p: AdminMediaMavensProduct) {
    try {
      await updateProductMutation.mutateAsync({ id: p.id, data: { isActive: !p.isActive } });
      toast({ title: p.isActive ? "Product hidden" : "Product activated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  async function handleDeleteProduct() {
    if (!productDeleteTarget) return;
    try {
      await deleteProductMutation.mutateAsync(productDeleteTarget.id);
      toast({ title: `${productDeleteTarget.name} deleted` });
      setProductDeleteTarget(null);
    } catch (err: unknown) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }

  async function handleDeleteCategory() {
    if (!categoryDeleteTarget) return;
    try {
      await deleteCategoryMutation.mutateAsync(categoryDeleteTarget.id);
      toast({ title: `${categoryDeleteTarget.name} deleted` });
      setCategoryDeleteTarget(null);
    } catch (err: unknown) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }

  async function handleCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedCategories.findIndex((c) => `category-${c.id}` === active.id);
    const newIndex = sortedCategories.findIndex((c) => `category-${c.id}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedCategories, oldIndex, newIndex);
    const order = reordered.map((c, i) => ({ id: c.id, displayOrder: i }));
    try {
      await reorderCategoriesMutation.mutateAsync(order);
    } catch {
      toast({ title: "Category reorder failed", variant: "destructive" });
    }
  }

  async function handleProductReorder(_categoryName: string, reordered: AdminMediaMavensProduct[]) {
    const order = reordered.map((p, i) => ({ id: p.id, displayOrder: i }));
    try {
      await reorderProductsMutation.mutateAsync(order);
    } catch {
      toast({ title: "Reorder failed", variant: "destructive" });
    }
  }

  const isLoading = productsLoading || categoriesLoading;
  const isEmpty = !isLoading && sortedCategories.length === 0 && products.length === 0;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Media Mavens Products</h1>
              <p className="text-sm text-muted-foreground">Manage categories and products shown to members</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={openCreateCategory}>
              <FolderPlus className="w-4 h-4 mr-2" /> Create Category
            </Button>
            <Button onClick={() => openCreateProduct()}>
              <Plus className="w-4 h-4 mr-2" /> Add Product
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40 animate-pulse" />
            <p>Loading…</p>
          </div>
        )}

        {isEmpty && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium mb-1">No categories yet</p>
              <p className="text-sm mb-4">Create your first category, then add products.</p>
              <Button onClick={openCreateCategory}>
                <FolderPlus className="w-4 h-4 mr-2" /> Create Category
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && sortedCategories.length > 0 && (
          <DndContext sensors={categorySensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
            <SortableContext items={sortedCategories.map((c) => `category-${c.id}`)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {sortedCategories.map((c) => (
                  <SortableCategorySection
                    key={c.id}
                    category={c}
                    products={productsByCategory.get(c.name) ?? []}
                    onAddProductInCategory={openCreateProduct}
                    onEditCategory={openEditCategory}
                    onDeleteCategory={setCategoryDeleteTarget}
                    onToggleProductActive={handleToggleActive}
                    onEditProduct={openEditProduct}
                    onDeleteProduct={setProductDeleteTarget}
                    onProductReorder={handleProductReorder}
                    toggleDisabled={updateProductMutation.isPending}
                    dragDisabled={reorderCategoriesMutation.isPending || reorderProductsMutation.isPending}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {orphanProducts.length > 0 && (
          <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700/60 overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30">
              <h2 className="text-lg font-bold tracking-wide">Uncategorized</h2>
              <p className="text-xs text-muted-foreground">These products reference a category that no longer exists. Edit them to reassign.</p>
            </div>
            <div className="p-3 space-y-2 bg-card">
              {orphanProducts.map((p) => (
                <Card key={p.id} className="border border-border">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{p.name}</span>
                        <Badge variant="outline" className="text-xs text-amber-700">Category: {p.category}</Badge>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openEditProduct(p)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setProductDeleteTarget(p)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <ProductFormDialog
          key={editingProduct ? `edit-${editingProduct.id}` : `new-${productDefaultCategory}`}
          open={productDialogOpen}
          onClose={() => setProductDialogOpen(false)}
          product={editingProduct}
          defaultCategory={productDefaultCategory}
          categories={sortedCategories}
        />

        <CategoryFormDialog
          key={editingCategory ? `edit-${editingCategory.id}` : "new-category"}
          open={categoryDialogOpen}
          onClose={() => setCategoryDialogOpen(false)}
          category={editingCategory}
        />

        <AlertDialog open={Boolean(productDeleteTarget)} onOpenChange={(v) => !v && setProductDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {productDeleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the product. Members will no longer see it on the Media Mavens page. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={handleDeleteProduct}
                disabled={deleteProductMutation.isPending}
              >
                {deleteProductMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={Boolean(categoryDeleteTarget)} onOpenChange={(v) => !v && setCategoryDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete category {categoryDeleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The category will be permanently removed. If any products are still assigned to it, the deletion will fail — move or remove those products first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={handleDeleteCategory}
                disabled={deleteCategoryMutation.isPending}
              >
                {deleteCategoryMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
