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
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Library,
  Plus,
  Search,
  FileText,
  Users,
  User,
  Headset,
  Video,
  Film,
  BookOpen,
  Files,
  type LucideIcon,
} from "lucide-react";
import {
  fetchAiSourceDocuments,
  createAiSourceDocument,
  type AiSourceDocument,
} from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// Mirrors SOURCE_FOLDERS in the api-server kb-taxonomy registry (single source
// of truth for the folder vocabulary). Five transcript/video types + two
// document types.
interface SourceFolder {
  slug: string;
  label: string;
  kind: "transcript" | "video" | "document";
  defaultAuthorityRole: string;
  icon: LucideIcon;
  description: string;
}

const SOURCE_FOLDERS: SourceFolder[] = [
  { slug: "group_coaching", label: "Group Coaching", kind: "transcript", defaultAuthorityRole: "strategic_coach", icon: Users, description: "Group coaching call transcripts." },
  { slug: "private_coaching", label: "Private Coaching", kind: "transcript", defaultAuthorityRole: "strategic_coach", icon: User, description: "Private 1-on-1 coaching call transcripts." },
  { slug: "one_on_one_va", label: "1-on-1 VA", kind: "transcript", defaultAuthorityRole: "va", icon: Headset, description: "Per-coach VA 1:1 session transcripts." },
  { slug: "blitz_video", label: "Blitz Video", kind: "video", defaultAuthorityRole: "curriculum", icon: Video, description: "Blitz curriculum video transcripts." },
  { slug: "other_video", label: "Other Video", kind: "video", defaultAuthorityRole: "curriculum", icon: Film, description: "Other training video transcripts." },
  { slug: "reference_docs", label: "Reference Docs", kind: "document", defaultAuthorityRole: "internal", icon: BookOpen, description: "Reference / supporting documents." },
  { slug: "other_docs", label: "Other Docs", kind: "document", defaultAuthorityRole: "internal", icon: Files, description: "Uncategorised supporting documents." },
];

const AUTHORITY_ROLES = [
  { value: "strategic_coach", label: "Strategic Coach" },
  { value: "va", label: "VA" },
  { value: "curriculum", label: "Curriculum" },
  { value: "internal", label: "Internal" },
];

const folderBySlug = (slug: string) => SOURCE_FOLDERS.find((f) => f.slug === slug);
const folderLabel = (slug: string) => folderBySlug(slug)?.label ?? slug;
const roleLabel = (role: string) => AUTHORITY_ROLES.find((r) => r.value === role)?.label ?? role;

const kindBadgeVariant = (kind: SourceFolder["kind"]): "default" | "secondary" | "outline" =>
  kind === "transcript" ? "default" : kind === "video" ? "secondary" : "outline";

