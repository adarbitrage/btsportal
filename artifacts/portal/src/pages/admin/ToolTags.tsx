import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tags, Plus, Trash2, Lock, Sparkles, Check, X, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api/admin/knowledgebase/tool-tags`;

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  return (await res.json()) as T;
}

interface ToolTag {
  id: number;
  slug: string;
  label: string;
  triggers: string[];
  enabled: boolean;
  protected: boolean;
  source: string;
}

interface Proposal {
  id: number;
  slug: string;
  label: string;
  suggestedTriggers: string[];
  occurrenceCount: number;
  exampleContext: string | null;
  lastSeenAt: string;
}

interface ToolTagsResponse {
  toolTags: ToolTag[];
  proposals: Proposal[];
  conceptTags: string[];
  troubleshootingTag: string;
  effectiveTags: string[];
}

function parseTriggers(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export default function ToolTags() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ToolTagsResponse>({
    queryKey: ["admin", "tool-tags"],
    queryFn: () => api<ToolTagsResponse>(""),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newTriggers, setNewTriggers] = useState("");

  const [editing, setEditing] = useState<ToolTag | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editTriggers, setEditTriggers] = useState("");

  const [reviewing, setReviewing] = useState<Proposal | null>(null);
  const [reviewSlug, setReviewSlug] = useState("");
  const [reviewLabel, setReviewLabel] = useState("");
  const [reviewTriggers, setReviewTriggers] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "tool-tags"] });
  const onError = (err: unknown) =>
    toast({ title: "Error", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });

  const createMut = useMutation({
    mutationFn: () =>
      api("", {
        method: "POST",
        body: JSON.stringify({ label: newLabel, slug: newSlug || undefined, triggers: parseTriggers(newTriggers) }),
      }),
    onSuccess: () => {
      toast({ title: "Tool tag created" });
      setCreateOpen(false);
      setNewLabel("");
      setNewSlug("");
      setNewTriggers("");
      invalidate();
    },
    onError,
  });

  const patchMut = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      api(`/${vars.id}`, { method: "PATCH", body: JSON.stringify(vars.body) }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api(`/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Tool tag deleted" });
      invalidate();
    },
    onError,
  });

  const approveMut = useMutation({
    mutationFn: (vars: { id: number; body: Record<string, unknown> }) =>
      api(`/proposals/${vars.id}/approve`, { method: "POST", body: JSON.stringify(vars.body) }),
    onSuccess: () => {
      toast({ title: "Proposal approved" });
      setReviewing(null);
      invalidate();
    },
    onError,
  });

  const rejectMut = useMutation({
    mutationFn: (id: number) => api(`/proposals/${id}/reject`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast({ title: "Proposal rejected" });
      invalidate();
    },
    onError,
  });

  const openEdit = (tag: ToolTag) => {
    setEditing(tag);
    setEditLabel(tag.label);
    setEditTriggers((tag.triggers ?? []).join(", "));
  };

  const openReview = (p: Proposal) => {
    setReviewing(p);
    setReviewSlug(p.slug);
    setReviewLabel(p.label);
    setReviewTriggers((p.suggestedTriggers ?? []).join(", "));
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Tags className="h-6 w-6" /> Tool Tags
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage the TOOL-tag vocabulary the assistant uses for retrieval and triage. Changes take effect
              immediately — no deploy. Concept and troubleshooting tags are code-defined and shown for reference only.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-tool-tag">
            <Plus className="mr-1 h-4 w-4" /> Add tool tag
          </Button>
        </div>

        {/* AI proposal queue */}
        {(data?.proposals?.length ?? 0) > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-amber-500" /> Proposed by AI ({data?.proposals.length})
              </h2>
              <p className="text-muted-foreground mb-3 text-sm">
                Tools the assistant noticed during triage. Approve to add them to the live vocabulary, or reject.
              </p>
              <div className="space-y-2">
                {data?.proposals.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                    data-testid={`proposal-${p.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.label}</span>
                        <Badge variant="outline">{p.slug}</Badge>
                        <Badge variant="secondary">seen {p.occurrenceCount}×</Badge>
                      </div>
                      {p.exampleContext && (
                        <p className="text-muted-foreground truncate text-xs">from: {p.exampleContext}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => openReview(p)} data-testid={`button-approve-${p.id}`}>
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rejectMut.mutate(p.id)}
                        data-testid={`button-reject-${p.id}`}
                      >
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tool tags table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Triggers</TableHead>
                  <TableHead className="w-24">Enabled</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (data?.toolTags?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                      No tool tags yet.
                    </TableCell>
                  </TableRow>
                )}
                {data?.toolTags.map((tag) => (
                  <TableRow key={tag.id} data-testid={`tool-tag-${tag.slug}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{tag.label}</span>
                        {tag.protected && <Lock className="text-muted-foreground h-3.5 w-3.5" aria-label="protected" />}
                      </div>
                      <div className="text-muted-foreground text-xs">{tag.slug}</div>
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="flex flex-wrap gap-1">
                        {(tag.triggers ?? []).length === 0 && (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                        {(tag.triggers ?? []).map((t) => (
                          <Badge key={t} variant="outline" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={tag.enabled}
                        disabled={tag.protected || patchMut.isPending}
                        onCheckedChange={(checked) => patchMut.mutate({ id: tag.id, body: { enabled: checked } })}
                        data-testid={`switch-enabled-${tag.slug}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(tag)} data-testid={`button-edit-${tag.slug}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={tag.protected || deleteMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete tool tag "${tag.label}"?`)) deleteMut.mutate(tag.id);
                        }}
                        data-testid={`button-delete-${tag.slug}`}
                      >
                        <Trash2 className="text-destructive h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Code-defined reference */}
        {data && (
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold">Code-defined tags (read-only)</h2>
              <p className="text-muted-foreground mb-2 text-xs">
                Concept and troubleshooting tags live in code and are merged into the effective vocabulary.
              </p>
              <div className="flex flex-wrap gap-1">
                {data.conceptTags.map((t) => (
                  <Badge key={t} variant="secondary" className="font-normal">
                    {t}
                  </Badge>
                ))}
                <Badge variant="secondary" className="font-normal">
                  {data.troubleshootingTag}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tool tag</DialogTitle>
            <DialogDescription>
              The slug is auto-derived from the label if left blank. Triggers are comma-separated phrases that map a query
              to this tag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-label">Label</Label>
              <Input id="new-label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Midjourney" data-testid="input-new-label" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-slug">Slug (optional)</Label>
              <Input id="new-slug" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="midjourney" data-testid="input-new-slug" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-triggers">Triggers (comma-separated)</Label>
              <Input id="new-triggers" value={newTriggers} onChange={(e) => setNewTriggers(e.target.value)} placeholder="midjourney, mj" data-testid="input-new-triggers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => createMut.mutate()} disabled={!newLabel.trim() || createMut.isPending} data-testid="button-save-new">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.slug}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-label">Label</Label>
              <Input id="edit-label" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} data-testid="input-edit-label" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-triggers">Triggers (comma-separated)</Label>
              <Input id="edit-triggers" value={editTriggers} onChange={(e) => setEditTriggers(e.target.value)} data-testid="input-edit-triggers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editing &&
                patchMut.mutate({ id: editing.id, body: { label: editLabel, triggers: parseTriggers(editTriggers) } })
              }
              disabled={!editLabel.trim() || patchMut.isPending}
              data-testid="button-save-edit"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve dialog */}
      <Dialog open={!!reviewing} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve tool tag</DialogTitle>
            <DialogDescription>Review and adjust before adding to the live vocabulary.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="review-label">Label</Label>
              <Input id="review-label" value={reviewLabel} onChange={(e) => setReviewLabel(e.target.value)} data-testid="input-review-label" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="review-slug">Slug</Label>
              <Input id="review-slug" value={reviewSlug} onChange={(e) => setReviewSlug(e.target.value)} data-testid="input-review-slug" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="review-triggers">Triggers (comma-separated)</Label>
              <Input id="review-triggers" value={reviewTriggers} onChange={(e) => setReviewTriggers(e.target.value)} data-testid="input-review-triggers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                reviewing &&
                approveMut.mutate({
                  id: reviewing.id,
                  body: { slug: reviewSlug, label: reviewLabel, triggers: parseTriggers(reviewTriggers) },
                })
              }
              disabled={!reviewLabel.trim() || !reviewSlug.trim() || approveMut.isPending}
              data-testid="button-confirm-approve"
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
