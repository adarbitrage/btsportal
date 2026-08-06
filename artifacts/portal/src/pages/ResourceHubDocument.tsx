import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchResourceHub, type HubItem, type HubResponse } from "@/lib/resource-hub-api";
import { fetchDriveFileBlob } from "@/lib/creative-drive-api";
import { PdfCanvasViewer } from "@/components/pdf/PdfCanvasViewer";

/**
 * Per-item Resource Hub reading page (view-only gating task): each hub file
 * item gets its own in-portal page at /resource-hub/view/:slug that renders
 * the PDF as canvases (no browser PDF toolbar, no download/print controls).
 * The route is gated on the same `resource-hub` content-access page key as
 * the hub itself, and the bytes ride the existing authenticated,
 * page-key-gated content endpoint.
 */

function flattenFileItems(data: HubResponse | undefined): HubItem[] {
  if (!data) return [];
  const out: HubItem[] = [];
  const walk = (items: HubItem[]) => {
    for (const it of items) {
      if (it.kind === "file" && it.fileId) out.push(it);
      if (it.children) walk(it.children);
    }
  };
  for (const section of Object.values(data.sections)) walk(section);
  return out;
}

export default function ResourceHubDocument() {
  const [, params] = useRoute("/resource-hub/view/:slug");
  const slug = params?.slug ?? "";

  const hubQuery = useQuery({ queryKey: ["resource-hub"], queryFn: fetchResourceHub });
  const item = flattenFileItems(hubQuery.data).find((i) => i.slug === slug) ?? null;

  const docQuery = useQuery({
    queryKey: ["resource-hub-doc", item?.fileId],
    enabled: item !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const blob = await fetchDriveFileBlob(item!.fileId!);
      return blob.arrayBuffer();
    },
  });

  return (
    <AppLayout>
      <div className="space-y-4 max-w-5xl">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2" data-testid="link-back-to-hub">
            <Link href="/resource-hub">
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to Resource Hub
            </Link>
          </Button>
          {item && (
            <>
              <h1 className="text-2xl font-bold" data-testid="text-document-title">
                {item.displayTitle}
              </h1>
              {item.blurb && <p className="text-muted-foreground mt-1">{item.blurb}</p>}
            </>
          )}
        </div>

        {hubQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        )}
        {hubQuery.isError && (
          <p className="text-sm text-destructive py-8">
            Couldn't load this document. Please refresh the page.
          </p>
        )}
        {hubQuery.isSuccess && !item && (
          <p className="text-sm text-muted-foreground py-8" data-testid="text-document-not-found">
            This document isn't available. It may have been removed from the Resource Hub.
          </p>
        )}

        {item && docQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading document…
          </div>
        )}
        {item && docQuery.isError && (
          <p className="text-sm text-destructive py-8">
            {docQuery.error instanceof Error ? docQuery.error.message : "Couldn't load this document."}
          </p>
        )}
        {item && docQuery.data && <PdfCanvasViewer data={docQuery.data} />}
      </div>
    </AppLayout>
  );
}
