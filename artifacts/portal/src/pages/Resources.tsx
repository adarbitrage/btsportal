import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation, useSearch } from "wouter";
import {
  Search, Heart, FileText, Video, ExternalLink, BookOpen, Download,
  FolderOpen, Star, Lock, Filter, ChevronRight, BarChart3, ClipboardList,
  ListChecks, Calculator, Image, Megaphone, Layout, Type, Mail, Rocket, X,
} from "lucide-react";
import {
  useVaultCollections,
  useVaultFeaturedResources,
  useVaultRecentResources,
  useVaultResources,
  useToggleFavorite,
} from "@/lib/vault-api";

const iconMap: Record<string, any> = {
  "file-text": FileText,
  "megaphone": Megaphone,
  "layout": Layout,
  "copy": FileText,
  "type": Type,
  "mail": Mail,
  "bar-chart": BarChart3,
  "clipboard-list": ClipboardList,
  "rocket": Rocket,
  "list-checks": ListChecks,
  "video": Video,
  "calculator": Calculator,
  "image": Image,
  "book-open": BookOpen,
  "external-link": ExternalLink,
  "folder": FolderOpen,
};

const typeIcons: Record<string, any> = {
  file: Download,
  article: FileText,
  video: Video,
  link: ExternalLink,
};

const typeLabels: Record<string, string> = {
  file: "Download",
  article: "Article",
  video: "Video",
  link: "Link",
};

