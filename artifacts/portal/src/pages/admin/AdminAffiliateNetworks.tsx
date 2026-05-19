import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Network,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Star,
  X,
  Upload,
  Image,
  GripVertical,
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
  useAdminAffiliateNetworks,
  useAdminCreateAffiliateNetwork,
  useAdminUpdateAffiliateNetwork,
  useAdminDeleteAffiliateNetwork,
  useAdminReorderAffiliateNetworks,
  type AdminAffiliateNetwork,
  type AffiliateNetworkFormData,
  adminAffiliateNetworksApi,
} from "@/lib/admin-api";

const ACCENT_PRESETS = [
  {
    key: "emerald",
    label: "Emerald",
    border: "border-emerald-300",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-800",
    badgeBorder: "border-emerald-200",
    preview: "bg-emerald-400",
  },
  {
    key: "amber",
    label: "Amber",
    border: "border-amber-300",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-800",
    badgeBorder: "border-amber-200",
    preview: "bg-amber-400",
  },
  {
    key: "violet",
    label: "Violet",
    border: "border-violet-300",
    badgeBg: "bg-violet-50",
    badgeText: "text-violet-800",
    badgeBorder: "border-violet-200",
    preview: "bg-violet-400",
  },
  {
    key: "orange",
    label: "Orange",
    border: "border-orange-300",
    badgeBg: "bg-orange-50",
    badgeText: "text-orange-800",
    badgeBorder: "border-orange-200",
    preview: "bg-orange-400",
  },
  {
    key: "blue",
    label: "Blue",
    border: "border-blue-300",
    badgeBg: "bg-blue-50",
    badgeText: "text-blue-800",
    badgeBorder: "border-blue-200",
    preview: "bg-blue-400",
  },
  {
    key: "rose",
    label: "Rose",
    border: "border-rose-300",
    badgeBg: "bg-rose-50",
    badgeText: "text-rose-800",
    badgeBorder: "border-rose-200",
    preview: "bg-rose-400",
  },
  {
    key: "custom",
    label: "Custom",
    border: "",
    badgeBg: "",
    badgeText: "",
    badgeBorder: "",
    preview: "bg-gray-400",
  },
];

const EMPTY_FORM: AffiliateNetworkFormData = {
  slug: "",
  name: "",
  tagline: "",
  description: "",
  logoUrl: null,
  logoBg: "bg-white",
  highlights: [""],
  publishers: "",
  approvalLabel: "",
  recommendedForBeginners: false,
  accentPreset: "emerald",
  accentBorder: "border-emerald-300",
  accentBadgeBg: "bg-emerald-50",
  accentBadgeText: "text-emerald-800",
  accentBadgeBorder: "border-emerald-200",
  registerUrl: "",
  loginUrl: "",
  extraCtaLabel: "",
  extraCtaHref: "",
  extraCtaStyle: "default",
  displayOrder: 0,
  isActive: true,
};

function networkToForm(n: AdminAffiliateNetwork): AffiliateNetworkFormData {
  return {
    slug: n.slug,
    name: n.name,
    tagline: n.tagline,
    description: n.description,
    logoUrl: n.logoUrl,
    logoBg: n.logoBg,
    highlights: n.highlights.length > 0 ? n.highlights : [""],
    publishers: n.publishers,
    approvalLabel: n.approvalLabel,
    recommendedForBeginners: n.recommendedForBeginners,
    accentPreset: n.accentPreset,
    accentBorder: n.accentBorder,
    accentBadgeBg: n.accentBadgeBg,
    accentBadgeText: n.accentBadgeText,
    accentBadgeBorder: n.accentBadgeBorder,
    registerUrl: n.registerUrl ?? "",
    loginUrl: n.loginUrl ?? "",
    extraCtaLabel: n.extraCtaLabel ?? "",
    extraCtaHref: n.extraCtaHref ?? "",
    extraCtaStyle: n.extraCtaStyle,
    displayOrder: n.displayOrder,
    isActive: n.isActive,
  };
}

