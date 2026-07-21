import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  HardDrive,
  Folder,
  FileText,
  FileIcon,
  Download,
  ChevronRight,
  Home,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  browseDrive,
  driveFileContentUrl,
  driveFileDownloadUrl,
  formatFileSize,
  isImageMime,
  isPdfMime,
  isTextMime,
  type DriveBrowseResponse,
  type DriveFile,
} from "@/lib/creative-drive-api";
import { FilePreviewDialog } from "@/components/creative-drive/FilePreviewDialog";

function fileTypeIcon(mimeType: string) {
  if (isPdfMime(mimeType)) return <FileText className="w-10 h-10 text-red-500" />;
  if (isTextMime(mimeType)) return <FileText className="w-10 h-10 text-blue-500" />;
  return <FileIcon className="w-10 h-10 text-muted-foreground" />;
}

export default function CreativeDrive() {
  const [searchParams] = useSearchParams();
  const [, navigate] = useLocation();
  const folderParam = searchParams.get("folder");
  const folderId = folderParam ? parseInt(folderParam, 10) || null : null;

  const [data, setData] = useState<DriveBrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseDrive(folderId);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Creative Drive");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFolder = (id: number | null) => {
    navigate(id === null ? "/creative-drive" : `/creative-drive?folder=${id}`);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Creative Drive</h1>
          </div>
          <p className="text-muted-foreground">
            High-converting ad templates, guides, brand logos, and creative assets —
            browse, preview, and download everything in one place.
          </p>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm flex-wrap" data-testid="drive-breadcrumb">
          <button
            onClick={() => openFolder(null)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            data-testid="breadcrumb-root"
          >
            <Home className="w-4 h-4" />
            Drive
          </button>
          {(data?.breadcrumb ?? []).map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
              <button
                onClick={() => openFolder(crumb.id)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`breadcrumb-folder-${crumb.id}`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Card className="border-destructive/40">
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : data && data.folders.length === 0 && data.files.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm" data-testid="text-empty-drive">
                This folder is empty.
              </p>
            </CardContent>
          </Card>
        ) : (
          data && (
            <div className="space-y-6">
              {data.folders.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {data.folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => openFolder(folder.id)}
                      className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      data-testid={`folder-${folder.id}`}
                    >
                      <Folder className="w-6 h-6 text-amber-500 shrink-0" />
                      <span className="text-sm font-medium truncate">{folder.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {data.files.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {data.files.map((file) => (
                    <div
                      key={file.id}
                      className="group rounded-lg border border-border/60 bg-card overflow-hidden hover:border-primary/40 transition-colors flex flex-col"
                      data-testid={`file-${file.id}`}
                    >
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="aspect-square w-full flex items-center justify-center bg-secondary/40 overflow-hidden"
                        data-testid={`button-preview-${file.id}`}
                      >
                        {isImageMime(file.mimeType) ? (
                          <img
                            src={driveFileContentUrl(file.id)}
                            alt={file.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          fileTypeIcon(file.mimeType)
                        )}
                      </button>
                      <div className="p-2.5 flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate" title={file.name}>
                            {file.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatFileSize(file.sizeBytes)}
                          </p>
                        </div>
                        <a
                          href={driveFileDownloadUrl(file.id)}
                          download={file.name}
                          className="text-muted-foreground hover:text-foreground shrink-0 p-1"
                          title="Download"
                          data-testid={`link-download-${file.id}`}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </AppLayout>
  );
}
