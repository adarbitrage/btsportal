import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Search,
  FileText,
  Lock,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Film,
  Mic,
  File,
} from "lucide-react";
import {
  fetchKnowledgebaseDocs,
  createKnowledgebaseDocWithReview,
  updateKnowledgebaseDoc,
  deleteKnowledgebaseDoc,
  requestKbUploadUrl,
  createKbStagingFromUpload,
  getKbStagingDoc,
  type KbManualReviewResult,
} from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const CATEGORIES = [
  { value: "faq", label: "FAQ" },
  { value: "platform_guide", label: "Platform Guide" },
  { value: "marketing", label: "Marketing" },
  { value: "compliance", label: "Compliance" },
  { value: "advanced_strategy", label: "Advanced Strategy" },
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "sop", label: "SOP (Internal)" },
];

type FileUploadStatus = "pending" | "uploading" | "processing" | "done" | "error";

interface UploadResult {
  stagingDocId: number;
  title: string;
  fileType: string;
}

interface FileUploadEntry {
  file: File;
  title: string;
  status: FileUploadStatus;
  stage?: string;
  result?: UploadResult;
  error?: string;
}

function fileTypeIcon(file: File | null) {
  if (!file) return <File className="w-6 h-6 text-muted-foreground" />;
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/.test(name))
    return <Film className="w-6 h-6 text-blue-500" />;
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name))
    return <Mic className="w-6 h-6 text-purple-500" />;
  if (mime === "application/pdf" || name.endsWith(".pdf"))
    return <FileText className="w-6 h-6 text-red-500" />;
  if (/docx?$/.test(name))
    return <FileText className="w-6 h-6 text-blue-700" />;
  return <FileText className="w-6 h-6 text-muted-foreground" />;
}

function fileTypeLabel(file: File | null): string {
  if (!file) return "";
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/.test(name)) return "Video — will be transcribed";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(name)) return "Audio — will be transcribed";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "PDF — text will be extracted";
  if (/\.docx?$/.test(name)) return "Word document — text will be extracted";
  if (mime.startsWith("text/") || /\.(txt|md|markdown)$/.test(name)) return "Text file — content imported directly";
  return "Other file — stored as reference (no text extraction)";
}

function isAudioVideoFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    /\.(mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|aac|flac)$/.test(name)
  );
}

function autoTitle(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
}

function FileStatusIcon({ status }: { status: FileUploadStatus }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
  if (status === "error") return <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
  if (status === "uploading" || status === "processing")
    return <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" />;
  return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />;
}

function KbUploadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<FileUploadEntry[]>([]);
  const [category, setCategory] = useState("faq");
  const [audience, setAudience] = useState<"member" | "admin">("member");
  const [isRunning, setIsRunning] = useState(false);
  const [allDone, setAllDone] = useState(false);

  const reset = () => {
    setEntries([]);
    setCategory("faq");
    setAudience("member");
    setIsRunning(false);
    setAllDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setEntries((prev) => {
      const existingNames = new Set(prev.map((en) => en.file.name));
      const newEntries: FileUploadEntry[] = files
        .filter((f) => !existingNames.has(f.name))
        .map((f) => ({ file: f, title: autoTitle(f), status: "pending" }));
      return [...prev, ...newEntries];
    });
    // Reset so same file can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeEntry = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateEntry = (idx: number, patch: Partial<FileUploadEntry>) => {
    setEntries((prev) => prev.map((en, i) => (i === idx ? { ...en, ...patch } : en)));
  };

  const uploadSingleFile = async (entry: FileUploadEntry, idx: number): Promise<void> => {
    const { file } = entry;
    try {
      updateEntry(idx, { status: "uploading" });

      const { uploadURL, objectPath } = await requestKbUploadUrl({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });

      const putResp = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putResp.ok) throw new Error(`Storage upload failed (${putResp.status})`);

      updateEntry(idx, { status: "processing", stage: "Starting…" });

      const created = await createKbStagingFromUpload({
        objectPath,
        title: entry.title.trim() || autoTitle(file),
        category,
        audience,
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
      });

      updateEntry(idx, {
        status: "processing",
        stage: created.processingStage || "Processing…",
      });

      // Poll the staging doc until the backend finishes processing.
      // Generous cap: 150 polls × 2s = 5 minutes (transcription can take a while).
      const MAX_POLLS = 150;
      const POLL_INTERVAL_MS = 2000;
      let finalTitle = created.title;
      let finished = false;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const doc = await getKbStagingDoc(created.stagingDocId);

        if (doc.status === "processing") {
          updateEntry(idx, { stage: doc.processingStage || "Processing…" });
          continue;
        }

        if (doc.status === "error") {
          throw new Error(doc.processingError || "Processing failed");
        }

        // Any non-processing, non-error status means it finished and landed
        // in the review queue (pending_review / needs_review / approved / etc.)
        finalTitle = doc.title || finalTitle;
        finished = true;
        break;
      }

      // Never report success while the doc is still processing — exhausting the
      // poll budget is a timeout, not completion.
      if (!finished) {
        throw new Error(
          "Still processing after 5 minutes — check the review queue shortly.",
        );
      }

      updateEntry(idx, {
        status: "done",
        stage: undefined,
        result: {
          stagingDocId: created.stagingDocId,
          title: finalTitle,
          fileType: created.fileType,
        },
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Upload failed";
      updateEntry(idx, { status: "error", stage: undefined, error });
    }
  };

  const handleUpload = async () => {
    if (!entries.length) {
      toast({ title: "Please select at least one file", variant: "destructive" });
      return;
    }
    setIsRunning(true);
    setAllDone(false);

    // Upload files sequentially to avoid hammering the API
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].status === "pending") {
        await uploadSingleFile(entries[i], i);
      }
    }

    setIsRunning(false);
    setAllDone(true);
  };

  const doneCount = entries.filter((e) => e.status === "done").length;
  const errorCount = entries.filter((e) => e.status === "error").length;
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const hasAudioVideo = entries.some((e) => isAudioVideoFile(e.file));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload to Knowledge Base
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Drop zone / file picker */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Files</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => !isRunning && fileInputRef.current?.click()}
            >
              <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isRunning ? "Upload in progress…" : "Click to add one or more files"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Documents (.txt, .md, .pdf, .docx), Audio, Video, or any other file
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isRunning}
            />
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {entries.map((entry, idx) => (
                <div
                  key={entry.file.name + idx}
                  className="flex items-start gap-3 p-2.5 border rounded-lg bg-secondary/20"
                >
                  {fileTypeIcon(entry.file)}
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Editable title shown while pending */}
                    {entry.status === "pending" && !isRunning ? (
                      <Input
                        value={entry.title}
                        onChange={(e) => updateEntry(idx, { title: e.target.value })}
                        placeholder="Document title"
                        className="h-7 text-sm py-0 px-2"
                      />
                    ) : (
                      <p className="text-sm font-medium truncate">{entry.file.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{fileTypeLabel(entry.file)}</p>
                    {entry.status === "error" && (
                      <p className="text-xs text-red-500 break-all">{entry.error}</p>
                    )}
                    {entry.status === "done" && entry.result && (
                      <p className="text-xs text-green-600">
                        Staged as "{entry.result.title}"
                      </p>
                    )}
                    {entry.status === "processing" && (
                      <p className="text-xs text-primary">
                        {entry.stage || "Processing…"}
                      </p>
                    )}
                    {entry.status === "uploading" && (
                      <p className="text-xs text-muted-foreground">Uploading…</p>
                    )}
                  </div>
                  <FileStatusIcon status={entry.status} />
                  {entry.status === "pending" && !isRunning && (
                    <Button variant="ghost" size="sm" className="p-1 h-auto" onClick={() => removeEntry(idx)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Category + Audience row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium mb-1 block">Category</Label>
              <Select value={category} onValueChange={setCategory} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1 block">Visibility</Label>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as "member" | "admin")}
                disabled={isRunning}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Members</SelectItem>
                  <SelectItem value="admin">Admin only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasAudioVideo && !isRunning && !allDone && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
              Audio/video files are transcribed using Whisper AI. This may take 1–3 minutes per file.
            </p>
          )}

          {/* Summary after all done */}
          {allDone && (
            <div className={`rounded-lg p-3 text-sm ${errorCount > 0 ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
              {doneCount > 0 && (
                <p className="text-green-700 font-medium">
                  {doneCount} file{doneCount !== 1 ? "s" : ""} staged for review
                </p>
              )}
              {errorCount > 0 && (
                <p className="text-red-600 mt-0.5">
                  {errorCount} file{errorCount !== 1 ? "s" : ""} failed — see details above
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {allDone && doneCount > 0 ? (
            <>
              <Button variant="outline" onClick={reset}>Upload More</Button>
              <Button asChild>
                <Link to="/admin/knowledgebase/review">Review Staged Documents</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={isRunning}>
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={pendingCount === 0 || isRunning}
              >
                {isRunning ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Uploading…</>
                ) : (
                  <><Upload className="w-4 h-4 mr-1" />Upload {entries.length > 0 ? `${pendingCount} File${pendingCount !== 1 ? "s" : ""}` : ""}</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Knowledgebase() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("faq");
  const [formContent, setFormContent] = useState("");
  const [formAudience, setFormAudience] = useState<"member" | "admin">("member");

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-knowledgebase", categoryFilter, searchQuery],
    queryFn: () => fetchKnowledgebaseDocs({ category: categoryFilter, search: searchQuery }),
  });

  const createMutation = useMutation({
    mutationFn: createKnowledgebaseDocWithReview,
    onSuccess: (result: KbManualReviewResult) => {
      queryClient.invalidateQueries({ queryKey: ["admin-knowledgebase"] });
      resetForm();
      if (result.action === "auto_approved") {
        toast({
          title: "AI approved — published live",
          description: result.summary
            ? `Added to the knowledge base. ${result.summary}`
            : "The document was reviewed by AI and added to the live knowledge base.",
        });
      } else {
        toast({
          title: "Sent to the review queue",
          description:
            result.action === "auto_rejected"
              ? "AI flagged this document. Approve or discard it in Review Staged Documents."
              : "AI couldn't auto-approve this document. Approve it in Review Staged Documents.",
        });
      }
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
    setFormAudience("member");
  };

  const startEdit = (doc: any) => {
    setEditingDoc(doc);
    setFormTitle(doc.title);
    setFormCategory(doc.category);
    setFormContent(doc.content);
    setFormAudience(doc.audience === "admin" ? "admin" : "member");
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!formTitle || !formContent) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }

    if (editingDoc) {
      updateMutation.mutate({ id: editingDoc.id, data: { title: formTitle, category: formCategory, content: formContent, audience: formAudience } });
    } else {
      createMutation.mutate({ title: formTitle, category: formCategory, content: formContent, audience: formAudience });
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
            <Button variant="outline" onClick={() => setShowUploadDialog(true)}>
              <Upload className="w-4 h-4 mr-1" /> Upload
            </Button>
            <Button onClick={() => { resetForm(); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Add Document
            </Button>
          </div>
        </div>

        <KbUploadDialog open={showUploadDialog} onClose={() => setShowUploadDialog(false)} />

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
                <div>
                  <label className="text-sm font-medium mb-1 block">Visibility</label>
                  <Select value={formAudience} onValueChange={(v) => setFormAudience(v as "member" | "admin")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Members (AI Assistant)</SelectItem>
                      <SelectItem value="admin">Admin only / Internal</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Admin-only docs are never returned to members by the AI Assistant or voice search.
                  </p>
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
              {!editingDoc && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  New documents are reviewed by AI first — auto-published if approved, otherwise sent to the review queue for approval.
                </p>
              )}
              <div className="flex gap-2">
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending && !editingDoc ? (
                    <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Reviewing…</>
                  ) : editingDoc ? (
                    "Update Document"
                  ) : (
                    "Create Document"
                  )}
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
                    <TableHead>Visibility</TableHead>
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
                      <TableCell>
                        {doc.audience === "admin" ? (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <Lock className="w-3 h-3" /> Admin only
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Members</Badge>
                        )}
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
