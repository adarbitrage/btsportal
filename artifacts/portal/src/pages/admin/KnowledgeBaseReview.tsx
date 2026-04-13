import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import {
  CheckCircle,
  XCircle,
  Edit3,
  Merge,
  Eye,
  Play,
  Loader2,
  FileText,
  Upload,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface StagingDoc {
  id: number;
  title: string;
  category: string;
  content: string;
  tags: string;
  sourceVideoTitle: string | null;
  sourceVideoId: string | null;
  status: string;
  adminNotes: string | null;
  editedContent: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  mergedIntoId: number | null;
  createdAt: string;
  source: string | null;
  phase: string | null;
  module: string | null;
  lessonId: string | null;
  lessonType: string | null;
  networkPath: string | null;
  publisherPath: string | null;
  blitzOrder: number | null;
}

interface StatusCounts {
  [key: string]: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  needs_edit: "bg-orange-100 text-orange-800",
  rejected: "bg-red-100 text-red-800",
  merged: "bg-purple-100 text-purple-800",
  pushed: "bg-blue-100 text-blue-800",
};

const CATEGORIES = [
  { value: "curriculum", label: "Curriculum" },
  { value: "strategy", label: "Strategy" },
  { value: "sop", label: "SOP" },
  { value: "faq", label: "FAQ" },
  { value: "platform_guide", label: "Platform Guide" },
];

export default function KnowledgeBaseReview() {
  const [docs, setDocs] = useState<StagingDoc[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({});
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<StagingDoc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTags, setEditTags] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [mergeIds, setMergeIds] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("page", page.toString());
      params.set("limit", "20");

      const res = await authFetch(
        `/admin/knowledgebase/staging?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDocs(data.documents);
      setStatusCounts(data.statusCounts || {});
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
    } catch {
      toast({
        title: "Error loading documents",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery, page, toast]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const runPipeline = async () => {
    setProcessing(true);
    try {
      const res = await authFetch(
        "/admin/knowledgebase/pipeline/process-transcripts",
        { method: "POST" },
      );
      const data = await res.json();
      toast({ title: data.message });
    } catch {
      toast({ title: "Failed to start pipeline", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const updateDoc = async (
    id: number,
    updates: Record<string, unknown>,
  ) => {
    try {
      const res = await authFetch(`/admin/knowledgebase/staging/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Document updated" });
      fetchDocs();
      if (selectedDoc?.id === id) {
        const updated = await res.json();
        setSelectedDoc(updated);
      }
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const bulkApprove = async () => {
    const pendingIds = docs
      .filter((d) => d.status === "pending_review")
      .map((d) => d.id);
    if (pendingIds.length === 0) return;

    try {
      const res = await authFetch("/admin/knowledgebase/staging/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pendingIds }),
      });
      const data = await res.json();
      toast({ title: `Approved ${data.approved} documents` });
      fetchDocs();
    } catch {
      toast({ title: "Bulk approve failed", variant: "destructive" });
    }
  };

  const mergeSelected = async () => {
    const ids = Array.from(mergeIds);
    if (ids.length < 2) {
      toast({ title: "Select at least 2 documents to merge", variant: "destructive" });
      return;
    }

    setMerging(true);
    try {
      const res = await authFetch("/admin/knowledgebase/staging/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Merge failed");
      const data = await res.json();
      toast({ title: `Merged ${ids.length} docs into: ${data.merged.title}` });
      setMergeIds(new Set());
      fetchDocs();
    } catch {
      toast({ title: "Merge failed", variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  const pushApproved = async () => {
    setPushing(true);
    try {
      const res = await authFetch(
        "/admin/knowledgebase/staging/push-approved",
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Push failed");
      const data = await res.json();
      toast({ title: data.message });
      fetchDocs();
    } catch {
      toast({ title: "Push failed", variant: "destructive" });
    } finally {
      setPushing(false);
    }
  };

  const openDoc = (doc: StagingDoc) => {
    setSelectedDoc(doc);
    setEditMode(false);
    setEditContent(doc.editedContent || doc.content);
    setEditTitle(doc.title);
    setEditCategory(doc.category);
    setEditTags(doc.tags);
    setAdminNotes(doc.adminNotes || "");
  };

  const saveEdit = async () => {
    if (!selectedDoc) return;
    await updateDoc(selectedDoc.id, {
      title: editTitle,
      category: editCategory,
      tags: editTags,
      editedContent: editContent,
      adminNotes: adminNotes,
      status: "approved",
    });
    setEditMode(false);
  };

  const toggleMergeSelect = (id: number) => {
    setMergeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalCount = Object.values(statusCounts).reduce(
    (s, c) => s + c,
    0,
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Knowledge Base Document Review
            </h1>
            <p className="text-gray-600 mt-1">
              Review AI-extracted training documents before publishing to the
              knowledge base
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(statusCounts.approved || 0) > 0 && (
              <Button
                onClick={pushApproved}
                disabled={pushing}
                className="bg-[#1a56db] hover:bg-[#1a56db]/90"
              >
                {pushing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Push {statusCounts.approved} to KB
              </Button>
            )}
            <Button
              onClick={runPipeline}
              disabled={processing}
              variant="outline"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Run Pipeline
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setStatusFilter("all"); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === "all"
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All ({totalCount})
          </button>
          {[
            ["pending_review", "Pending"],
            ["approved", "Approved"],
            ["needs_edit", "Needs Edit"],
            ["rejected", "Rejected"],
            ["merged", "Merged"],
            ["pushed", "Pushed"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                statusFilter === key
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {label} ({statusCounts[key] || 0})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-10"
            />
          </div>
          {mergeIds.size >= 2 && (
            <Button
              onClick={mergeSelected}
              disabled={merging}
              variant="outline"
              className="border-purple-300 text-purple-700"
            >
              {merging ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Merge className="w-4 h-4 mr-2" />
              )}
              Merge {mergeIds.size} Selected
            </Button>
          )}
          {statusFilter === "pending_review" && docs.length > 0 && (
            <Button onClick={bulkApprove} variant="outline" className="border-green-300 text-green-700">
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve All on Page
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#1a56db]" />
          </div>
        ) : docs.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No documents found</p>
              <p className="text-gray-400 mt-1">
                {totalCount === 0
                  ? "Run the pipeline to process video transcripts"
                  : "Try a different filter or search"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <Card
                key={doc.id}
                className={`transition-colors hover:border-[#1a56db]/30 cursor-pointer ${
                  mergeIds.has(doc.id) ? "ring-2 ring-purple-400 border-purple-300" : ""
                }`}
              >
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={mergeIds.has(doc.id)}
                        onChange={() => toggleMergeSelect(doc.id)}
                        className="mt-1.5 rounded border-gray-300"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div
                        className="flex-1 min-w-0"
                        onClick={() => openDoc(doc)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">
                            {doc.title}
                          </h3>
                          <Badge
                            variant="outline"
                            className={STATUS_COLORS[doc.status] || ""}
                          >
                            {doc.status.replace("_", " ")}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {doc.category}
                          </Badge>
                        </div>
                        {doc.source === "blitz" && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                              Blitz
                            </Badge>
                            {doc.phase && (
                              <Badge variant="outline" className={`text-[10px] ${
                                doc.phase === "build" ? "bg-amber-50 text-amber-700 border-amber-200" :
                                doc.phase === "test" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                                "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}>
                                {doc.phase.toUpperCase()}
                              </Badge>
                            )}
                            {doc.lessonId && (
                              <span className="text-[10px] text-gray-500">
                                Lesson {doc.lessonId}
                              </span>
                            )}
                            {doc.module && (
                              <span className="text-[10px] text-gray-400">
                                · {doc.module}
                              </span>
                            )}
                          </div>
                        )}
                        {doc.source === "coaching_call" && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                              Coaching Call
                            </Badge>
                            {doc.module && (
                              <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                                Coach: {doc.module}
                              </Badge>
                            )}
                          </div>
                        )}
                        {doc.sourceVideoTitle && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            Source: {doc.sourceVideoTitle}
                          </p>
                        )}
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {(doc.editedContent || doc.content)
                            .replace(/^#.*\n/gm, "")
                            .replace(/\*\*.*?\*\*/g, "")
                            .trim()
                            .substring(0, 200)}
                        </p>
                        {doc.tags && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {doc.tags.split(",").slice(0, 5).map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                              >
                                {tag.trim()}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {doc.status === "pending_review" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateDoc(doc.id, { status: "approved" });
                            }}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateDoc(doc.id, { status: "rejected" });
                            }}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDoc(doc);
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-gray-500">
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of{" "}
                {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={!!selectedDoc}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDoc(null);
            setEditMode(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selectedDoc && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg">
                    {editMode ? "Edit Document" : selectedDoc.title}
                  </DialogTitle>
                  <Badge
                    variant="outline"
                    className={STATUS_COLORS[selectedDoc.status] || ""}
                  >
                    {selectedDoc.status.replace("_", " ")}
                  </Badge>
                </div>
                {selectedDoc.source === "blitz" && (
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                      Blitz
                    </Badge>
                    {selectedDoc.phase && (
                      <Badge variant="outline" className={`text-xs ${
                        selectedDoc.phase === "build" ? "bg-amber-50 text-amber-700 border-amber-200" :
                        selectedDoc.phase === "test" ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                        "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}>
                        {selectedDoc.phase.toUpperCase()}
                      </Badge>
                    )}
                    {selectedDoc.lessonId && (
                      <span className="text-xs text-gray-500">Lesson {selectedDoc.lessonId}</span>
                    )}
                    {selectedDoc.module && (
                      <span className="text-xs text-gray-400">· {selectedDoc.module}</span>
                    )}
                    {selectedDoc.networkPath && selectedDoc.networkPath !== "universal" && (
                      <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600">
                        {selectedDoc.networkPath.replace(/-/g, " ")}
                      </Badge>
                    )}
                    {selectedDoc.publisherPath && selectedDoc.publisherPath !== "all" && (
                      <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600">
                        {selectedDoc.publisherPath.replace(/-/g, " ")}
                      </Badge>
                    )}
                  </div>
                )}
                {selectedDoc.sourceVideoTitle && (
                  <p className="text-xs text-gray-400">
                    Source: {selectedDoc.sourceVideoTitle}
                  </p>
                )}
              </DialogHeader>

              {editMode ? (
                <div className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Title
                    </label>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        Category
                      </label>
                      <Select
                        value={editCategory}
                        onValueChange={setEditCategory}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700">
                        Tags
                      </label>
                      <Input
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        placeholder="tag1, tag2, tag3"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Content (Markdown)
                    </label>
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={20}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">
                      Admin Notes
                    </label>
                    <Textarea
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      rows={3}
                      placeholder="Notes about edits made..."
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex gap-2 mb-4">
                    <Badge variant="secondary">{selectedDoc.category}</Badge>
                    {selectedDoc.tags &&
                      selectedDoc.tags.split(",").map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag.trim()}
                        </Badge>
                      ))}
                  </div>
                  <div className="prose prose-sm max-w-none bg-gray-50 p-4 rounded-lg border">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                      {selectedDoc.editedContent || selectedDoc.content}
                    </pre>
                  </div>
                  {selectedDoc.adminNotes && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm font-medium text-yellow-800">
                        Admin Notes
                      </p>
                      <p className="text-sm text-yellow-700 mt-1">
                        {selectedDoc.adminNotes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="mt-6">
                {editMode ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setEditMode(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={saveEdit}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Save & Approve
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setEditMode(true)}
                    >
                      <Edit3 className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    {selectedDoc.status === "pending_review" && (
                      <>
                        <Button
                          onClick={() => {
                            updateDoc(selectedDoc.id, { status: "approved" });
                            setSelectedDoc(null);
                          }}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button
                          onClick={() => {
                            updateDoc(selectedDoc.id, { status: "rejected" });
                            setSelectedDoc(null);
                          }}
                          variant="destructive"
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      </>
                    )}
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
