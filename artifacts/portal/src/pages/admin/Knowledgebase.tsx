import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Plus, Pencil, Trash2, Search, X, FileText } from "lucide-react";
import { fetchKnowledgebaseDocs, createKnowledgebaseDoc, updateKnowledgebaseDoc, deleteKnowledgebaseDoc } from "@/lib/admin-api";
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

export default function Knowledgebase() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("faq");
  const [formContent, setFormContent] = useState("");

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-knowledgebase", categoryFilter, searchQuery],
    queryFn: () => fetchKnowledgebaseDocs({ category: categoryFilter, search: searchQuery }),
  });

  const createMutation = useMutation({
    mutationFn: createKnowledgebaseDoc,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-knowledgebase"] });
      resetForm();
      toast({ title: "Document created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateKnowledgebaseDoc(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-knowledgebase"] });
      resetForm();
      toast({ title: "Document updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgebaseDoc,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-knowledgebase"] });
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
    setFormCategory("faq");
    setFormContent("");
  };

  const startEdit = (doc: any) => {
    setEditingDoc(doc);
    setFormTitle(doc.title);
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
      updateMutation.mutate({ id: editingDoc.id, data: { title: formTitle, category: formCategory, content: formContent } });
    } else {
      createMutation.mutate({ title: formTitle, category: formCategory, content: formContent });
    }
  };

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const categoryLabel = (cat: string) => CATEGORIES.find(c => c.value === cat)?.label || cat;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Knowledgebase Management</h1>
            <p className="text-muted-foreground mt-1">Manage RAG knowledge documents for the AI chat assistant.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => window.open(`${import.meta.env.BASE_URL}docs/kb-weekly-maintenance-sop.pdf`, "_blank", "noopener,noreferrer")}
            >
              <FileText className="w-4 h-4 mr-1" /> Maintenance SOP
            </Button>
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add Document
            </Button>
          </div>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingDoc ? "Edit Document" : "New Document"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Title</label>
                  <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Document title" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Category</label>
                  <Select value={formCategory} onValueChange={setFormCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Content (Markdown or plain text)</label>
                <Textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Enter document content..."
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Estimated chunks: {Math.ceil(formContent.length / 500)} (auto-chunked on save)
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingDoc ? "Update Document" : "Create Document"}
                </Button>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search knowledgebase..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button onClick={handleSearch} size="sm">
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              Documents
              {docs && <span className="text-sm font-normal text-muted-foreground ml-2">({docs.length})</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
            ) : !docs?.length ? (
              <div className="text-center py-8 text-muted-foreground">No documents found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Chunks</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc: any) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium max-w-[250px] truncate">{doc.title}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{categoryLabel(doc.category)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{doc.chunkCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(doc.updatedAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(doc)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => {
                              if (confirm("Delete this document?")) {
                                deleteMutation.mutate(doc.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
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
