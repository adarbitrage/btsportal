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
  driveFileContentUrl,
  driveFileDownloadUrl,
  formatFileSize,
  isImageMime,
  isPdfMime,
  isTextMime,
} from "@/lib/creative-drive-api";

function TextPreview({ file }: { file: DriveFile }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(driveFileContentUrl(file.id), { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
        return res.text();
      })
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
              {isImageMime(file.mimeType) ? (
                <div className="flex items-center justify-center bg-secondary/30 rounded-lg p-2">
                  <img
                    src={driveFileContentUrl(file.id)}
                    alt={file.name}
                    className="max-h-[60vh] max-w-full object-contain rounded"
                    data-testid="img-file-preview"
                  />
                </div>
              ) : isPdfMime(file.mimeType) ? (
                <iframe
                  src={driveFileContentUrl(file.id)}
                  title={file.name}
                  className="w-full h-[60vh] rounded-lg border border-border"
                  data-testid="iframe-pdf-preview"
                />
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
              <Button asChild data-testid="button-download-file">
                <a href={driveFileDownloadUrl(file.id)} download={file.name}>
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </a>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
