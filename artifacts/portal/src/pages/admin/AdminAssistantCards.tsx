import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutGrid,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  GripVertical,
  AlertTriangle,
  Search,
  X,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
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
  useAdminAssistantGroups,
  useAdminAssistantCards,
  useAdminCreateAssistantCard,
  useAdminUpdateAssistantCard,
  useAdminReorderAssistantCards,
  useAdminUpgradeProducts,
  type AssistantCard,
} from "@/lib/admin-api";

const ENTITLEMENT_KEYS = [
  "content:frontend",
  "content:advanced",
  "software:base",
  "software:expanded",
  "coaching:group",
  "coaching:mastermind",
  "coaching:one_on_one:monthly",
  "coaching:one_on_one:weekly",
  "coaching:one_on_one:3month",
  "coaching:one_on_one:6month",
  "community:access",
  "chat:basic",
  "chat:full",
  "chat:ai",
  "chat:custom",
  "support:basic",
  "support:standard",
  "support:enhanced",
  "support:vip",
  "support:unlimited",
  "vault:view",
  "vault:manage",
];

const ENTITLEMENT_NONE = "__none__";

function getLucideIcon(name: string): React.ComponentType<{ className?: string }> | null {
  if (!name) return null;
  const icon = (LucideIcons as Record<string, unknown>)[name];
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null)) {
    return icon as React.ComponentType<{ className?: string }>;
  }
  return null;
}

function IconPreview({ name, className = "w-5 h-5" }: { name: string; className?: string }) {
  const Icon = getLucideIcon(name);
  if (!Icon) return <span className="text-muted-foreground text-xs">?</span>;
  return <Icon className={className} />;
}

const ALL_ICON_NAMES = Object.keys(LucideIcons).filter(
  (k) => /^[A-Z]/.test(k) && k !== "createLucideIcon" && !k.endsWith("Icon"),
);