export default function AiSourceKnowledge() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeFolder, setActiveFolder] = useState<string>(SOURCE_FOLDERS[0].slug);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewDoc, setViewDoc] = useState<AiSourceDocument | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formFolder, setFormFolder] = useState<string>(SOURCE_FOLDERS[0].slug);
  const [formRole, setFormRole] = useState<string>(SOURCE_FOLDERS[0].defaultAuthorityRole);
  const [formSourceName, setFormSourceName] = useState("");
  const [formProvenance, setFormProvenance] = useState("");

  // Searching looks across all folders; browsing scopes to the active folder.
  const isSearching = searchQuery.trim().length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ai-source-documents", isSearching ? "" : activeFolder, searchQuery],
    queryFn: () =>
      fetchAiSourceDocuments(
        isSearching ? { search: searchQuery } : { folder: activeFolder },
      ),
  });

  const counts = data?.counts ?? {};
  const docs = data?.documents ?? [];

  const createMutation = useMutation({
    mutationFn: createAiSourceDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ai-source-documents"] });
      resetForm();
      toast({ title: "Source document added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setFormTitle("");
    setFormContent("");
    setFormFolder(activeFolder);
    setFormRole(folderBySlug(activeFolder)?.defaultAuthorityRole ?? "internal");
    setFormSourceName("");
    setFormProvenance("");
  };

  const openForm = () => {
    setFormFolder(activeFolder);
    setFormRole(folderBySlug(activeFolder)?.defaultAuthorityRole ?? "internal");
    setShowForm(true);
  };

  const handleFolderChange = (slug: string) => {
    setFormFolder(slug);
    setFormRole(folderBySlug(slug)?.defaultAuthorityRole ?? "internal");
  };

  const handleSubmit = () => {
    if (!formTitle.trim() || !formContent.trim()) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      title: formTitle,
      content: formContent,
      sourceType: formFolder,
      authorityRole: formRole,
      sourceName: formSourceName || undefined,
      provenanceNote: formProvenance || undefined,
    });
  };

  const handleSearch = () => setSearchQuery(searchInput);
  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const activeFolderMeta = folderBySlug(activeFolder);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Library className="w-6 h-6 text-primary" />
              AI Source Knowledge
            </h1>
            <p className="text-muted-foreground mt-1">
              The type-organised home for the AI's raw source material — mining input, never citable.
              Cleaned transcripts and reference docs land here, organised by source type.
            </p>
          </div>
          <Button onClick={openForm}>
            <Plus className="w-4 h-4 mr-1" /> Add Source
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              placeholder="Search the whole library…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={handleSearch}>Search</Button>
          {isSearching && (
            <Button variant="ghost" onClick={clearSearch}>Clear</Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
          {/* Folder navigation */}
          <Card className="h-fit">
            <CardContent className="p-2">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Folders
              </div>
              <nav className="space-y-0.5">
                {SOURCE_FOLDERS.map((f) => {
                  const Icon = f.icon;
                  const active = !isSearching && f.slug === activeFolder;
                  return (
                    <button
                      key={f.slug}
                      onClick={() => { clearSearch(); setActiveFolder(f.slug); }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm transition-colors ${
                        active ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{f.label}</span>
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {counts[f.slug] ?? 0}
                      </Badge>
                    </button>
                  );
                })}
              </nav>
            </CardContent>
          </Card>

          {/* Document list */}
          <div className="space-y-3">
            {!isSearching && activeFolderMeta && (
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">{activeFolderMeta.label}</h2>
                <Badge variant={kindBadgeVariant(activeFolderMeta.kind)} className="capitalize">
                  {activeFolderMeta.kind}
                </Badge>
                <span className="text-sm text-muted-foreground">{activeFolderMeta.description}</span>
              </div>
            )}
            {isSearching && (
              <h2 className="text-lg font-semibold">
                Search results for “{searchQuery}”
              </h2>
            )}

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading…</div>
                ) : docs.length === 0 ? (
                  <div className="p-12 text-center">
                    <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-sm font-medium">
                      {isSearching ? "No matching documents" : "No documents in this folder yet"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This is the raw source library. Cleaned transcripts and reference docs land here.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        {isSearching && <TableHead>Folder</TableHead>}
                        <TableHead>Authority</TableHead>
                        <TableHead>Provenance</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docs.map((doc) => (
                        <TableRow
                          key={doc.id}
                          className="cursor-pointer"
                          onClick={() => setViewDoc(doc)}
                        >
                          <TableCell className="font-medium max-w-xs truncate">{doc.title}</TableCell>
                          {isSearching && (
                            <TableCell>
                              <Badge variant="outline">{folderLabel(doc.sourceType)}</Badge>
                            </TableCell>
                          )}
                          <TableCell><Badge variant="secondary">{roleLabel(doc.authorityRole)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[180px] truncate">
                            {doc.sourceName || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {doc.updatedAt ? format(new Date(doc.updatedAt), "MMM d, yyyy") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Detail dialog */}
        <Dialog open={!!viewDoc} onOpenChange={(o) => { if (!o) setViewDoc(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{viewDoc?.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 flex-wrap pt-1">
                {viewDoc && (
                  <>
                    <Badge variant="outline">{folderLabel(viewDoc.sourceType)}</Badge>
                    <Badge variant="secondary">{roleLabel(viewDoc.authorityRole)}</Badge>
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            {viewDoc && (
              <div className="space-y-4">
                {(viewDoc.sourceName || viewDoc.provenanceNote) && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Provenance</p>
                    {viewDoc.sourceName && <p><span className="text-muted-foreground">Source:</span> {viewDoc.sourceName}</p>}
                    {viewDoc.provenanceNote && <p className="text-muted-foreground">{viewDoc.provenanceNote}</p>}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Content</p>
                  <pre className="whitespace-pre-wrap break-words text-sm font-sans bg-muted/30 rounded-md p-3 max-h-[45vh] overflow-y-auto">
                    {viewDoc.content}
                  </pre>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Add-source form */}
        <Dialog open={showForm} onOpenChange={(o) => { if (!o) resetForm(); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Source Document</DialogTitle>
              <DialogDescription>
                Raw source material for mining — never shown to members or cited in answers.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium mb-1 block">Folder</Label>
                  <Select value={formFolder} onValueChange={handleFolderChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCE_FOLDERS.map((f) => (
                        <SelectItem key={f.slug} value={f.slug}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-1 block">Authority Role</Label>
                  <Select value={formRole} onValueChange={setFormRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AUTHORITY_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Title</Label>
                <Input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Document title" />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">
                  Source Name <span className="text-muted-foreground font-normal">(optional, provenance)</span>
                </Label>
                <Input value={formSourceName} onChange={(e) => setFormSourceName(e.target.value)} placeholder="e.g. recording / file name it came from" />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">
                  Provenance Note <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input value={formProvenance} onChange={(e) => setFormProvenance(e.target.value)} placeholder="Where this came from / how it was mined" />
              </div>
              <div>
                <Label className="text-sm font-medium mb-1 block">Content</Label>
                <Textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Raw source content…"
                  className="min-h-[220px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                Add Source
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
