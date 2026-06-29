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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sparkles, Plus, Pencil, Trash2, Search, FileText } from "lucide-react";
import {
  fetchAiLiveDocuments,
  createAiLiveDocument,
  updateAiLiveDocument,
  deleteAiLiveDocument,
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
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<AiLiveDocument | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formCategory, setFormCategory] = useState("faq");
  const [formContent, setFormContent] = useState("");

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-ai-live-documents", categoryFilter, searchQuery],
    queryFn: () => fetchAiLiveDocuments({ category: categoryFilter, search: searchQuery }),
  });

  const createMutation = useMutation({
    mutationFn: createAiLiveDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-live-documents"] });
      resetForm();
      toast({ title: "Document created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title: string; slug: string; category: string; content: string } }) =>
      updateAiLiveDocument(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-live-documents"] });
      resetForm();
      toast({ title: "Document updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAiLiveDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-live-documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingDoc(null);
    setFormTitle("");
    setFormSlug("");
    setFormCategory("faq");
    setFormContent("");
  };

  const startEdit = (doc: AiLiveDocument) => {
    setEditingDoc(doc);
    setFormTitle(doc.title);
    setFormSlug(doc.slug ?? "");
    setFormCategory(doc.category);
    setFormContent(doc.content);
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formTitle || !formContent) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }

    if (editingDoc) {
      updateMutation.mutate({
        id: editingDoc.id,
        data: { title: formTitle, slug: formSlug, category: formCategory, content: formContent },
      });
    } else {
      createMutation.mutate({ title: formTitle, slug: formSlug || undefined, category: formCategory, content: formContent });
    }
  };

  const handleSearch = () => setSearchQuery(searchInput);

  const categoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-primary" />
              Live AI Documents
            </h1>
            <p className="text-muted-foreground mt-1">
              The clean, dedicated home for the AI assistant's knowledge documents.
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Document
          </Button>
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
        </div>

        {showForm && (
          <Dialog open={showForm} onOpenChange={(o) => { if (!o) resetForm(); }}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingDoc ? "Edit Document" : "New Document"}</DialogTitle>
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
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
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
                  <Textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="Document content…"
                    className="min-h-[220px]"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingDoc ? "Save Changes" : "Create Document"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : !docs || docs.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium">No documents yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This is the clean AI Knowledgebase corpus. Add your first document to get started.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium max-w-xs truncate">{doc.title}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{doc.slug || "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{categoryLabel(doc.category)}</Badge></TableCell>
                      <TableCell className="text-right text-muted-foreground">{doc.chunkCount}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="p-1.5 h-auto" onClick={() => startEdit(doc)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-1.5 h-auto text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Delete "${doc.title}"?`)) deleteMutation.mutate(doc.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
    </AppLayout>
  );
}