function IconPickerDialog({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (name: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return ALL_ICON_NAMES.slice(0, 120);
    return ALL_ICON_NAMES.filter((n) => n.toLowerCase().includes(q)).slice(0, 120);
  }, [search]);

  function handleSelect(name: string) {
    onChange(name);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Pick an Icon</DialogTitle>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search icon names…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 p-1">
            {filtered.map((name) => {
              const Icon = getLucideIcon(name);
              if (!Icon) return null;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => handleSelect(name)}
                  className={`flex flex-col items-center justify-center gap-1 p-2 rounded-md border text-xs hover:bg-accent hover:text-accent-foreground transition-colors ${
                    value === name ? "border-primary bg-primary/10 text-primary" : "border-transparent"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="truncate w-full text-center leading-none" style={{ fontSize: 9 }}>
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">No icons found.</div>
          )}
          {search === "" && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing first 120 icons. Type to search all {ALL_ICON_NAMES.length}.
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { onChange(""); onClose(); }}
            >
              Clear icon
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CardFormState {
  title: string;
  description: string;
  icon: string;
  entitlementKey: string;
  upgradeProductId: string;
  isActive: boolean;
}

function CardFormDialog({
  open,
  onClose,
  card,
  groupId,
}: {
  open: boolean;
  onClose: () => void;
  card: AssistantCard | null;
  groupId: number;
}) {
  const { toast } = useToast();
  const createMutation = useAdminCreateAssistantCard();
  const updateMutation = useAdminUpdateAssistantCard();
  const { data: products = [] } = useAdminUpgradeProducts();

  const [form, setForm] = useState<CardFormState>(() => ({
    title: card?.title ?? "",
    description: card?.description ?? "",
    icon: card?.icon ?? "",
    entitlementKey: card?.entitlementKey ?? ENTITLEMENT_NONE,
    upgradeProductId: card?.upgradeProductId != null ? String(card.upgradeProductId) : "",
    isActive: card?.isActive ?? true,
  }));

  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  function setField<K extends keyof CardFormState>(key: K, value: CardFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleEntitlementChange(val: string) {
    setForm((prev) => ({
      ...prev,
      entitlementKey: val,
      upgradeProductId: val === ENTITLEMENT_NONE ? "" : prev.upgradeProductId,
    }));
  }

  const hasEntitlement = form.entitlementKey && form.entitlementKey !== ENTITLEMENT_NONE;
  const showUpgradeWarning = hasEntitlement && !form.upgradeProductId;

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    const payload = {
      groupId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      icon: form.icon.trim() || null,
      entitlementKey: hasEntitlement ? form.entitlementKey : null,
      upgradeProductId: form.upgradeProductId ? parseInt(form.upgradeProductId, 10) : null,
    };

    try {
      if (card) {
        await updateMutation.mutateAsync({
          id: card.id,
          data: { ...payload, isActive: form.isActive },
        });
        toast({ title: "Card updated" });
      } else {
        await createMutation.mutateAsync(payload);
        toast({ title: "Card created" });
      }
      onClose();
    } catch (err: unknown) {
      toast({
        title: card ? "Failed to update card" : "Failed to create card",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <Dialog open={open && !iconPickerOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{card ? "Edit Card" : "New Card"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="card-title">Title <span className="text-destructive">*</span></Label>
              <Input
                id="card-title"
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="e.g. DIYTrax Setup"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="card-description">Description</Label>
              <Textarea
                id="card-description"
                value={form.description}
                onChange={(e) => setField("description", e.target.value)}
                placeholder="Brief description shown on the card"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Icon</Label>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-md border border-border bg-muted shrink-0">
                  {form.icon ? (
                    <IconPreview name={form.icon} className="w-5 h-5" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <Input
                  value={form.icon}
                  onChange={(e) => setField("icon", e.target.value)}
                  placeholder="e.g. Zap, BookOpen, LayoutGrid"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIconPickerOpen(true)}
                >
                  Browse
                </Button>
                {form.icon && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setField("icon", "")}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="card-entitlement">Entitlement (access gate)</Label>
              <Select value={form.entitlementKey || ENTITLEMENT_NONE} onValueChange={handleEntitlementChange}>
                <SelectTrigger id="card-entitlement">
                  <SelectValue placeholder="None — visible to all members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTITLEMENT_NONE}>None — visible to all members</SelectItem>
                  {ENTITLEMENT_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="card-upgrade-product">Upgrade product</Label>
              <Select
                value={form.upgradeProductId || "__none__"}
                onValueChange={(v) => setField("upgradeProductId", v === "__none__" ? "" : v)}
                disabled={!hasEntitlement}
              >
                <SelectTrigger id="card-upgrade-product" className={!hasEntitlement ? "opacity-50" : ""}>
                  <SelectValue placeholder={hasEntitlement ? "Select upgrade product…" : "Set an entitlement first"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                      <span className="ml-1.5 text-xs text-muted-foreground font-mono">{p.slug}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!hasEntitlement && (
                <p className="text-xs text-muted-foreground">
                  Only relevant when an entitlement key is set.
                </p>
              )}
              {showUpgradeWarning && (
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-500 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    No upgrade product selected. Members locked out of this card will see no upgrade
                    prompt. Consider setting a product so they know how to unlock it.
                  </span>
                </div>
              )}
            </div>

            {card && (
              <div className="flex items-center gap-3">
                <Switch
                  id="card-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setField("isActive", v)}
                />
                <Label htmlFor="card-active" className="cursor-pointer select-none">
                  Active (visible to members)
                </Label>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : card ? "Save changes" : "Create card"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <IconPickerDialog
        open={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        value={form.icon}
        onChange={(name) => setField("icon", name)}
      />
    </>
  );
}

function SortableCardRow({
  card,
  onEdit,
  onToggleActive,
  dragDisabled,
}: {
  card: AssistantCard;
  onEdit: (c: AssistantCard) => void;
  onToggleActive: (c: AssistantCard) => void;
  dragDisabled: boolean;
}) {
  const [, navigate] = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `card-${card.id}`,
    disabled: dragDisabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  const IconComp = card.icon ? getLucideIcon(card.icon) : null;

  return (
    <div ref={setNodeRef} style={style}>
      <Card className={`border border-border ${!card.isActive ? "opacity-60" : ""} ${isDragging ? "shadow-lg" : ""}`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`flex items-center justify-center h-10 w-6 text-muted-foreground touch-none ${
                dragDisabled ? "opacity-40 cursor-not-allowed" : "hover:text-foreground cursor-grab active:cursor-grabbing"
              }`}
              aria-label={`Drag to reorder ${card.title}`}
              disabled={dragDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted shrink-0">
              {IconComp ? (
                <IconComp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <LayoutGrid className="w-4 h-4 text-muted-foreground" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{card.title}</span>
                {!card.isActive && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>
                )}
                {card.entitlementKey && (
                  <Badge variant="secondary" className="text-xs font-mono">
                    {card.entitlementKey}
                  </Badge>
                )}
              </div>
              {card.description && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">{card.description}</p>
              )}
              {card.entitlementKey && card.upgradeProductName && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upgrade: {card.upgradeProductName}
                </p>
              )}
              {card.entitlementKey && !card.upgradeProductId && (
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  No upgrade product set
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleActive(card)}
                title={card.isActive ? "Deactivate" : "Activate"}
              >
                {card.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onEdit(card)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const groupId = card.groupId;
                  navigate(`/admin/assistant/groups/${groupId}/cards/${card.id}/questions`);
                }}
                title="Manage questions"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminAssistantCards() {
  const params = useParams<{ groupId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const groupId = parseInt(params.groupId ?? "0", 10);

  const { data: groups = [] } = useAdminAssistantGroups();
  const { data: allCards = [], isLoading } = useAdminAssistantCards();
  const updateMutation = useAdminUpdateAssistantCard();
  const reorderMutation = useAdminReorderAssistantCards();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<AssistantCard | null>(null);
  const [localCards, setLocalCards] = useState<AssistantCard[] | null>(null);

  const group = groups.find((g) => g.id === groupId);
  const groupCards = useMemo(
    () => allCards.filter((c) => c.groupId === groupId).sort((a, b) => a.sortOrder - b.sortOrder),
    [allCards, groupId],
  );
  const displayCards = localCards ?? groupCards;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openCreate() {
    setEditingCard(null);
    setDialogOpen(true);
  }

  function openEdit(card: AssistantCard) {
    setEditingCard(card);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingCard(null);
    setLocalCards(null);
  }

  async function handleToggleActive(card: AssistantCard) {
    try {
      await updateMutation.mutateAsync({ id: card.id, data: { isActive: !card.isActive } });
      toast({ title: card.isActive ? "Card deactivated" : "Card activated" });
    } catch {
      toast({ title: "Failed to update card", variant: "destructive" });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayCards.findIndex((c) => `card-${c.id}` === active.id);
    const newIndex = displayCards.findIndex((c) => `card-${c.id}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayCards, oldIndex, newIndex);
    setLocalCards(reordered);

    try {
      await reorderMutation.mutateAsync(reordered.map((c) => c.id));
      setLocalCards(null);
    } catch {
      toast({ title: "Failed to save new order", variant: "destructive" });
      setLocalCards(null);
    }
  }

  const dragDisabled = reorderMutation.isPending;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
            <button
              className="hover:text-foreground transition-colors"
              onClick={() => navigate("/admin/assistant/groups")}
            >
              Groups
            </button>
            <span>/</span>
            <span className="text-foreground font-medium">{group?.name ?? `Group ${groupId}`}</span>
          </nav>

          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground"
                  onClick={() => navigate("/admin/assistant/groups")}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to Groups
                </Button>
              </div>
              <h1 className="text-2xl font-bold text-foreground">
                {group?.name ?? "Cards"}
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage assistant cards in this group.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" /> New Card
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="w-5 h-5" />
              Cards
              {groupCards.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({groupCards.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading cards…</div>
            ) : displayCards.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No cards in this group yet. Create one to get started.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayCards.map((c) => `card-${c.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayCards.map((card) => (
                    <SortableCardRow
                      key={card.id}
                      card={card}
                      onEdit={openEdit}
                      onToggleActive={handleToggleActive}
                      dragDisabled={dragDisabled}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <CardFormDialog
          key={editingCard?.id ?? "new"}
          open={dialogOpen}
          onClose={closeDialog}
          card={editingCard}
          groupId={groupId}
        />
      </div>
    </AppLayout>
  );
}