function LogoUploader({
  logoUrl,
  onChange,
}: {
  logoUrl: string | null;
  onChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await adminAffiliateNetworksApi.getLogoUploadUrl();
      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      onChange(objectPath);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload logo. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const displaySrc = logoUrl
    ? logoUrl.startsWith("http://") || logoUrl.startsWith("https://")
      ? logoUrl
      : `${import.meta.env.BASE_URL}api${logoUrl}`
    : null;

  return (
    <div className="space-y-2">
      {displaySrc && (
        <div className="relative inline-block border rounded-md overflow-hidden bg-white p-2">
          <img src={displaySrc} alt="Logo preview" className="max-h-16 max-w-32 object-contain" />
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
              {uploading ? "Uploading…" : "Upload logo"}
            </span>
          </Button>
        </label>
        {logoUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Or enter URL:</span>
        <Input
          placeholder="https://..."
          value={logoUrl?.startsWith("http") ? logoUrl : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-7 text-xs flex-1"
        />
      </div>
    </div>
  );
}

function HighlightsEditor({
  highlights,
  onChange,
}: {
  highlights: string[];
  onChange: (h: string[]) => void;
}) {
  function updateAt(i: number, val: string) {
    const next = [...highlights];
    next[i] = val;
    onChange(next);
  }
  function removeAt(i: number) {
    onChange(highlights.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...highlights, ""]);
  }
  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...highlights];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  }
  function moveDown(i: number) {
    if (i === highlights.length - 1) return;
    const next = [...highlights];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      {highlights.map((h, i) => (
        <div key={i} className="flex gap-1 items-center">
          <div className="flex flex-col gap-0.5">
            <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveUp(i)} disabled={i === 0}>
              <ChevronUp className="w-3 h-3" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveDown(i)} disabled={i === highlights.length - 1}>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </div>
          <Input
            value={h}
            onChange={(e) => updateAt(i, e.target.value)}
            placeholder={`Highlight ${i + 1}`}
            className="flex-1 h-8 text-sm"
          />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeAt(i)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="w-3.5 h-3.5 mr-1.5" /> Add highlight
      </Button>
    </div>
  );
}

function AccentPicker({
  preset,
  customBorder,
  customBadgeBg,
  customBadgeText,
  customBadgeBorder,
  onChange,
}: {
  preset: string;
  customBorder: string;
  customBadgeBg: string;
  customBadgeText: string;
  customBadgeBorder: string;
  onChange: (updates: { accentPreset: string; accentBorder: string; accentBadgeBg: string; accentBadgeText: string; accentBadgeBorder: string }) => void;
}) {
  function selectPreset(key: string) {
    const p = ACCENT_PRESETS.find((x) => x.key === key);
    if (!p || p.key === "custom") {
      onChange({ accentPreset: "custom", accentBorder: customBorder, accentBadgeBg: customBadgeBg, accentBadgeText: customBadgeText, accentBadgeBorder: customBadgeBorder });
    } else {
      onChange({ accentPreset: p.key, accentBorder: p.border, accentBadgeBg: p.badgeBg, accentBadgeText: p.badgeText, accentBadgeBorder: p.badgeBorder });
    }
  }

  const currentBorder = preset !== "custom" ? (ACCENT_PRESETS.find((x) => x.key === preset)?.border ?? customBorder) : customBorder;
  const currentBadgeBg = preset !== "custom" ? (ACCENT_PRESETS.find((x) => x.key === preset)?.badgeBg ?? customBadgeBg) : customBadgeBg;
  const currentBadgeText = preset !== "custom" ? (ACCENT_PRESETS.find((x) => x.key === preset)?.badgeText ?? customBadgeText) : customBadgeText;
  const currentBadgeBorder = preset !== "custom" ? (ACCENT_PRESETS.find((x) => x.key === preset)?.badgeBorder ?? customBadgeBorder) : customBadgeBorder;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => selectPreset(p.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm transition-all ${
              preset === p.key ? "ring-2 ring-primary border-primary" : "border-border hover:border-muted-foreground"
            }`}
          >
            <span className={`w-3 h-3 rounded-full ${p.preview}`} />
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded-md">
          <div>
            <Label className="text-xs">Border class</Label>
            <Input
              value={customBorder}
              onChange={(e) => onChange({ accentPreset: "custom", accentBorder: e.target.value, accentBadgeBg: customBadgeBg, accentBadgeText: customBadgeText, accentBadgeBorder: customBadgeBorder })}
              placeholder="border-indigo-300"
              className="h-7 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Badge bg class</Label>
            <Input
              value={customBadgeBg}
              onChange={(e) => onChange({ accentPreset: "custom", accentBorder: customBorder, accentBadgeBg: e.target.value, accentBadgeText: customBadgeText, accentBadgeBorder: customBadgeBorder })}
              placeholder="bg-indigo-50"
              className="h-7 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Badge text class</Label>
            <Input
              value={customBadgeText}
              onChange={(e) => onChange({ accentPreset: "custom", accentBorder: customBorder, accentBadgeBg: customBadgeBg, accentBadgeText: e.target.value, accentBadgeBorder: customBadgeBorder })}
              placeholder="text-indigo-800"
              className="h-7 text-xs mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Badge border class</Label>
            <Input
              value={customBadgeBorder}
              onChange={(e) => onChange({ accentPreset: "custom", accentBorder: customBorder, accentBadgeBg: customBadgeBg, accentBadgeText: customBadgeText, accentBadgeBorder: e.target.value })}
              placeholder="border-indigo-200"
              className="h-7 text-xs mt-1"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground text-xs">Preview:</span>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border-2 ${currentBorder}`}>
          <Badge variant="outline" className={`${currentBadgeBg} ${currentBadgeText} ${currentBadgeBorder} text-xs`}>
            Sample badge
          </Badge>
        </div>
      </div>
    </div>
  );
}

function NetworkFormDialog({
  open,
  onClose,
  network,
}: {
  open: boolean;
  onClose: () => void;
  network: AdminAffiliateNetwork | null;
}) {
  const { toast } = useToast();
  const isEdit = Boolean(network);
  const [form, setForm] = useState<AffiliateNetworkFormData>(() =>
    network ? networkToForm(network) : { ...EMPTY_FORM }
  );

  const createMutation = useAdminCreateAffiliateNetwork();
  const updateMutation = useAdminUpdateAffiliateNetwork();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function set<K extends keyof AffiliateNetworkFormData>(key: K, value: AffiliateNetworkFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: AffiliateNetworkFormData = {
      ...form,
      highlights: form.highlights.filter((h) => h.trim() !== ""),
      logoUrl: form.logoUrl || null,
      registerUrl: form.registerUrl || null,
      loginUrl: form.loginUrl || null,
      extraCtaLabel: form.extraCtaLabel || null,
      extraCtaHref: form.extraCtaHref || null,
    };
    try {
      if (isEdit && network) {
        await updateMutation.mutateAsync({ id: network.id, data: payload });
        toast({ title: "Network updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Network created" });
      }
      onClose();
    } catch (err: unknown) {
      toast({ title: isEdit ? "Update failed" : "Create failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${network?.name}` : "Create Affiliate Network"}</DialogTitle>
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
                placeholder="e.g. my-network"
              />
            </div>
          </div>

          <div>
            <Label>Tagline</Label>
            <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} className="mt-1" placeholder="Short one-liner shown under the name" />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="mt-1"
              rows={4}
              placeholder="Full description shown on the card"
            />
          </div>

          <div>
            <Label>Logo</Label>
            <div className="mt-1">
              <LogoUploader logoUrl={form.logoUrl} onChange={(url) => set("logoUrl", url)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Logo background</Label>
              <Select value={form.logoBg} onValueChange={(v) => set("logoBg", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bg-white">White</SelectItem>
                  <SelectItem value="bg-gray-100">Light gray</SelectItem>
                  <SelectItem value="bg-black">Black</SelectItem>
                  <SelectItem value="bg-transparent">Transparent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Publishers</Label>
              <Input
                value={form.publishers}
                onChange={(e) => set("publishers", e.target.value)}
                className="mt-1"
                placeholder="e.g. Caterpillar, Grasshopper"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Approval label</Label>
              <Input
                value={form.approvalLabel}
                onChange={(e) => set("approvalLabel", e.target.value)}
                className="mt-1"
                placeholder="e.g. Instant signup"
              />
            </div>
            <div className="flex items-center gap-3 mt-6">
              <Switch
                checked={form.recommendedForBeginners}
                onCheckedChange={(v) => set("recommendedForBeginners", v)}
              />
              <Label className="cursor-pointer select-none">Recommended for beginners</Label>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Accent color</Label>
            <AccentPicker
              preset={form.accentPreset}
              customBorder={form.accentBorder}
              customBadgeBg={form.accentBadgeBg}
              customBadgeText={form.accentBadgeText}
              customBadgeBorder={form.accentBadgeBorder}
              onChange={(updates) =>
                setForm((prev) => ({ ...prev, ...updates }))
              }
            />
          </div>

          <div>
            <Label className="mb-1.5 block">Highlights</Label>
            <HighlightsEditor
              highlights={form.highlights}
              onChange={(h) => set("highlights", h)}
            />
          </div>

          <div className="space-y-1">
            <Label>Register URL</Label>
            <Input
              value={form.registerUrl ?? ""}
              onChange={(e) => set("registerUrl", e.target.value)}
              placeholder="https://..."
              className="mt-1"
              type="url"
            />
          </div>

          <div className="space-y-1">
            <Label>Login URL</Label>
            <Input
              value={form.loginUrl ?? ""}
              onChange={(e) => set("loginUrl", e.target.value)}
              placeholder="https://..."
              className="mt-1"
              type="url"
            />
          </div>

          <div className="border rounded-md p-4 space-y-3">
            <p className="text-sm font-medium">Extra CTA button (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Button label</Label>
                <Input
                  value={form.extraCtaLabel ?? ""}
                  onChange={(e) => set("extraCtaLabel", e.target.value)}
                  placeholder="e.g. View Products"
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Button href (URL or path)</Label>
                <Input
                  value={form.extraCtaHref ?? ""}
                  onChange={(e) => set("extraCtaHref", e.target.value)}
                  placeholder="e.g. /media-mavens"
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Button style</Label>
              <Select value={form.extraCtaStyle} onValueChange={(v) => set("extraCtaStyle", v)}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default (blue)</SelectItem>
                  <SelectItem value="emerald">Emerald (green)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Display order</Label>
              <Input
                type="number"
                value={form.displayOrder}
                onChange={(e) => set("displayOrder", parseInt(e.target.value, 10) || 0)}
                className="mt-1"
                min={0}
              />
            </div>
            <div className="flex items-center gap-3 mt-6">
              <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
              <Label className="cursor-pointer select-none">Active (visible to members)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : isEdit ? "Save changes" : "Create network"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SortableNetworkCard({
  network,
  onToggleActive,
  onEdit,
  onDelete,
  toggleDisabled,
  dragDisabled,
}: {
  network: AdminAffiliateNetwork;
  onToggleActive: (n: AdminAffiliateNetwork) => void;
  onEdit: (n: AdminAffiliateNetwork) => void;
  onDelete: (n: AdminAffiliateNetwork) => void;
  toggleDisabled: boolean;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: network.id,
    disabled: dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  const accentBorder = network.accentBorder || "border-gray-200";
  const logoSrc = network.logoUrl
    ? network.logoUrl.startsWith("http://") || network.logoUrl.startsWith("https://")
      ? network.logoUrl
      : `${import.meta.env.BASE_URL}api${network.logoUrl}`
    : null;

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={`border-2 ${accentBorder} ${!network.isActive ? "opacity-60" : ""} ${
          isDragging ? "shadow-lg" : ""
        }`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none ${
                dragDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:text-foreground cursor-grab active:cursor-grabbing"
              }`}
              aria-label={`Drag to reorder ${network.name}`}
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-5 h-5" />
            </button>

            <div className={`${network.logoBg} w-16 h-12 flex items-center justify-center rounded border border-border shrink-0`}>
              {logoSrc ? (
                <img src={logoSrc} alt={network.name} className="max-h-10 max-w-14 object-contain" />
              ) : (
                <Network className="w-6 h-6 text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{network.name}</span>
                <span className="text-xs text-muted-foreground font-mono">{network.slug}</span>
                {network.recommendedForBeginners && (
                  <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white text-[10px]">
                    <Star className="w-2.5 h-2.5 mr-1" />Beginners
                  </Badge>
                )}
                {!network.isActive && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate mt-0.5">{network.tagline}</p>
              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                <span>{network.approvalLabel}</span>
                {network.highlights.length > 0 && <span>{network.highlights.length} highlights</span>}
                <span>Order: {network.displayOrder}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleActive(network)}
                disabled={toggleDisabled}
                title={network.isActive ? "Deactivate" : "Activate"}
              >
                {network.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(network)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(network)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminAffiliateNetworks() {
  const { toast } = useToast();
  const { data: networks = [], isLoading } = useAdminAffiliateNetworks();
  const deleteMutation = useAdminDeleteAffiliateNetwork();
  const updateMutation = useAdminUpdateAffiliateNetwork();
  const reorderMutation = useAdminReorderAffiliateNetworks();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAffiliateNetwork | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAffiliateNetwork | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(n: AdminAffiliateNetwork) {
    setEditing(n);
    setDialogOpen(true);
  }

  async function handleToggleActive(n: AdminAffiliateNetwork) {
    try {
      await updateMutation.mutateAsync({ id: n.id, data: { isActive: !n.isActive } });
      toast({ title: n.isActive ? "Network hidden" : "Network activated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  }

  const sorted = [...networks].sort((a, b) => a.displayOrder - b.displayOrder);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((n) => n.id === active.id);
    const newIndex = sorted.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    const order = reordered.map((n, i) => ({ id: n.id, displayOrder: i }));
    try {
      await reorderMutation.mutateAsync(order);
    } catch {
      toast({ title: "Reorder failed", variant: "destructive" });
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Affiliate Networks</h1>
              <p className="text-sm text-muted-foreground">Manage the affiliate networks shown to members</p>
            </div>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> New network
          </Button>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            <Network className="w-8 h-8 mx-auto mb-2 opacity-40 animate-pulse" />
            <p>Loading networks…</p>
          </div>
        )}

        {!isLoading && sorted.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Image className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium mb-1">No affiliate networks yet</p>
              <p className="text-sm mb-4">Create your first network to get started.</p>
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" /> New network
              </Button>
            </CardContent>
          </Card>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sorted.map((n) => n.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sorted.map((n) => (
                <SortableNetworkCard
                  key={n.id}
                  network={n}
                  onToggleActive={handleToggleActive}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                  toggleDisabled={updateMutation.isPending}
                  dragDisabled={reorderMutation.isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <NetworkFormDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          network={editing}
        />

        <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(v) => !v && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the network from the database. Members will no longer see it on the Affiliate Networks page. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
