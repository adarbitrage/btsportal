import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  ExternalLink,
  FileText,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  createHubItem,
  deleteHubItem,
  fetchHubItems,
  updateHubItem,
  type HubItem,
  type HubItemInput,
  type HubSection,
} from "@/lib/resource-hub-api";

const SECTION_LABELS: Record<HubSection, string> = {
  foundations: "Foundations",
  working_documents: "Working Documents",
  templates_assets: "Templates & Assets",
};

type EditorState = {
  id: number | null; // null = create
  section: HubSection;
  kind: "file" | "external" | "group";
  fileId: string;
  externalUrl: string;
  parentId: string; // "" = none
  subGroupLabel: string;
  displayTitle: string;
  blurb: string;
  noteLine: string;
  sortOrder: string;
};

const EMPTY_EDITOR: EditorState = {
  id: null,
  section: "working_documents",
  kind: "file",
  fileId: "",
  externalUrl: "",
  parentId: "",
  subGroupLabel: "",
  displayTitle: "",
  blurb: "",
  noteLine: "",
  sortOrder: "0",
};

function flatten(items: HubItem[]): HubItem[] {
  const out: HubItem[] = [];
  for (const item of items) {
    out.push(item);
    if (item.children) out.push(...item.children);
  }
  return out;
}

export function ResourceHubCuration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-resource-hub-items"],
    queryFn: fetchHubItems,
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HubItem | null>(null);

  const items = data?.items ?? [];
  const groups = useMemo(() => flatten(items).filter((i) => i.kind === "group"), [items]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-resource-hub-items"] });
    void queryClient.invalidateQueries({ queryKey: ["resource-hub"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (state: EditorState) => {
      const input: HubItemInput = {
        section: state.section,
        kind: state.kind,
        displayTitle: state.displayTitle.trim(),
        blurb: state.blurb.trim(),
        noteLine: state.noteLine.trim() || null,
        subGroupLabel: state.subGroupLabel.trim() || null,
        sortOrder: parseInt(state.sortOrder, 10) || 0,
        parentId: state.parentId ? parseInt(state.parentId, 10) : null,
        fileId: state.kind === "file" ? parseInt(state.fileId, 10) || null : null,
        externalUrl: state.kind === "external" ? state.externalUrl.trim() : null,
      };
      return state.id === null ? createHubItem(input) : updateHubItem(state.id, input);
    },
    onSuccess: () => {
      setEditor(null);
      invalidate();
    },
    onError: (err) =>
      toast({ title: "Save failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteHubItem(id),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) =>
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const openEdit = (item: HubItem) =>
    setEditor({
      id: item.id,
      section: item.section,
      kind: item.kind,
      fileId: item.fileId ? String(item.fileId) : "",
      externalUrl: item.externalUrl ?? "",
      parentId: item.parentId != null ? String(item.parentId) : "",
      subGroupLabel: item.subGroupLabel ?? "",
      displayTitle: item.displayTitle,
      blurb: item.blurb,
      noteLine: item.noteLine ?? "",
      sortOrder: String(item.sortOrder),
    });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading curation…
      </div>
    );
  }
  if (isError) {
    return <p className="text-sm text-destructive py-8">Couldn't load curation items.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          These items are exactly what members see on the Resource Hub — section, order, titles, and blurbs.
        </p>
        <Button size="sm" onClick={() => setEditor({ ...EMPTY_EDITOR })} data-testid="button-add-curation-item">
          <Plus className="w-4 h-4 mr-1.5" /> Add item
        </Button>
      </div>

      {(Object.keys(SECTION_LABELS) as HubSection[]).map((section) => {
        const sectionItems = items.filter((i) => i.section === section);
        return (
          <Card key={section} className="border-border/60">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                {SECTION_LABELS[section]}
              </h3>
              {sectionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items in this section.</p>
              ) : (
                <div className="divide-y divide-border">
                  {sectionItems.map((item) => (
                    <div key={item.id}>
                      <CurationRow item={item} onEdit={openEdit} onDelete={setDeleteTarget} />
                      {item.children?.map((child) => (
                        <CurationRow key={child.id} item={child} child onEdit={openEdit} onDelete={setDeleteTarget} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Editor dialog */}
      <Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id === null ? "Add curation item" : "Edit curation item"}</DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Section</Label>
                  <Select value={editor.section} onValueChange={(v) => setEditor({ ...editor, section: v as HubSection })}>
                    <SelectTrigger data-testid="select-section"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SECTION_LABELS) as HubSection[]).map((s) => (
                        <SelectItem key={s} value={s}>{SECTION_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={editor.kind}
                    onValueChange={(v) => setEditor({ ...editor, kind: v as EditorState["kind"] })}
                    disabled={editor.id !== null}
                  >
                    <SelectTrigger data-testid="select-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="file">Drive file</SelectItem>
                      <SelectItem value="external">External link</SelectItem>
                      <SelectItem value="group">Group</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {editor.kind === "file" && (
                <div>
                  <Label className="text-xs">Drive file ID</Label>
                  <Input
                    value={editor.fileId}
                    onChange={(e) => setEditor({ ...editor, fileId: e.target.value })}
                    placeholder="e.g. 42 — find the ID on the Files tab"
                    data-testid="input-file-id"
                  />
                </div>
              )}
              {editor.kind === "external" && (
                <div>
                  <Label className="text-xs">External URL</Label>
                  <Input
                    value={editor.externalUrl}
                    onChange={(e) => setEditor({ ...editor, externalUrl: e.target.value })}
                    placeholder="https://…"
                    data-testid="input-external-url"
                  />
                </div>
              )}

              <div>
                <Label className="text-xs">Display title</Label>
                <Input
                  value={editor.displayTitle}
                  onChange={(e) => setEditor({ ...editor, displayTitle: e.target.value })}
                  data-testid="input-display-title"
                />
              </div>
              <div>
                <Label className="text-xs">Blurb (one line — what it is / when to use it)</Label>
                <Textarea
                  value={editor.blurb}
                  onChange={(e) => setEditor({ ...editor, blurb: e.target.value })}
                  rows={2}
                  data-testid="input-blurb"
                />
              </div>

              {editor.kind === "group" && (
                <div>
                  <Label className="text-xs">Note line (shown at the top of the expanded group)</Label>
                  <Input
                    value={editor.noteLine}
                    onChange={(e) => setEditor({ ...editor, noteLine: e.target.value })}
                    data-testid="input-note-line"
                  />
                </div>
              )}

              {editor.kind !== "group" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Parent group</Label>
                    <Select
                      value={editor.parentId || "none"}
                      onValueChange={(v) => setEditor({ ...editor, parentId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-parent"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (top-level card)</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>{g.displayTitle}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Sub-group label</Label>
                    <Input
                      value={editor.subGroupLabel}
                      onChange={(e) => setEditor({ ...editor, subGroupLabel: e.target.value })}
                      placeholder='e.g. "Teaching Guides"'
                      data-testid="input-sub-group"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs">Sort order</Label>
                <Input
                  value={editor.sortOrder}
                  onChange={(e) => setEditor({ ...editor, sortOrder: e.target.value })}
                  type="number"
                  data-testid="input-sort-order"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
            <Button
              onClick={() => editor && saveMutation.mutate(editor)}
              disabled={saveMutation.isPending || !editor?.displayTitle.trim()}
              data-testid="button-save-curation-item"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove "{deleteTarget?.displayTitle}" from the hub?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the curation entry (and any items inside it) from the member page. The underlying drive
            files are NOT deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-curation"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CurationRow({
  item,
  child,
  onEdit,
  onDelete,
}: {
  item: HubItem;
  child?: boolean;
  onEdit: (item: HubItem) => void;
  onDelete: (item: HubItem) => void;
}) {
  const Icon = item.kind === "group" ? FolderTree : item.kind === "external" ? ExternalLink : FileText;
  return (
    <div
      className={`flex items-center gap-3 py-2.5 ${child ? "pl-8" : ""}`}
      data-testid={`row-curation-${item.id}`}
    >
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground leading-snug">
          {item.displayTitle}
          {item.subGroupLabel && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">({item.subGroupLabel})</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {item.kind === "file" ? (item.fileName ?? "⚠ drive file missing") : item.kind === "external" ? item.externalUrl : "Group"}
          {" · "}order {item.sortOrder}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onEdit(item)} data-testid={`button-edit-curation-${item.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive" onClick={() => onDelete(item)} data-testid={`button-delete-curation-${item.id}`}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
