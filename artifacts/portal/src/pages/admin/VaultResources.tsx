import { useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  Search,
  Plus,
  MoreVertical,
  Eye,
  Pencil,
  Copy,
  Archive,
  FileText,
  Film,
  Link as LinkIcon,
  Image,
  File,
  Download,
  Heart,
  X,
  FolderOpen,
} from "lucide-react";
import {
  useAdminVaultResources,
  useAdminVaultCollections,
  useAdminDuplicateVaultResource,
  useAdminArchiveVaultResource,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";

const RESOURCE_TYPES = [
  { value: "all", label: "All Types" },
  { value: "document", label: "Document" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "video", label: "Video" },
  { value: "article", label: "Article" },
  { value: "template", label: "Template" },
  { value: "link", label: "Link" },
  { value: "image", label: "Image" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function ResourceTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "video": return <Film className="w-4 h-4 text-purple-600" />;
    case "article": return <FileText className="w-4 h-4 text-blue-600" />;
    case "link": return <LinkIcon className="w-4 h-4 text-green-600" />;
    case "image": return <Image className="w-4 h-4 text-orange-600" />;
    case "spreadsheet": return <File className="w-4 h-4 text-emerald-600" />;
    case "template": return <File className="w-4 h-4 text-indigo-600" />;
    default: return <FileText className="w-4 h-4 text-gray-600" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "published":
      return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px]">Published</Badge>;
    case "draft":
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-[10px]">Draft</Badge>;
    case "archived":
      return <Badge className="bg-gray-100 text-gray-800 border-gray-200 text-[10px]">Archived</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
  }
}

export default function VaultResources() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data: collectionsData } = useAdminVaultCollections();
  const { data, isLoading } = useAdminVaultResources({
    type: typeFilter,
    status: statusFilter,
    collection: collectionFilter,
    search: searchQuery || undefined,
    page,
  });
  const duplicateResource = useAdminDuplicateVaultResource();
  const archiveResource = useAdminArchiveVaultResource();

  const collections = collectionsData || [];
  const resources = data?.resources || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 25);

  const hasFilters = typeFilter !== "all" || statusFilter !== "all" || collectionFilter !== "all" || searchQuery !== "";

  const clearFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setCollectionFilter("all");
    setSearchQuery("");
    setPage(1);
  };

  const stats = useMemo(() => ({
    total,
    published: resources.filter(r => r.status === "published").length,
    draft: resources.filter(r => r.status === "draft").length,
  }), [resources, total]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Resource Vault</h1>
            <p className="text-muted-foreground">Manage downloadable resources and content</p>
          </div>
          <Button onClick={() => navigate("/admin/resources/new")}>
            <Plus className="w-4 h-4 mr-2" /> Add Resource
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Resources</div>
          </Card>
          <Card className="p-4 border-green-200 bg-green-50/50">
            <div className="text-2xl font-bold text-green-700">{stats.published}</div>
            <div className="text-sm text-green-600">Published</div>
          </Card>
          <Card className="p-4 border-yellow-200 bg-yellow-50/50">
            <div className="text-2xl font-bold text-yellow-700">{stats.draft}</div>
            <div className="text-sm text-yellow-600">Drafts</div>
          </Card>
        </div>

        <Card>
          <div className="p-4 border-b border-border">
            <div className="flex gap-3 items-center flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search resources..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white"
                />
              </div>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={collectionFilter} onValueChange={(v) => { setCollectionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Collection" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Collections</SelectItem>
                  {collections.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="w-4 h-4 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1fr_120px_140px_100px_80px_80px_60px] gap-2 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div>Resource</div>
              <div>Type</div>
              <div>Collection</div>
              <div>Status</div>
              <div className="text-center">
                <Download className="w-3 h-3 inline" />
              </div>
              <div className="text-center">
                <Heart className="w-3 h-3 inline" />
              </div>
              <div></div>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading resources...</div>
            ) : resources.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {hasFilters ? "No resources match the current filters." : "No resources yet. Create your first resource to get started."}
              </div>
            ) : (
              resources.map(resource => (
                <div
                  key={resource.id}
                  className="grid grid-cols-[1fr_120px_140px_100px_80px_80px_60px] gap-2 px-4 py-3 hover:bg-secondary/20 transition-colors items-center"
                >
                  <Link href={`/admin/resources/${resource.id}/edit`}>
                    <div className="cursor-pointer group">
                      <div className="flex items-center gap-2 mb-0.5">
                        <ResourceTypeIcon type={resource.resourceType} />
                        <h4 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                          {resource.title}
                        </h4>
                        {resource.isFeatured && <Badge className="bg-amber-100 text-amber-800 text-[9px]">Featured</Badge>}
                        {resource.isPinned && <Badge className="bg-blue-100 text-blue-800 text-[9px]">Pinned</Badge>}
                        {resource.isNew && <Badge className="bg-green-100 text-green-800 text-[9px]">New</Badge>}
                      </div>
                      {resource.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-md">{resource.description}</p>
                      )}
                    </div>
                  </Link>
                  <div className="text-xs text-muted-foreground capitalize">{resource.resourceType}</div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    {resource.collectionName ? (
                      <><FolderOpen className="w-3 h-3" />{resource.collectionName}</>
                    ) : (
                      <span className="text-gray-400">Uncategorized</span>
                    )}
                  </div>
                  <div><StatusBadge status={resource.status} /></div>
                  <div className="text-xs text-center text-muted-foreground">{resource.downloadCount}</div>
                  <div className="text-xs text-center text-muted-foreground">{resource.favoriteCount}</div>
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/admin/resources/${resource.id}/edit`)}>
                          <Pencil className="w-4 h-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicateResource.mutate(resource.id)}>
                          <Copy className="w-4 h-4 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => archiveResource.mutate(resource.id)}
                          className="text-red-600"
                        >
                          <Archive className="w-4 h-4 mr-2" /> Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} resources)
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