function ResourceCard({ resource, onToggleFavorite }: { resource: any; onToggleFavorite: (id: number) => void }) {
  const TypeIcon = typeIcons[resource.type] || FileText;
  return (
    <Card className="group hover:shadow-md transition-all border-border/60 hover:border-primary/20">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TypeIcon className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="min-w-0">
              <Link href={`/resources/${resource.collectionSlug}/${resource.id}`}>
                <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1 cursor-pointer">
                  {resource.title}
                </h4>
              </Link>
              <p className="text-[11px] text-muted-foreground">{resource.collectionName}</p>
            </div>
          </div>
          <button
            onClick={(e) => { e.preventDefault(); onToggleFavorite(resource.id); }}
            className="p-1.5 rounded-md hover:bg-secondary transition-colors shrink-0"
          >
            <Heart className={`w-4 h-4 transition-colors ${resource.isFavorited ? "fill-red-500 text-red-500" : "text-muted-foreground/40 hover:text-red-400"}`} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">{resource.description}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] bg-secondary/50">{typeLabels[resource.type] || resource.type}</Badge>
          {resource.isFeatured && <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"><Star className="w-3 h-3 mr-1" />Featured</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Resources() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const activeSearch = urlParams.get("search") || "";
  const activeType = urlParams.get("type") || "";
  const activeSort = urlParams.get("sort") || "";
  const activeFavorites = urlParams.get("favorites") || "";

  const [searchQuery, setSearchQuery] = useState(activeSearch);

  const isSearchActive = !!(activeSearch || activeType || activeSort || activeFavorites);

  const searchParams: Record<string, string> = {};
  if (activeSearch) searchParams.search = activeSearch;
  if (activeType) searchParams.type = activeType;
  if (activeSort) searchParams.sort = activeSort;
  if (activeFavorites) searchParams.favorites = activeFavorites;

  const { data: collections, isLoading: collectionsLoading } = useVaultCollections();
  const { data: featured } = useVaultFeaturedResources();
  const { data: recent } = useVaultRecentResources();
  const { data: searchData, isLoading: searchLoading } = useVaultResources(
    isSearchActive ? searchParams : {}
  );
  const searchResults = searchData?.resources;
  const toggleFavorite = useToggleFavorite();

  const handleToggleFavorite = (id: number) => {
    toggleFavorite.mutate(id);
  };

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(`/resources?search=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate("/resources");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    navigate("/resources");
  };

  const topLevelCollections = collections?.filter((c: any) => !c.parentId) || [];

  if (collectionsLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-card rounded-xl w-1/3"></div>
          <div className="h-40 bg-card rounded-xl"></div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-28 bg-card rounded-xl"></div>)}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Resource Vault</h1>
              <p className="text-muted-foreground mt-1">Templates, guides, tools, and more to accelerate your success.</p>
            </div>
          </div>
          <div className="flex gap-3 items-center max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search resources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch}>Search</Button>
            {isSearchActive && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
          {isSearchActive && (
            <div className="flex gap-2 mt-3">
              <select
                value={activeType}
                onChange={(e) => {
                  const params = new URLSearchParams(searchString);
                  if (e.target.value) params.set("type", e.target.value);
                  else params.delete("type");
                  navigate(`/resources?${params.toString()}`);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All Types</option>
                <option value="file">Downloads</option>
                <option value="article">Articles</option>
                <option value="video">Videos</option>
                <option value="link">Links</option>
              </select>
              <select
                value={activeSort}
                onChange={(e) => {
                  const params = new URLSearchParams(searchString);
                  if (e.target.value) params.set("sort", e.target.value);
                  else params.delete("sort");
                  navigate(`/resources?${params.toString()}`);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Relevance</option>
                <option value="newest">Newest</option>
                <option value="popular">Popular</option>
                <option value="az">A–Z</option>
              </select>
              <Button
                variant={activeFavorites ? "default" : "outline"}
                size="sm"
                className="h-9"
                onClick={() => {
                  const params = new URLSearchParams(searchString);
                  if (activeFavorites) params.delete("favorites");
                  else params.set("favorites", "true");
                  navigate(`/resources?${params.toString()}`);
                }}
              >
                <Heart className="w-3.5 h-3.5 mr-1" />
                Favorites
              </Button>
            </div>
          )}
        </div>

        {isSearchActive ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Search className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">
                {activeSearch ? `Results for "${activeSearch}"` : activeFavorites ? "Your Favorites" : "Filtered Resources"}
              </h2>
              {searchResults && (
                <span className="text-sm text-muted-foreground">({searchResults.length} found)</span>
              )}
            </div>
            {searchLoading ? (
              <div className="text-center py-12 text-muted-foreground">Searching...</div>
            ) : searchResults && searchResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {searchResults.map((resource: any) => (
                  <ResourceCard key={resource.id} resource={resource} onToggleFavorite={handleToggleFavorite} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No resources found matching your criteria.</p>
                <Button variant="link" onClick={clearFilters} className="mt-2">Clear filters</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {featured && featured.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-5 h-5 text-amber-500" />
                  <h2 className="text-lg font-bold text-foreground">Featured Resources</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {featured.map((resource: any) => (
                    <ResourceCard key={resource.id} resource={resource} onToggleFavorite={handleToggleFavorite} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-bold text-foreground">Collections</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {topLevelCollections.map((collection: any) => {
                  const IconComponent = iconMap[collection.icon] || FolderOpen;
                  return (
                    <Link key={collection.id} href={`/resources/${collection.slug}`}>
                      <Card className={`cursor-pointer hover:shadow-md transition-all ${collection.isAccessible ? "hover:border-primary/20" : "opacity-70"}`}>
                        <CardContent className="p-5 flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${collection.isAccessible ? "bg-primary/10" : "bg-secondary"}`}>
                            {collection.isAccessible ? (
                              <IconComponent className="w-6 h-6 text-primary" />
                            ) : (
                              <Lock className="w-5 h-5 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-sm text-foreground">{collection.name}</h3>
                              {!collection.isAccessible && (
                                <Badge variant="outline" className="text-[9px] bg-secondary text-muted-foreground">Upgrade</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{collection.description}</p>
                            <p className="text-[11px] text-muted-foreground/70 mt-1">{collection.resourceCount} resources</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>

            {recent && recent.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-lg font-bold text-foreground">Recently Added</h2>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recent.slice(0, 6).map((resource: any) => (
                    <ResourceCard key={resource.id} resource={resource} onToggleFavorite={handleToggleFavorite} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
