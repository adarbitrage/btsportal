import { useState } from "react";
import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Search, Heart, FileText, Video, ExternalLink, Download,
  ChevronLeft, Star, Lock, FolderOpen, ArrowUpDown, Crown,
} from "lucide-react";
import { useVaultCollectionDetail, useToggleFavorite } from "@/lib/vault-api";

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

export default function CollectionDetail() {
  const params = useParams<{ collectionSlug: string }>();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("default");

  const { data, isLoading, error } = useVaultCollectionDetail(params.collectionSlug || "");
  const toggleFavorite = useToggleFavorite();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-card rounded w-48"></div>
          <div className="h-32 bg-card rounded-xl"></div>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-card rounded-xl"></div>)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Collection not found</h2>
          <p className="text-muted-foreground mt-2">This collection doesn't exist or has been removed.</p>
          <Link href="/resources">
            <Button className="mt-4" variant="outline">Back to Resources</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const { collection, subCollections, resources } = data;

  if (!collection.isAccessible) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Link href="/resources">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to Resources
            </Button>
          </Link>
          <div className="text-center p-16 bg-white rounded-2xl border border-border">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">{collection.name}</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              This collection requires a higher membership tier. Upgrade your plan to access these resources.
            </p>
            <Button size="lg">
              <Crown className="w-4 h-4 mr-2" />
              Upgrade Your Plan
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  let filteredResources = [...resources];
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredResources = filteredResources.filter((r: any) =>
      r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
  }
  if (typeFilter !== "all") {
    filteredResources = filteredResources.filter((r: any) => r.type === typeFilter);
  }
  if (sortBy === "newest") {
    filteredResources.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (sortBy === "popular") {
    filteredResources.sort((a: any, b: any) => b.viewCount - a.viewCount);
  } else if (sortBy === "az") {
    filteredResources.sort((a: any, b: any) => a.title.localeCompare(b.title));
  }

  const resourceTypes = [...new Set(resources.map((r: any) => r.type))];

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link href="/resources">
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to Resources
          </Button>
        </Link>

        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-foreground mb-1">{collection.name}</h1>
          <p className="text-muted-foreground">{collection.description}</p>
        </div>

        {subCollections && subCollections.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {subCollections.map((sc: any) => (
              <Link key={sc.id} href={`/resources/${sc.slug}`}>
                <Badge
                  variant="outline"
                  className={`cursor-pointer px-3 py-1.5 text-xs ${sc.isAccessible ? "hover:bg-primary/10 hover:border-primary/30" : "opacity-60"}`}
                >
                  <FolderOpen className="w-3 h-3 mr-1.5" />
                  {sc.name}
                  {!sc.isAccessible && <Lock className="w-3 h-3 ml-1.5" />}
                </Badge>
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search in collection..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All Types</option>
              {resourceTypes.map((t: string) => (
                <option key={t} value={t}>{typeLabels[t] || t}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="default">Default</option>
              <option value="newest">Newest First</option>
              <option value="popular">Most Popular</option>
              <option value="az">A–Z</option>
            </select>
          </div>
        </div>

        {filteredResources.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-xl border border-border">
            <p className="text-muted-foreground">No resources found matching your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredResources.map((resource: any) => {
              const TypeIcon = typeIcons[resource.type] || FileText;
              return (
                <Card key={resource.id} className="group hover:shadow-md transition-all border-border/60 hover:border-primary/20">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <TypeIcon className="w-4.5 h-4.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <Link href={`/resources/${params.collectionSlug}/${resource.id}`}>
                            <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1 cursor-pointer">
                              {resource.title}
                            </h4>
                          </Link>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFavorite.mutate(resource.id)}
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
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
