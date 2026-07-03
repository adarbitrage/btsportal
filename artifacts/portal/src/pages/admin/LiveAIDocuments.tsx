import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Sparkles, Plus, Pencil, Trash2, Search, FileText, Send, RotateCcw,
  AlertTriangle, RefreshCw, Wand2, X,
} from "lucide-react";
import {
  fetchAiLiveDocuments,
  createAiLiveDocument,
  updateAiLiveDocument,
  deleteAiLiveDocument,
  restoreAiLiveDocument,
  sendAiLiveDocumentToReview,
  scanAiLiveSourceChanges,
  dismissAiLiveDocumentFlag,
  proposeAiLiveDocumentUpdate,
  type AiLiveDocument,
} from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "faq", label: "FAQ" },
  { value: "platform_guide", label: "Platform Guide" },
  { value: "marketing", label: "Marketing" },
  { value: "compliance", label: "Compliance" },
  { value: "advanced_strategy", label: "Advanced Strategy" },
  { value: "troubleshooting", label: "Troubleshooting" },
];

export default function LiveAIDocuments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  // Create dialog (brand-new docs go straight into the corpus).
  const [showCreate, setShowCreate] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formCategory, setFormCategory] = useState("faq");
  const [formContent, setFormContent] = useState("");

  // Send-to-review dialog.
  const [reviewDoc, setReviewDoc] = useState<AiLiveDocument | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  // Direct-edit escape-hatch dialog.
  const [editDoc, setEditDoc] = useState<AiLiveDocument | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editCategory, setEditCategory] = useState("faq");
  const [editContent, setEditContent] = useState("");
  const [editConfirmed, setEditConfirmed] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-ai-live-documents"] });

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-ai-live-documents", categoryFilter, searchQuery, showDeleted],
    queryFn: () => fetchAiLiveDocuments({ category: categoryFilter, search: searchQuery, deleted: showDeleted }),
  });

  const createMutation = useMutation({
    mutationFn: createAiLiveDocument,
    onSuccess: () => {
      invalidate();
      resetCreate();
      toast({ title: "Document created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title: string; slug: string; category: string; content: string } }) =>
      updateAiLiveDocument(id, data),
    onSuccess: () => {
      invalidate();
      setEditDoc(null);
      toast({ title: "Document edited directly", description: "This bypassed the review loop." });
    },
    onError: (err: Error) => toast({ title: "Failed to edit", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) => sendAiLiveDocumentToReview(id, note),
    onSuccess: () => {
      invalidate();
      setReviewDoc(null);
      setReviewNote("");
      toast({ title: "Sent to review", description: "A revision draft is now in the review queue." });
    },
    onError: (err: Error) => toast({ title: "Could not send to review", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAiLiveDocument,
    onSuccess: () => { invalidate(); toast({ title: "Document deleted", description: "Soft-deleted — you can restore it from the Deleted view." }); },
    onError: (err: Error) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: restoreAiLiveDocument,
    onSuccess: () => { invalidate(); toast({ title: "Document restored" }); },
    onError: (err: Error) => toast({ title: "Failed to restore", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: dismissAiLiveDocumentFlag,
    onSuccess: () => { invalidate(); toast({ title: "Flag dismissed" }); },
    onError: (err: Error) => toast({ title: "Failed to dismiss", description: err.message, variant: "destructive" }),
  });

  const proposeMutation = useMutation({
    mutationFn: proposeAiLiveDocumentUpdate,
    onSuccess: (r) => {
      invalidate();
      toast({
        title: r.draftId ? "Update proposed" : "No revision created",
        description: r.draftId ? "A revision draft is in the review queue." : "The source had no new material to synthesize.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not propose update", description: err.message, variant: "destructive" }),
  });

  const scanMutation = useMutation({
    mutationFn: scanAiLiveSourceChanges,
    onSuccess: (r) => {
      invalidate();
      toast({
        title: "Source scan complete",
        description: r.flaggedDocIds.length > 0
          ? `${r.flaggedDocIds.length} document(s) flagged as likely needing an update.`
          : `Scanned ${r.scanned} sources — no documents need updating.`,
      });
    },
    onError: (err: Error) => toast({ title: "Scan failed", description: err.message, variant: "destructive" }),
  });

  const resetCreate = () => {
    setShowCreate(false);
    setFormTitle("");
    setFormSlug("");
    setFormCategory("faq");
    setFormContent("");
  };

  const openEdit = (doc: AiLiveDocument) => {
    setEditDoc(doc);
    setEditTitle(doc.title);
    setEditSlug(doc.slug ?? "");
    setEditCategory(doc.category);
    setEditContent(doc.content);
    setEditConfirmed(false);
  };

  const openReview = (doc: AiLiveDocument) => {
    setReviewDoc(doc);
    setReviewNote("");
  };

  const handleCreate = () => {
    if (!formTitle || !formContent) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({ title: formTitle, slug: formSlug || undefined, category: formCategory, content: formContent });
  };

  const handleSearch = () => setSearchQuery(searchInput);
  const categoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              Live AI Documents
            </h1>
            <p className="text-muted-foreground mt-1">
              The AI assistant's citable corpus. Read-mostly: edit through review, restart-safe, reversible deletes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
              <RefreshCw className={`w-4 h-4 mr-1 ${scanMutation.isPending ? "animate-spin" : ""}`} />
              {scanMutation.isPending ? "Scanning…" : "Scan for source changes"}
            </Button>
            <Button onClick={() => { resetCreate(); setShowCreate(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add Document
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="Search documents…"
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleSearch}>Search</Button>
          <Button variant={showDeleted ? "default" : "outline"} onClick={() => setShowDeleted((v) => !v)}>
            <Trash2 className="w-4 h-4 mr-1" /> {showDeleted ? "Viewing Deleted" : "Deleted"}
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : !docs || docs.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium">{showDeleted ? "No deleted documents" : "No documents yet"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {showDeleted
                    ? "Deleted documents can be restored from here."
                    : "This is the AI assistant's citable corpus. Add your first document to get started."}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium max-w-xs">
                        <div className="truncate">{doc.title}</div>
                        {doc.flaggedStaleAt && !showDeleted && (
                          <div className="mt-1 flex items-center gap-1 text-amber-600 dark:text-amber-500 text-xs" title={doc.flaggedReason ?? ""}>
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">Likely needs updating</span>
                          </div>
                        )}
                        {doc.slug && <div className="text-muted-foreground text-xs truncate">{doc.slug}</div>}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{categoryLabel(doc.category)}</Badge></TableCell>
                      <TableCell className="text-right text-muted-foreground">{doc.chunkCount}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {showDeleted ? (
                            <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate(doc.id)} disabled={restoreMutation.isPending}>
                              <RotateCcw className="w-4 h-4 mr-1" /> Restore
                            </Button>
                          ) : (
                            <>
                              {doc.flaggedStaleAt && (
                                <>
                                  <Button
                                    variant="ghost" size="sm" className="p-1.5 h-auto text-amber-600 hover:text-amber-600"
                                    title="Propose an update (re-synthesize this topic into a review draft)"
                                    onClick={() => proposeMutation.mutate(doc.id)}
                                    disabled={proposeMutation.isPending}
                                  >
                                    <Wand2 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm" className="p-1.5 h-auto text-muted-foreground"
                                    title="Dismiss the 'needs updating' flag"
                                    onClick={() => dismissMutation.mutate(doc.id)}
                                    disabled={dismissMutation.isPending}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost" size="sm" className="p-1.5 h-auto text-primary hover:text-primary"
                                title="Send to review (recommended edit path)"
                                onClick={() => openReview(doc)}
                              >
                                <Send className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="p-1.5 h-auto"
                                title="Direct edit (escape hatch — bypasses review)"
                                onClick={() => openEdit(doc)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="p-1.5 h-auto text-destructive hover:text-destructive"
                                title="Delete (soft — reversible)"
                                onClick={() => { if (confirm(`Delete "${doc.title}"? It will be soft-deleted and can be restored.`)) deleteMutation.mutate(doc.id); }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) resetCreate(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-1 block">Title</Label>
                <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Document title" />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">
                Slug <span className="text-muted-foreground font-normal">(optional, stable identity)</span>
              </Label>
              <Input value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder="e.g. how-to-reset-password" />
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Content</Label>
              <Textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} placeholder="Document content…" className="min-h-[220px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetCreate}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>Create Document</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send-to-review dialog */}
      <Dialog open={!!reviewDoc} onOpenChange={(o) => { if (!o) setReviewDoc(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send to review</DialogTitle>
            <DialogDescription>
              Creates a revision draft of <span className="font-medium">{reviewDoc?.title}</span> in the review queue,
              seeded with the current content. Edit and approve it there to supersede the live version (with version history).
              The live document is not changed until approval.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-sm font-medium mb-1 block">Note for the reviewer <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="What should change and why…" className="min-h-[100px]" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDoc(null)}>Cancel</Button>
            <Button
              onClick={() => reviewDoc && reviewMutation.mutate({ id: reviewDoc.id, note: reviewNote })}
              disabled={reviewMutation.isPending}
            >
              <Send className="w-4 h-4 mr-1" /> Send to review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Direct-edit escape-hatch dialog */}
      <Dialog open={!!editDoc} onOpenChange={(o) => { if (!o) setEditDoc(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Direct edit — escape hatch</DialogTitle>
            <DialogDescription>
              This edits the live document directly, bypassing the review loop and version snapshot. Prefer
              <span className="font-medium"> Send to review</span> for normal changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-1 block">Title</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Category</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Slug <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Content</Label>
              <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="min-h-[220px]" />
            </div>
            <label className="flex items-start gap-2 text-sm rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <input type="checkbox" className="mt-0.5" checked={editConfirmed} onChange={(e) => setEditConfirmed(e.target.checked)} />
              <span>I understand this bypasses review and version history, and publishes directly to the live assistant corpus.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!editConfirmed || editMutation.isPending}
              onClick={() => {
                if (!editTitle || !editContent) { toast({ title: "Title and content are required", variant: "destructive" }); return; }
                editDoc && editMutation.mutate({ id: editDoc.id, data: { title: editTitle, slug: editSlug, category: editCategory, content: editContent } });
              }}
            >
              Save direct edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
