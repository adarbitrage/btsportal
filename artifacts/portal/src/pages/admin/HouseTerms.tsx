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
import { SpellCheck, Plus, Trash2, Sparkles, Pencil, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api/admin/knowledgebase/house-terms`;

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

interface Alias {
  id: number;
  misspelling: string;
  canonical: string;
  enabled: boolean;
  source: string;
  note: string | null;
}

interface BaselineEntry {
  misspelling: string;
  canonical: string;
}

interface AliasesResponse {
  aliases: Alias[];
  baseline: BaselineEntry[];
}

interface Correction {
  from: string;
  to: string;
  via: "alias" | "near-miss";
  count: number;
}

interface Candidate {
  token: string;
  suggestedCanonical: string;
  distance: number;
  count: number;
  exampleTitle: string;
  exampleDocId: number;
}

interface ReviewResponse {
  scannedDocs: number;
  corrections: Correction[];
  candidates: Candidate[];
}

export default function HouseTerms() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AliasesResponse>({
    queryKey: ["admin", "house-terms"],
    queryFn: () => api<AliasesResponse>(""),
  });
  const { data: review, isLoading: reviewLoading } = useQuery<ReviewResponse>({
    queryKey: ["admin", "house-terms", "review"],
    queryFn: () => api<ReviewResponse>("/review"),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newMisspelling, setNewMisspelling] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [newNote, setNewNote] = useState("");

  const [editing, setEditing] = useState<Alias | null>(null);
  const [editCanonical, setEditCanonical] = useState("");
  const [editNote, setEditNote] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "house-terms"] });
  };
  const onError = (err: unknown) =>
    toast({ title: "Error", description: err instanceof Error ? err.message : "Request failed", variant: "destructive" });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Alias added" });
      setCreateOpen(false);
      setNewMisspelling("");
      setNewCanonical("");
      setNewNote("");
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
      toast({ title: "Alias deleted" });
      invalidate();
    },
    onError,
  });

  const openEdit = (a: Alias) => {
    setEditing(a);
    setEditCanonical(a.canonical);
    setEditNote(a.note ?? "");
  };

  const addFromCandidate = (c: Candidate) => {
    setNewMisspelling(c.token.toLowerCase());
    setNewCanonical(c.suggestedCanonical);
    setNewNote(`Spotted in "${c.exampleTitle}"`);
    setCreateOpen(true);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <SpellCheck className="h-6 w-6" /> House-Term Corrections
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              The Transcript Cleaner auto-corrects near-miss spellings of BTS's proprietary tools. Add a confirmed
              misspelling here to correct it forever — no deploy. Built-in corrections live in code and are always applied.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-house-term">
            <Plus className="mr-1 h-4 w-4" /> Add alias
          </Button>
        </div>

        {/* Slipped-through review candidates */}
        {(review?.candidates?.length ?? 0) > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-amber-500" /> Slipped through recent transcripts ({review?.candidates.length})
              </h2>
              <p className="text-muted-foreground mb-3 text-sm">
                Tokens close to a house term that the auto-correct left alone. Confirm any real misspelling to add it.
              </p>
              <div className="space-y-2">
                {review?.candidates.map((c) => (
                  <div
                    key={c.token.toLowerCase()}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                    data-testid={`candidate-${c.token.toLowerCase()}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">{c.token}</span>
                        <ArrowRight className="text-muted-foreground h-4 w-4" />
                        <span className="font-mono">{c.suggestedCanonical}</span>
                        <Badge variant="secondary">seen {c.count}×</Badge>
                      </div>
                      <p className="text-muted-foreground truncate text-xs">from: {c.exampleTitle}</p>
                    </div>
                    <Button size="sm" onClick={() => addFromCandidate(c)} data-testid={`button-add-candidate-${c.token.toLowerCase()}`}>
                      <Plus className="mr-1 h-4 w-4" /> Add
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alias overrides table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correction</TableHead>
                  <TableHead>Note</TableHead>
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
                {!isLoading && (data?.aliases?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                      No custom aliases yet. Built-in corrections still apply.
                    </TableCell>
                  </TableRow>
                )}
                {data?.aliases.map((a) => (
                  <TableRow key={a.id} data-testid={`house-term-${a.misspelling}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-mono">
                        <span>{a.misspelling}</span>
                        <ArrowRight className="text-muted-foreground h-3.5 w-3.5" />
                        <span className="font-medium">{a.canonical}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{a.note ?? "—"}</TableCell>
                    <TableCell>
                      <Switch
                        checked={a.enabled}
                        disabled={patchMut.isPending}
                        onCheckedChange={(checked) => patchMut.mutate({ id: a.id, body: { enabled: checked } })}
                        data-testid={`switch-enabled-${a.misspelling}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)} data-testid={`button-edit-${a.misspelling}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete alias "${a.misspelling}" → "${a.canonical}"?`)) deleteMut.mutate(a.id);
                        }}
                        data-testid={`button-delete-${a.misspelling}`}
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

        {/* Corrections applied recently */}
        {(review?.corrections?.length ?? 0) > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold">
                Corrections applied to recent transcripts{review ? ` (${review.scannedDocs} scanned)` : ""}
              </h2>
              <p className="text-muted-foreground mb-2 text-xs">
                What the auto-correct rewrote across the most recently cleaned documents.
              </p>
              <div className="flex flex-wrap gap-1">
                {review?.corrections.map((c) => (
                  <Badge key={`${c.via}:${c.from}->${c.to}`} variant="outline" className="font-mono font-normal">
                    {c.from} → {c.to} ({c.count})
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Code-defined baseline reference */}
        {data && (
          <Card>
            <CardContent className="p-4">
              <h2 className="text-sm font-semibold">Built-in corrections (read-only)</h2>
              <p className="text-muted-foreground mb-2 text-xs">
                Shipped in code and always applied, plus a conservative fuzzy pass for close spellings.
              </p>
              <div className="flex flex-wrap gap-1">
                {data.baseline.map((b) => (
                  <Badge key={b.misspelling} variant="secondary" className="font-mono font-normal">
                    {b.misspelling} → {b.canonical}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {reviewLoading && <p className="text-muted-foreground text-sm">Scanning recent transcripts…</p>}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add correction</DialogTitle>
            <DialogDescription>
              Map a misspelling to its canonical spelling. Matched as a whole word/phrase, case-insensitively. Avoid ordinary
              English words as the misspelling — they would clobber normal prose.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-misspelling">Misspelling</Label>
              <Input
                id="new-misspelling"
                value={newMisspelling}
                onChange={(e) => setNewMisspelling(e.target.value)}
                placeholder="flexii"
                data-testid="input-new-misspelling"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-canonical">Canonical</Label>
              <Input
                id="new-canonical"
                value={newCanonical}
                onChange={(e) => setNewCanonical(e.target.value)}
                placeholder="Flexy"
                data-testid="input-new-canonical"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-note">Note (optional)</Label>
              <Input id="new-note" value={newNote} onChange={(e) => setNewNote(e.target.value)} data-testid="input-new-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMut.mutate({ misspelling: newMisspelling, canonical: newCanonical, note: newNote || undefined })
              }
              disabled={!newMisspelling.trim() || !newCanonical.trim() || createMut.isPending}
              data-testid="button-save-new"
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.misspelling}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-canonical">Canonical</Label>
              <Input id="edit-canonical" value={editCanonical} onChange={(e) => setEditCanonical(e.target.value)} data-testid="input-edit-canonical" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-note">Note (optional)</Label>
              <Input id="edit-note" value={editNote} onChange={(e) => setEditNote(e.target.value)} data-testid="input-edit-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                editing && patchMut.mutate({ id: editing.id, body: { canonical: editCanonical, note: editNote } })
              }
              disabled={!editCanonical.trim() || patchMut.isPending}
              data-testid="button-save-edit"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
