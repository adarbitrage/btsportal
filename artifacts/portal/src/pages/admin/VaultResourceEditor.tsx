import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft,
  Save,
  Upload,
  X,
  Plus,
  Search,
  FileText,
  Link as LinkIcon,
  Trash2,
} from "lucide-react";
import {
  useAdminVaultResource,
  useAdminCreateVaultResource,
  useAdminUpdateVaultResource,
  useAdminVaultCollections,
  useAdminVaultTags,
  useAdminVaultUploadUrl,
  useAdminSearchVaultResources,
  useAdminSearchLessons,
  useAdminAddVaultRelation,
  useAdminRemoveVaultRelation,
  useAdminAddVaultLessonRelation,
  useAdminRemoveVaultLessonRelation,
  type VaultResource,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

const RESOURCE_TYPES = [
  { value: "document", label: "Document (PDF, DOCX)" },
  { value: "spreadsheet", label: "Spreadsheet (XLSX)" },
  { value: "video", label: "Video" },
  { value: "article", label: "Article (HTML)" },
  { value: "template", label: "Template" },
  { value: "link", label: "External Link" },
  { value: "image", label: "Image" },
];

const ENTITLEMENTS = [
  { value: "content:frontend", label: "Front-End Members" },
  { value: "content:advanced", label: "LaunchPad" },
  { value: "coaching:group", label: "3-Month Mentorship" },
  { value: "coaching:mastermind", label: "6-Month Mentorship" },
  { value: "access:lifetime", label: "Lifetime Mentorship" },
];

interface FormData {
  title: string;
  description: string;
  longDescription: string;
  resourceType: string;
  collectionId: number | null;
  fileUrl: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
  previewImageUrl: string;
  contentHtml: string;
  externalUrl: string;
  videoUrl: string;
  tags: string[];
  requiredEntitlement: string;
  isFeatured: boolean;
  isPinned: boolean;
  isNew: boolean;
  status: string;
  version: string;
  updateNote: string;
}

const defaultForm: FormData = {
  title: "",
  description: "",
  longDescription: "",
  resourceType: "document",
  collectionId: null,
  fileUrl: "",
  fileName: "",
  fileSize: null,
  fileType: "",
  previewImageUrl: "",
  contentHtml: "",
  externalUrl: "",
  videoUrl: "",
  tags: [],
  requiredEntitlement: "content:frontend",
  isFeatured: false,
  isPinned: false,
  isNew: true,
  status: "draft",
  version: "",
  updateNote: "",
};

export default function VaultResourceEditor() {
  const [, params] = useRoute("/admin/resources/:id/edit");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isNew = !params?.id || params.id === "new";
  const resourceId = isNew ? 0 : parseInt(params?.id || "0", 10);

  const { data: existingResource } = useAdminVaultResource(resourceId);
  const { data: collections } = useAdminVaultCollections();
  const { data: allTags } = useAdminVaultTags();
  const createResource = useAdminCreateVaultResource();
  const updateResource = useAdminUpdateVaultResource();
  const uploadUrl = useAdminVaultUploadUrl();
  const searchResources = useAdminSearchVaultResources();
  const searchLessons = useAdminSearchLessons();
  const addRelation = useAdminAddVaultRelation();
  const removeRelation = useAdminRemoveVaultRelation();
  const addLessonRelation = useAdminAddVaultLessonRelation();
  const removeLessonRelation = useAdminRemoveVaultLessonRelation();

  const [form, setForm] = useState<FormData>(defaultForm);
  const [tagInput, setTagInput] = useState("");
  const [resourceSearchQuery, setResourceSearchQuery] = useState("");
  const [lessonSearchQuery, setLessonSearchQuery] = useState("");
  const [resourceSearchResults, setResourceSearchResults] = useState<{ id: number; title: string; resourceType: string }[]>([]);
  const [lessonSearchResults, setLessonSearchResults] = useState<{ id: number; title: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingPreview, setUploadingPreview] = useState(false);

  useEffect(() => {
    if (existingResource && !isNew) {
      setForm({
        title: existingResource.title || "",
        description: existingResource.description || "",
        longDescription: existingResource.longDescription || "",
        resourceType: existingResource.resourceType || "document",
        collectionId: existingResource.collectionId,
        fileUrl: existingResource.fileUrl || "",
        fileName: existingResource.fileName || "",
        fileSize: existingResource.fileSize,
        fileType: existingResource.fileType || "",
        previewImageUrl: existingResource.previewImageUrl || "",
        contentHtml: existingResource.contentHtml || "",
        externalUrl: existingResource.externalUrl || "",
        videoUrl: existingResource.videoUrl || "",
        tags: existingResource.tags || [],
        requiredEntitlement: existingResource.requiredEntitlement || "content:frontend",
        isFeatured: existingResource.isFeatured,
        isPinned: existingResource.isPinned,
        isNew: existingResource.isNew,
        status: existingResource.status,
        version: existingResource.version || "",
        updateNote: existingResource.updateNote || "",
      });
    }
  }, [existingResource, isNew]);

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isPreview = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (isPreview) setUploadingPreview(true);
      else setUploading(true);

      const { uploadURL, objectPath } = await uploadUrl.mutateAsync();
      await fetch(uploadURL, { method: "PUT", body: file });

      if (isPreview) {
        updateField("previewImageUrl", objectPath);
      } else {
        updateField("fileUrl", objectPath);
        updateField("fileName", file.name);
        updateField("fileSize", file.size);
        updateField("fileType", file.type);
      }
      toast({ title: isPreview ? "Preview image uploaded" : "File uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      if (isPreview) setUploadingPreview(false);
      else setUploading(false);
    }
  };

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !form.tags.includes(t)) {
      updateField("tags", [...form.tags, t]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    updateField("tags", form.tags.filter(t => t !== tag));
  };

  const handleSearchResources = async (q: string) => {
    setResourceSearchQuery(q);
    if (q.length >= 2) {
      const results = await searchResources.mutateAsync(q);
      setResourceSearchResults(results.filter(r => r.id !== resourceId));
    } else {
      setResourceSearchResults([]);
    }
  };

  const handleSearchLessons = async (q: string) => {
    setLessonSearchQuery(q);
    if (q.length >= 2) {
      const results = await searchLessons.mutateAsync(q);
      setLessonSearchResults(results);
    } else {
      setLessonSearchResults([]);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    try {
      if (isNew) {
        const result = await createResource.mutateAsync(form as any);
        toast({ title: "Resource created" });
        navigate(`/admin/resources/${result.id}/edit`);
      } else {
        await updateResource.mutateAsync({ id: resourceId, ...form } as any);
        toast({ title: "Resource updated" });
      }
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
  };

  const saving = createResource.isPending || updateResource.isPending;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/resources")}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {isNew ? "Add Resource" : "Edit Resource"}
              </h1>
              {!isNew && existingResource && (
                <p className="text-sm text-muted-foreground">ID: {resourceId}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={form.status} onValueChange={(v) => updateField("status", v)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            <Card className="p-6 space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Resource title"
                />
              </div>
              <div>
                <Label>Short Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Brief description shown in listings"
                  rows={2}
                />
              </div>
              <div>
                <Label>Long Description (Markdown)</Label>
                <Textarea
                  value={form.longDescription}
                  onChange={(e) => updateField("longDescription", e.target.value)}
                  placeholder="Detailed description with markdown support"
                  rows={5}
                />
              </div>
            </Card>

            {(form.resourceType === "article") && (
              <Card className="p-6 space-y-4">
                <Label>Content (HTML)</Label>
                <Textarea
                  value={form.contentHtml}
                  onChange={(e) => updateField("contentHtml", e.target.value)}
                  placeholder="<h2>Article content...</h2>"
                  rows={12}
                  className="font-mono text-sm"
                />
              </Card>
            )}

            {["document", "spreadsheet", "template", "image"].includes(form.resourceType) && (
              <Card className="p-6 space-y-4">
                <Label>File Upload</Label>
                {form.fileUrl ? (
                  <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg">
                    <FileText className="w-5 h-5 text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{form.fileName || "Uploaded file"}</p>
                      {form.fileSize && (
                        <p className="text-xs text-muted-foreground">
                          {(form.fileSize / 1024 / 1024).toFixed(2)} MB
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { updateField("fileUrl", ""); updateField("fileName", ""); updateField("fileSize", null); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                    <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-3">
                      {uploading ? "Uploading..." : "Click to upload a file"}
                    </p>
                    <label>
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e)}
                        disabled={uploading}
                      />
                      <span className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 cursor-pointer">
                        Choose File
                      </span>
                    </label>
                  </div>
                )}
              </Card>
            )}

            {(form.resourceType === "video") && (
              <Card className="p-6 space-y-4">
                <Label>Video URL</Label>
                <Input
                  value={form.videoUrl}
                  onChange={(e) => updateField("videoUrl", e.target.value)}
                  placeholder="https://vimeo.com/... or https://youtube.com/..."
                />
              </Card>
            )}

            {(form.resourceType === "link") && (
              <Card className="p-6 space-y-4">
                <Label>External URL</Label>
                <Input
                  value={form.externalUrl}
                  onChange={(e) => updateField("externalUrl", e.target.value)}
                  placeholder="https://example.com/resource"
                />
              </Card>
            )}

            {!isNew && (
              <>
                <Card className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Related Resources</Label>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={resourceSearchQuery}
                      onChange={(e) => handleSearchResources(e.target.value)}
                      placeholder="Search resources to link..."
                      className="pl-9"
                    />
                    {resourceSearchResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {resourceSearchResults.map(r => (
                          <button
                            key={r.id}
                            onClick={() => {
                              addRelation.mutate({ resourceId, relatedResourceId: r.id });
                              setResourceSearchResults([]);
                              setResourceSearchQuery("");
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-secondary text-sm flex items-center gap-2"
                          >
                            <Plus className="w-3 h-3" /> {r.title}
                            <span className="text-xs text-muted-foreground capitalize">({r.resourceType})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {existingResource?.relatedResources && existingResource.relatedResources.length > 0 && (
                    <div className="space-y-2">
                      {existingResource.relatedResources.map(rel => (
                        <div key={rel.relationId} className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                          <div className="flex items-center gap-2">
                            <LinkIcon className="w-3 h-3 text-muted-foreground" />
                            <span className="text-sm">{rel.title}</span>
                            <span className="text-xs text-muted-foreground capitalize">({rel.resourceType})</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRelation.mutate({ resourceId, relationId: rel.relationId })}
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Related Lessons</Label>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={lessonSearchQuery}
                      onChange={(e) => handleSearchLessons(e.target.value)}
                      placeholder="Search lessons to link..."
                      className="pl-9"
                    />
                    {lessonSearchResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {lessonSearchResults.map(l => (
                          <button
                            key={l.id}
                            onClick={() => {
                              addLessonRelation.mutate({ resourceId, lessonId: l.id });
                              setLessonSearchResults([]);
                              setLessonSearchQuery("");
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-secondary text-sm flex items-center gap-2"
                          >
                            <Plus className="w-3 h-3" /> {l.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {existingResource?.relatedLessons && existingResource.relatedLessons.length > 0 && (
                    <div className="space-y-2">
                      {existingResource.relatedLessons.map(rel => (
                        <div key={rel.relationId} className="flex items-center justify-between p-2 bg-secondary/30 rounded">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            <span className="text-sm">{rel.title}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLessonRelation.mutate({ resourceId, relationId: rel.relationId })}
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-6 space-y-4">
              <Label className="text-base font-semibold">Settings</Label>

              <div>
                <Label className="text-xs">Resource Type</Label>
                <Select value={form.resourceType} onValueChange={(v) => updateField("resourceType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOURCE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Collection</Label>
                <Select
                  value={form.collectionId ? String(form.collectionId) : "none"}
                  onValueChange={(v) => updateField("collectionId", v === "none" ? null : parseInt(v, 10))}
                >
                  <SelectTrigger><SelectValue placeholder="Select collection" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Collection</SelectItem>
                    {(collections || []).map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.parentId ? "  └ " : ""}{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Required Entitlement</Label>
                <Select value={form.requiredEntitlement} onValueChange={(v) => updateField("requiredEntitlement", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTITLEMENTS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </Card>

            <Card className="p-6 space-y-4">
              <Label className="text-base font-semibold">Tags</Label>
              <div className="flex flex-wrap gap-1">
                {form.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs gap-1">
                    {tag}
                    <button onClick={() => removeTag(tag)}><X className="w-3 h-3" /></button>
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
                  }}
                  placeholder="Add tag and press Enter"
                  className="text-sm"
                />
                {tagInput && allTags && (
                  <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-32 overflow-y-auto">
                    {allTags
                      .filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !form.tags.includes(t))
                      .slice(0, 8)
                      .map(t => (
                        <button
                          key={t}
                          onClick={() => addTag(t)}
                          className="w-full text-left px-3 py-1.5 hover:bg-secondary text-sm"
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-6 space-y-4">
              <Label className="text-base font-semibold">Preview Image</Label>
              {form.previewImageUrl ? (
                <div className="relative">
                  <div className="w-full h-32 bg-secondary rounded-lg flex items-center justify-center overflow-hidden">
                    <img
                      src={form.previewImageUrl}
                      alt="Preview"
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1"
                    onClick={() => updateField("previewImageUrl", "")}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <label>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={(e) => handleFileUpload(e, true)}
                    disabled={uploadingPreview}
                  />
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors">
                    <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      {uploadingPreview ? "Uploading..." : "Upload preview image"}
                    </p>
                  </div>
                </label>
              )}
            </Card>

            <Card className="p-6 space-y-4">
              <Label className="text-base font-semibold">Display Flags</Label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Featured</Label>
                  <Switch checked={form.isFeatured} onCheckedChange={(v) => updateField("isFeatured", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Pinned</Label>
                  <Switch checked={form.isPinned} onCheckedChange={(v) => updateField("isPinned", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Mark as New</Label>
                  <Switch checked={form.isNew} onCheckedChange={(v) => updateField("isNew", v)} />
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-4">
              <Label className="text-base font-semibold">Versioning</Label>
              <div>
                <Label className="text-xs">Version</Label>
                <Input
                  value={form.version}
                  onChange={(e) => updateField("version", e.target.value)}
                  placeholder="e.g., 1.0, v2"
                />
              </div>
              <div>
                <Label className="text-xs">Update Note</Label>
                <Textarea
                  value={form.updateNote}
                  onChange={(e) => updateField("updateNote", e.target.value)}
                  placeholder="What changed in this version?"
                  rows={2}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
