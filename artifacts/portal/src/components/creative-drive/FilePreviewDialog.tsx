import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileIcon, Loader2 } from "lucide-react";
import {
  type DriveFile,
  downloadDriveFile,
  fetchDriveFileBlob,
  formatFileSize,
  isImageMime,
  isPdfMime,
  isTextMime,
} from "@/lib/creative-drive-api";
import { useToast } from "@/hooks/use-toast";

/**
 * Load a drive file's bytes through the authenticated fetch path (which
 * refreshes an expired access token) and expose them as an object URL for
 * <img>/<iframe> previews. Direct cookie-authenticated URLs fail with a bare
 * 401 when the preview opens after ~15 minutes of idling.
 */
function useDriveFileObjectUrl(fileId: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    fetchDriveFileBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load file");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  return { url, error };
}

function BlobPreviewFrame({ file }: { file: DriveFile }) {
  const { url, error } = useDriveFileObjectUrl(file.id);

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">{error}</p>;
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isImageMime(file.mimeType)) {
    return (
      <div className="flex items-center justify-center bg-secondary/30 rounded-lg p-2">
        <img
          src={url}
          alt={file.name}
          className="max-h-[60vh] max-w-full object-contain rounded"
          data-testid="img-file-preview"
        />
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title={file.name}
      className="w-full h-[60vh] rounded-lg border border-border"
      data-testid="iframe-pdf-preview"
    />
  );
}

function TextPreview({ file }: { file: DriveFile }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetchDriveFileBlob(file.id)
      .then((blob) => blob.text())
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load file");
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">{error}</p>;
  }
  if (text === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <pre className="text-xs bg-secondary/50 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

export function FilePreviewDialog({
  file,
  onClose,
}: {
  file: DriveFile | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (f: DriveFile) => {
    setDownloading(true);
    try {
      await downloadDriveFile(f);
    } catch (err: unknown) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="dialog-file-preview">
        {file && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8 break-words" data-testid="text-preview-filename">
                {file.name}
              </DialogTitle>
              <DialogDescription>
                {file.mimeType || "Unknown type"} · {formatFileSize(file.sizeBytes)}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-[200px]">
              {isImageMime(file.mimeType) || isPdfMime(file.mimeType) ? (
                <BlobPreviewFrame file={file} />
              ) : isTextMime(file.mimeType) ? (
                <TextPreview file={file} />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                  <FileIcon className="w-12 h-12" />
                  <p className="text-sm">No in-browser preview for this file type.</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => handleDownload(file)}
                disabled={downloading}
                data-testid="button-download-file"
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Download
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
