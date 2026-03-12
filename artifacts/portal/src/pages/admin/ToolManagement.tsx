import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PlusCircle, Pencil, MoreVertical, Power, PowerOff,
  Wrench, FolderOpen, Trash2, BarChart3, ExternalLink,
  Star, Sparkles, FlaskConical, ArrowUpDown,
} from "lucide-react";
import {
  useAdminListTools,
  useAdminCreateTool,
  useAdminUpdateTool,
  useAdminDeleteTool,
  useAdminActivateTool,
  useAdminDeactivateTool,
  useAdminListToolCategories,
  useAdminCreateToolCategory,
  useAdminUpdateToolCategory,
  useAdminDeleteToolCategory,
  type AdminTool,
  type AdminToolCategory,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const EMPTY_TOOL_FORM = {
  slug: "",
  name: "",
  shortDescription: "",
  longDescription: "",
  icon: "",
  categoryId: "",
  type: "builtin",
  requiredEntitlement: "software:base",
  isFeatured: false,
  isNew: false,
  isBeta: false,
  status: "active",
  badge: "",
  sortOrder: 0,
  videoTutorialUrl: "",
  helpDocUrl: "",
  rateLimitPerDay: "",
  configComponent: "",
  configUrl: "",
  configEmbedUrl: "",
  configEmbedHeight: "",
};

const EMPTY_CATEGORY_FORM = {
  name: "",
  slug: "",
  description: "",
  icon: "",
  sortOrder: 0,
};

export default function ToolManagement() {
  const { data: tools, isLoading: toolsLoading } = useAdminListTools();
  const { data: categories, isLoading: categoriesLoading } = useAdminListToolCategories();
  const createTool = useAdminCreateTool();
  const updateTool = useAdminUpdateTool();
  const deleteTool = useAdminDeleteTool();
  const activateTool = useAdminActivateTool();
  const deactivateTool = useAdminDeactivateTool();
  const createCategory = useAdminCreateToolCategory();
  const updateCategory = useAdminUpdateToolCategory();
  const deleteCategory = useAdminDeleteToolCategory();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [toolDialogOpen, setToolDialogOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<AdminTool | null>(null);
  const [toolForm, setToolForm] = useState(EMPTY_TOOL_FORM);

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<AdminToolCategory | null>(null);
  const [catForm, setCatForm] = useState(EMPTY_CATEGORY_FORM);

  const openCreateTool = () => {
    setEditingTool(null);
    setToolForm(EMPTY_TOOL_FORM);
    setToolDialogOpen(true);
  };

  const openEditTool = (tool: AdminTool) => {
    setEditingTool(tool);
    const cfg = (tool.config || {}) as Record<string, unknown>;
    setToolForm({
      slug: tool.slug,
      name: tool.name,
      shortDescription: tool.shortDescription,
      longDescription: tool.longDescription || "",
      icon: tool.icon || "",
      categoryId: tool.categoryId?.toString() || "",
      type: tool.type,
      requiredEntitlement: tool.requiredEntitlement,
      isFeatured: tool.isFeatured === 1,
      isNew: tool.isNew,
      isBeta: tool.isBeta,
      status: tool.status,
      badge: tool.badge || "",
      sortOrder: tool.sortOrder,
      videoTutorialUrl: tool.videoTutorialUrl || "",
      helpDocUrl: tool.helpDocUrl || "",
      rateLimitPerDay: tool.rateLimitPerDay?.toString() || "",
      configComponent: String(cfg.component || ""),
      configUrl: tool.type === "external" ? String(cfg.url || "") : "",
      configEmbedUrl: tool.type === "embedded" ? String(cfg.url || "") : "",
      configEmbedHeight: cfg.embedHeight ? String(cfg.embedHeight) : "",
    });
    setToolDialogOpen(true);
  };

  const handleToolSubmit = async () => {
    const config: Record<string, unknown> = {};
    if (toolForm.type === "builtin" && toolForm.configComponent) {
      config.component = toolForm.configComponent;
    } else if (toolForm.type === "external" && toolForm.configUrl) {
      config.url = toolForm.configUrl;
    } else if (toolForm.type === "embedded") {
      if (toolForm.configEmbedUrl) config.url = toolForm.configEmbedUrl;
      if (toolForm.configEmbedHeight) config.embedHeight = parseInt(toolForm.configEmbedHeight);
    }

    const payload: Partial<AdminTool> & { slug: string; name: string; shortDescription: string } = {
      slug: toolForm.slug,
      name: toolForm.name,
      shortDescription: toolForm.shortDescription,
      longDescription: toolForm.longDescription || null,
      icon: toolForm.icon || null,
      categoryId: toolForm.categoryId ? parseInt(toolForm.categoryId) : null,
      type: toolForm.type,
      requiredEntitlement: toolForm.requiredEntitlement,
      config,
      isFeatured: toolForm.isFeatured ? 1 : 0,
      isNew: toolForm.isNew,
      isBeta: toolForm.isBeta,
      status: toolForm.status,
      badge: toolForm.badge || null,
      sortOrder: toolForm.sortOrder,
      videoTutorialUrl: toolForm.videoTutorialUrl || null,
      helpDocUrl: toolForm.helpDocUrl || null,
      rateLimitPerDay: toolForm.rateLimitPerDay ? parseInt(toolForm.rateLimitPerDay) : null,
    };

    try {
      if (editingTool) {
        await updateTool.mutateAsync({ id: editingTool.id, ...payload });
        toast({ title: "Tool updated" });
      } else {
        await createTool.mutateAsync(payload);
        toast({ title: "Tool created" });
      }
      setToolDialogOpen(false);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const isToolActive = (tool: AdminTool) => tool.status === "active";

  const handleToggleActive = async (tool: AdminTool) => {
    try {
      if (isToolActive(tool)) {
        await deactivateTool.mutateAsync(tool.id);
        toast({ title: `${tool.name} deactivated` });
      } else {
        await activateTool.mutateAsync(tool.id);
        toast({ title: `${tool.name} activated` });
      }
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleDeleteTool = async (tool: AdminTool) => {
    if (!confirm(`Delete "${tool.name}"? This cannot be undone.`)) return;
    try {
      await deleteTool.mutateAsync(tool.id);
      toast({ title: "Tool deleted" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const openCreateCategory = () => {
    setEditingCat(null);
    setCatForm(EMPTY_CATEGORY_FORM);
    setCatDialogOpen(true);
  };

  const openEditCategory = (cat: AdminToolCategory) => {
    setEditingCat(cat);
    setCatForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || "",
      icon: cat.icon || "",
      sortOrder: cat.sortOrder,
    });
    setCatDialogOpen(true);
  };

  const handleCategorySubmit = async () => {
    try {
      if (editingCat) {
        await updateCategory.mutateAsync({ id: editingCat.id, ...catForm });
        toast({ title: "Category updated" });
      } else {
        await createCategory.mutateAsync(catForm);
        toast({ title: "Category created" });
      }
      setCatDialogOpen(false);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleDeleteCategory = async (cat: AdminToolCategory) => {
    if (!confirm(`Delete "${cat.name}"? This will fail if tools are still assigned to this category.`)) return;
    try {
      await deleteCategory.mutateAsync(cat.id);
      toast({ title: "Category deleted" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleToggleCategoryActive = async (cat: AdminToolCategory) => {
    try {
      await updateCategory.mutateAsync({ id: cat.id, isActive: !cat.isActive });
      toast({ title: cat.isActive ? "Category deactivated" : "Category activated" });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const toolTypeLabel = (type: string) => {
    switch (type) {
      case "builtin": return "Built-in";
      case "external": return "External";
      case "embedded": return "Embedded";
      default: return type;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tool Management</h1>
            <p className="text-muted-foreground">Manage software tools and categories available to members</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/tools/analytics")}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </Button>
          </div>
        </div>

        <Tabs defaultValue="tools">
          <TabsList>
            <TabsTrigger value="tools">
              <Wrench className="w-4 h-4 mr-1" />
              Tools ({tools?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="categories">
              <FolderOpen className="w-4 h-4 mr-1" />
              Categories ({categories?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tools" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openCreateTool}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Add New Tool
              </Button>
            </div>

            {toolsLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading tools...</div>
            ) : !tools?.length ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No tools yet. Click "Add New Tool" to create one.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Name</th>
                          <th className="text-left p-3 font-medium">Type</th>
                          <th className="text-left p-3 font-medium">Category</th>
                          <th className="text-left p-3 font-medium">Entitlement</th>
                          <th className="text-left p-3 font-medium">Status</th>
                          <th className="text-left p-3 font-medium">Flags</th>
                          <th className="text-right p-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tools.map((tool) => (
                          <tr key={tool.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {tool.icon && <span className="text-lg">{tool.icon}</span>}
                                <div>
                                  <div className="font-medium">{tool.name}</div>
                                  <div className="text-xs text-muted-foreground">{tool.slug}</div>
                                </div>
                              </div>
                            </td>
                            <td className="p-3">
                              <Badge variant="outline">{toolTypeLabel(tool.type)}</Badge>
                            </td>
                            <td className="p-3 text-muted-foreground">{tool.categoryName || "—"}</td>
                            <td className="p-3">
                              <Badge variant="secondary" className="text-xs">{tool.requiredEntitlement}</Badge>
                            </td>
                            <td className="p-3">
                              <Badge variant={isToolActive(tool) ? "default" : "secondary"}>
                                {tool.status}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <div className="flex gap-1">
                                {tool.isFeatured === 1 && <Star className="w-4 h-4 text-yellow-500" />}
                                {tool.isNew && <Sparkles className="w-4 h-4 text-blue-500" />}
                                {tool.isBeta && <FlaskConical className="w-4 h-4 text-purple-500" />}
                              </div>
                            </td>
                            <td className="p-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openEditTool(tool)}>
                                    <Pencil className="w-4 h-4 mr-2" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleToggleActive(tool)}>
                                    {isToolActive(tool) ? (
                                      <><PowerOff className="w-4 h-4 mr-2" /> Deactivate</>
                                    ) : (
                                      <><Power className="w-4 h-4 mr-2" /> Activate</>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => navigate(`/admin/tools/${tool.id}/usage`)}>
                                    <BarChart3 className="w-4 h-4 mr-2" /> View Usage
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDeleteTool(tool)} className="text-destructive">
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="categories" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openCreateCategory}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Add Category
              </Button>
            </div>

            {categoriesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading categories...</div>
            ) : !categories?.length ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No categories yet. Click "Add Category" to create one.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {categories.map((cat) => (
                  <Card key={cat.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {cat.icon && <span className="text-xl">{cat.icon}</span>}
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {cat.name}
                            {!cat.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">{cat.slug} · Order: {cat.sortOrder}</div>
                          {cat.description && <div className="text-sm text-muted-foreground mt-1">{cat.description}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEditCategory(cat)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleCategoryActive(cat)}>
                          {cat.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat)} className="text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={toolDialogOpen} onOpenChange={setToolDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTool ? "Edit Tool" : "Add New Tool"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name *</Label>
                  <Input value={toolForm.name} onChange={(e) => setToolForm({ ...toolForm, name: e.target.value })} />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input value={toolForm.slug} onChange={(e) => setToolForm({ ...toolForm, slug: e.target.value })} placeholder="e.g. headline-generator" />
                </div>
              </div>

              <div>
                <Label>Short Description *</Label>
                <Textarea value={toolForm.shortDescription} onChange={(e) => setToolForm({ ...toolForm, shortDescription: e.target.value })} rows={2} />
              </div>

              <div>
                <Label>Long Description</Label>
                <Textarea value={toolForm.longDescription} onChange={(e) => setToolForm({ ...toolForm, longDescription: e.target.value })} rows={3} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Icon (emoji/lucide)</Label>
                  <Input value={toolForm.icon} onChange={(e) => setToolForm({ ...toolForm, icon: e.target.value })} placeholder="e.g. pencil" />
                </div>
                <div>
                  <Label>Category *</Label>
                  <Select value={toolForm.categoryId} onValueChange={(v) => setToolForm({ ...toolForm, categoryId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories?.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sort Order</Label>
                  <Input type="number" value={toolForm.sortOrder} onChange={(e) => setToolForm({ ...toolForm, sortOrder: parseInt(e.target.value) || 0 })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tool Type</Label>
                  <Select value={toolForm.type} onValueChange={(v) => setToolForm({ ...toolForm, type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="builtin">Built-in (React Component)</SelectItem>
                      <SelectItem value="external">External (Link)</SelectItem>
                      <SelectItem value="embedded">Embedded (Iframe)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Required Entitlement</Label>
                  <Select value={toolForm.requiredEntitlement} onValueChange={(v) => setToolForm({ ...toolForm, requiredEntitlement: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="software:base">software:base</SelectItem>
                      <SelectItem value="software:expanded">software:expanded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {toolForm.type === "builtin" && (
                <div>
                  <Label>Component Name</Label>
                  <Input value={toolForm.configComponent} onChange={(e) => setToolForm({ ...toolForm, configComponent: e.target.value })} placeholder="e.g. HeadlineGenerator" />
                </div>
              )}

              {toolForm.type === "external" && (
                <div>
                  <Label>External URL</Label>
                  <Input value={toolForm.configUrl} onChange={(e) => setToolForm({ ...toolForm, configUrl: e.target.value })} placeholder="https://..." />
                </div>
              )}

              {toolForm.type === "embedded" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Embed URL</Label>
                    <Input value={toolForm.configEmbedUrl} onChange={(e) => setToolForm({ ...toolForm, configEmbedUrl: e.target.value })} placeholder="https://..." />
                  </div>
                  <div>
                    <Label>Embed Height (px)</Label>
                    <Input value={toolForm.configEmbedHeight} onChange={(e) => setToolForm({ ...toolForm, configEmbedHeight: e.target.value })} placeholder="600" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tutorial Video URL</Label>
                  <Input value={toolForm.videoTutorialUrl} onChange={(e) => setToolForm({ ...toolForm, videoTutorialUrl: e.target.value })} />
                </div>
                <div>
                  <Label>Help Doc URL</Label>
                  <Input value={toolForm.helpDocUrl} onChange={(e) => setToolForm({ ...toolForm, helpDocUrl: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Rate Limit (per day, for AI tools)</Label>
                  <Input value={toolForm.rateLimitPerDay} onChange={(e) => setToolForm({ ...toolForm, rateLimitPerDay: e.target.value })} placeholder="Leave empty for unlimited" />
                </div>
                <div>
                  <Label>Badge Text</Label>
                  <Input value={toolForm.badge} onChange={(e) => setToolForm({ ...toolForm, badge: e.target.value })} placeholder="e.g. Popular, New" />
                </div>
              </div>

              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={toolForm.isFeatured} onChange={(e) => setToolForm({ ...toolForm, isFeatured: e.target.checked })} />
                  <Star className="w-4 h-4 text-yellow-500" /> Featured
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={toolForm.isNew} onChange={(e) => setToolForm({ ...toolForm, isNew: e.target.checked })} />
                  <Sparkles className="w-4 h-4 text-blue-500" /> New
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={toolForm.isBeta} onChange={(e) => setToolForm({ ...toolForm, isBeta: e.target.checked })} />
                  <FlaskConical className="w-4 h-4 text-purple-500" /> Beta
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={toolForm.status === "active"} onChange={(e) => setToolForm({ ...toolForm, status: e.target.checked ? "active" : "inactive" })} />
                  <Power className="w-4 h-4" /> Active
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setToolDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleToolSubmit} disabled={!toolForm.name || !toolForm.slug || !toolForm.shortDescription || !toolForm.categoryId}>
                {editingTool ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCat ? "Edit Category" : "Add Category"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} />
              </div>
              <div>
                <Label>Slug *</Label>
                <Input value={catForm.slug} onChange={(e) => setCatForm({ ...catForm, slug: e.target.value })} placeholder="e.g. content-creation" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Icon (emoji)</Label>
                  <Input value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} placeholder="e.g. content" />
                </div>
                <div>
                  <Label>Sort Order</Label>
                  <Input type="number" value={catForm.sortOrder} onChange={(e) => setCatForm({ ...catForm, sortOrder: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCategorySubmit} disabled={!catForm.name || !catForm.slug}>
                {editingCat ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
