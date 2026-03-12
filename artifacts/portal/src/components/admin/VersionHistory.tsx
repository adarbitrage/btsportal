import { useAdminListLessonVersions, useAdminRestoreLessonVersion, type LessonVersion } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, RotateCcw, Eye } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface VersionHistoryProps {
  lessonId: number;
  onPreviewVersion?: (version: LessonVersion) => void;
}

export function VersionHistory({ lessonId, onPreviewVersion }: VersionHistoryProps) {
  const { data: versions, isLoading } = useAdminListLessonVersions(lessonId);
  const restoreMutation = useAdminRestoreLessonVersion();
  const [restoreTarget, setRestoreTarget] = useState<LessonVersion | null>(null);

  const handleRestore = () => {
    if (!restoreTarget) return;
    restoreMutation.mutate(
      { lessonId, versionId: restoreTarget.id },
      { onSuccess: () => setRestoreTarget(null) }
    );
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="p-6 text-center">
        <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No version history yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Versions are created when you save changes</p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-[400px]">
        <div className="p-2 space-y-1">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="p-3 rounded-lg hover:bg-secondary/50 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-primary">v{version.versionNumber}</span>
                    {index === 0 && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                        Latest
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground mt-1 truncate">{version.changeSummary || "No description"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(version.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {version.createdBy}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onPreviewVersion && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onPreviewVersion(version)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setRestoreTarget(version)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Version</DialogTitle>
            <DialogDescription>
              This will create a new version based on v{restoreTarget?.versionNumber}. Your current content will be preserved as the previous version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={restoreMutation.isPending}>
              {restoreMutation.isPending ? "Restoring..." : "Restore Version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
