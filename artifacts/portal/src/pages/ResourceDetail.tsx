import type { JSX } from "react";
import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Heart, FileText, Video, ExternalLink, Download, ChevronLeft,
  Star, Eye, ArrowDownToLine, Calendar, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { useVaultResourceDetail, useToggleFavorite, useDownloadResource } from "@/lib/vault-api";

const typeIcons: Record<string, any> = {
  file: Download,
  article: FileText,
  video: Video,
  link: ExternalLink,
};

const typeLabels: Record<string, string> = {
  file: "Downloadable File",
  article: "Article",
  video: "Video Tutorial",
  link: "External Link",
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: JSX.Element[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let inList = false;
  let listItems: string[] = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto my-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {tableRows[0].map((cell, i) => (
                  <th key={i} className="border border-border px-3 py-2 bg-secondary/50 text-left font-semibold">{cell.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.slice(2).map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border px-3 py-2">{cell.trim()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
    inTable = false;
  };

  const flushList = () => {
    if (listItems.length > 0) {
      const isOrdered = /^\d+\./.test(listItems[0]);
      const ListTag = isOrdered ? "ol" : "ul";
      elements.push(
        <ListTag key={`list-${elements.length}`} className={`my-3 pl-6 space-y-1 ${isOrdered ? "list-decimal" : "list-disc"}`}>
          {listItems.map((item, i) => (
            <li key={i} className="text-sm text-foreground/80 leading-relaxed">
              {item.replace(/^[-*]\s+|^\d+\.\s+|\[.\]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1")}
            </li>
          ))}
        </ListTag>
      );
      listItems = [];
    }
    inList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inList) flushList();
      inTable = true;
      tableRows.push(line.split("|").filter(Boolean));
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (/^[-*]\s+|^\d+\.\s+|\s*-\s*\[.\]/.test(line)) {
      if (!inTable) flushTable();
      inList = true;
      listItems.push(line);
      continue;
    } else if (inList) {
      flushList();
    }

    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-2xl font-bold text-foreground mt-6 mb-3">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-xl font-bold text-foreground mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-lg font-semibold text-foreground mt-4 mb-2">{line.slice(4)}</h3>);
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={i} className="border-l-4 border-primary/30 pl-4 my-3 italic text-muted-foreground text-sm">
          {line.slice(2).replace(/"/g, "")}
        </blockquote>
      );
    } else if (line.trim() === "") {
      continue;
    } else {
      const processed = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>");
      elements.push(
        <p key={i} className="text-sm text-foreground/80 leading-relaxed my-2" dangerouslySetInnerHTML={{ __html: processed }} />
      );
    }
  }

  if (inTable) flushTable();
  if (inList) flushList();

  return <div className="prose-custom">{elements}</div>;
}

export default function ResourceDetail() {
  const params = useParams<{ collectionSlug: string; resourceId: string }>();
  const resourceId = parseInt(params.resourceId || "0", 10);

  const { data: resource, isLoading, error } = useVaultResourceDetail(resourceId);
  const toggleFavorite = useToggleFavorite();
  const downloadResource = useDownloadResource();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-card rounded w-48"></div>
          <div className="h-64 bg-card rounded-xl"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !resource) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Resource not found</h2>
          <p className="text-muted-foreground mt-2">This resource doesn't exist or you don't have access.</p>
          <Link href="/resources">
            <Button className="mt-4" variant="outline">Back to Resources</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const TypeIcon = typeIcons[resource.type] || FileText;

  const handleDownload = async () => {
    try {
      const result = await downloadResource.mutateAsync(resource.id);
      if (result.downloadUrl) {
        window.open(result.downloadUrl, "_blank");
      }
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link href={`/resources/${params.collectionSlug}`}>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to {resource.collectionName}
          </Button>
        </Link>

        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TypeIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{resource.title}</h1>
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {format(new Date(resource.createdAt), "MMM d, yyyy")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />
                    {resource.viewCount} views
                  </span>
                  {resource.downloadCount > 0 && (
                    <span className="flex items-center gap-1">
                      <ArrowDownToLine className="w-3.5 h-3.5" />
                      {resource.downloadCount} downloads
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => toggleFavorite.mutate(resource.id)}
              className="p-2 rounded-lg hover:bg-secondary transition-colors"
            >
              <Heart className={`w-5 h-5 transition-colors ${resource.isFavorited ? "fill-red-500 text-red-500" : "text-muted-foreground hover:text-red-400"}`} />
            </button>
          </div>

          <p className="text-muted-foreground mb-4">{resource.description}</p>

          <div className="flex flex-wrap gap-2 mb-6">
            <Badge variant="outline">{typeLabels[resource.type] || resource.type}</Badge>
            {resource.isFeatured && (
              <Badge className="bg-amber-50 text-amber-700 border-amber-200"><Star className="w-3 h-3 mr-1" />Featured</Badge>
            )}
            {resource.tags?.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>

          {resource.type === "file" && (
            <div className="bg-secondary/30 rounded-xl p-6 border border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">Ready to download</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {resource.fileType} · {formatFileSize(resource.fileSize)}
                  </p>
                </div>
                <Button size="lg" onClick={handleDownload} disabled={downloadResource.isPending}>
                  <Download className="w-5 h-5 mr-2" />
                  {downloadResource.isPending ? "Preparing..." : "Download"}
                </Button>
              </div>
            </div>
          )}

          {resource.type === "article" && resource.markdownContent && (
            <Card className="mt-6">
              <CardContent className="p-8">
                <SimpleMarkdown content={resource.markdownContent} />
              </CardContent>
            </Card>
          )}

          {resource.type === "video" && resource.videoUrl && (
            <div className="mt-6">
              <div className="aspect-video rounded-xl overflow-hidden border border-border bg-black">
                <iframe
                  src={resource.videoUrl}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={resource.title}
                />
              </div>
            </div>
          )}

          {resource.type === "link" && resource.externalUrl && (
            <div className="bg-secondary/30 rounded-xl p-6 border border-border/50 mt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">External Resource</p>
                  <p className="text-sm text-muted-foreground mt-1 truncate max-w-md">{resource.externalUrl}</p>
                </div>
                <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="lg">
                    <ExternalLink className="w-5 h-5 mr-2" />
                    Open Link
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>

        {resource.relatedResources && resource.relatedResources.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-foreground mb-4">Related Resources</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {resource.relatedResources.map((related: any) => {
                const RelIcon = typeIcons[related.type] || FileText;
                return (
                  <Link key={related.id} href={`/resources/${related.collectionSlug}/${related.id}`}>
                    <Card className="cursor-pointer hover:shadow-md transition-all hover:border-primary/20">
                      <CardContent className="p-5 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <RelIcon className="w-4.5 h-4.5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-semibold text-sm text-foreground line-clamp-1">{related.title}</h4>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">{related.description}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
