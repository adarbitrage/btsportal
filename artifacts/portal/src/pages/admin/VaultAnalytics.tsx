import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Heart,
  FolderOpen,
  FileText,
  TrendingUp,
  AlertCircle,
  Search,
} from "lucide-react";
import { useAdminVaultAnalytics } from "@/lib/admin-api";
import { format } from "date-fns";

export default function VaultAnalytics() {
  const { data: analytics, isLoading } = useAdminVaultAnalytics();

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Vault Analytics</h1>
            <p className="text-muted-foreground">Loading analytics data...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!analytics) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Vault Analytics</h1>
            <p className="text-muted-foreground">Failed to load analytics</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Vault Analytics</h1>
          <p className="text-muted-foreground">Resource engagement metrics and content gap analysis</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{analytics.totalResources}</div>
                <div className="text-sm text-muted-foreground">Total Resources</div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{analytics.totalCollections}</div>
                <div className="text-sm text-muted-foreground">Collections</div>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <div className="p-4 border-b border-border flex items-center gap-2">
              <Download className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Most Downloaded</h2>
            </div>
            <div className="divide-y divide-border">
              {analytics.mostDownloaded.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No download data yet</div>
              ) : (
                analytics.mostDownloaded.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-sm font-bold text-muted-foreground w-6">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {r.resourceType}{r.collectionName ? ` · ${r.collectionName}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{r.downloadCount} downloads</Badge>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4 border-b border-border flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500" />
              <h2 className="font-semibold">Most Favorited</h2>
            </div>
            <div className="divide-y divide-border">
              {analytics.mostFavorited.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No favorite data yet</div>
              ) : (
                analytics.mostFavorited.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-sm font-bold text-muted-foreground w-6">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {r.resourceType}{r.collectionName ? ` · ${r.collectionName}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{r.favoriteCount} favorites</Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <Card>
          <div className="p-4 border-b border-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <h2 className="font-semibold">Download Trends (Last 30 Days)</h2>
          </div>
          <div className="p-4">
            {analytics.downloadTrends.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">No download activity in the last 30 days</div>
            ) : (
              <div className="h-48 flex items-end gap-1">
                {(() => {
                  const maxDownloads = Math.max(...analytics.downloadTrends.map(d => d.downloads), 1);
                  return analytics.downloadTrends.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div
                        className="w-full bg-primary/70 hover:bg-primary rounded-t transition-colors min-h-[2px]"
                        style={{ height: `${(d.downloads / maxDownloads) * 100}%` }}
                      />
                      <div className="hidden group-hover:block absolute -top-8 bg-foreground text-background text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                        {d.date}: {d.downloads}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <div className="p-4 border-b border-border flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold">Zero Engagement Resources</h2>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {analytics.zeroDownloads.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">All resources have engagement</div>
              ) : (
                analytics.zeroDownloads.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {r.resourceType}{r.collectionName ? ` · ${r.collectionName}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <div className="p-4 border-b border-border flex items-center gap-2">
              <Search className="w-4 h-4 text-purple-500" />
              <h2 className="font-semibold">Failed Search Queries (Content Gaps)</h2>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {analytics.searchGaps.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No search gaps detected</div>
              ) : (
                analytics.searchGaps.map((sq, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">"{sq.query}"</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {sq.searchCount} searches
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
