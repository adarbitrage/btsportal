import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HardDrive,
  Folder,
  FolderPlus,
  FileIcon,
  FileText,
  Upload,
  ChevronRight,
  Home,
  Loader2,
  MoreVertical,
  Pencil,
  FolderInput,
  Trash2,
  Download,
  RefreshCw,
  Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  browseDrive,
  listAllDriveFolders,
  createDriveFolder,
  updateDriveFolder,
  deleteDriveFolder,
  updateDriveFile,
  deleteDriveFile,
  uploadDriveFile,
  driveFileContentUrl,
  driveFileDownloadUrl,
  formatFileSize,
  isImageMime,
  isPdfMime,
  isTextMime,
  type DriveBrowseResponse,
  type DriveFolder,
  type DriveFile,
} from "@/lib/creative-drive-api";
import { FilePreviewDialog } from "@/components/creative-drive/FilePreviewDialog";

type MoveTarget =
  | { kind: "folder"; item: DriveFolder }
  | { kind: "file"; item: DriveFile };
type RenameTarget = MoveTarget;
type DeleteTarget = MoveTarget;

/** Builds "Parent / Child" display paths for the move picker. */
function folderPathLabels(all: DriveFolder[]): Map<number, string> {
  const byId = new Map(all.map((f) => [f.id, f]));
  const labels = new Map<number, string>();
  const resolve = (id: number, depth = 0): string => {
    if (labels.has(id)) return labels.get(id)!;
    const folder = byId.get(id);
    if (!folder) return `#${id}`;
    const label =
      folder.parentId && depth < 20
        ? `${resolve(folder.parentId, depth + 1)} / ${folder.name}`
        : folder.name;
    labels.set(id, label);
    return label;
  };
  for (const f of all) resolve(f.id);
  return labels;
}

function fileTypeIcon(mimeType: string) {
  if (isPdfMime(mimeType)) return <FileText className="w-8 h-8 text-red-500" />;
  if (isTextMime(mimeType)) return <FileText className="w-8 h-8 text-blue-500" />;
  return <FileIcon className="w-8 h-8 text-muted-foreground" />;
}

export default function AdminCreativeDrive() {
  const { toast } = useToast();
  const [folderId, setFolderId] = useState<number | null>(null);
  const [data, setData] = useState<DriveBrowseResponse | null>(null);
  const [allFolders, setAllFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [moveDestination, setMoveDestination] = useState<string>("root");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [browse, folders] = await Promise.all([
        browseDrive(folderId),
        listAllDriveFolders(),
      ]);
      setData(browse);
      setAllFolders(folders.folders);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Creative Drive");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pathLabels = useMemo(() => folderPathLabels(allFolders), [allFolders]);

  const fail = (err: unknown, fallback: string) =>
    toast({
      title: "Error",
      description: err instanceof Error ? err.message : fallback,
      variant: "destructive",
    });

  // ── Uploads ────────────────────────────────────────────────────────────────

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    let succeeded = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        setUploadProgress(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
        try {
          await uploadDriveFile(list[i], folderId);
          succeeded++;
        } catch (err) {
          fail(err, `Failed to upload ${list[i].name}`);
        }
      }
      if (succeeded > 0) {
        toast({
          title: "Upload complete",
          description: `${succeeded} file${succeeded === 1 ? "" : "s"} uploaded.`,
        });
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      void load();
    }
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try {
      await createDriveFolder(newFolderName.trim(), folderId);
      toast({ title: "Folder created", description: `"${newFolderName.trim()}" added.` });
      setNewFolderOpen(false);
      setNewFolderName("");
      void load();
    } catch (err) {
      fail(err, "Failed to create folder");
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    try {
      if (renameTarget.kind === "folder") {
        await updateDriveFolder(renameTarget.item.id, { name: renameValue.trim() });
      } else {
        await updateDriveFile(renameTarget.item.id, { name: renameValue.trim() });
      }
      toast({ title: "Renamed", description: `Renamed to "${renameValue.trim()}".` });
      setRenameTarget(null);
      void load();
    } catch (err) {
      fail(err, "Failed to rename");
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    const dest = moveDestination === "root" ? null : parseInt(moveDestination, 10);
    setBusy(true);
    try {
      if (moveTarget.kind === "folder") {
        await updateDriveFolder(moveTarget.item.id, { parentId: dest });
      } else {
        await updateDriveFile(moveTarget.item.id, { folderId: dest });
      }
      toast({
        title: "Moved",
        description: `Moved to ${dest ? pathLabels.get(dest) ?? "folder" : "the root"}.`,
      });
      setMoveTarget(null);
      void load();
    } catch (err) {
      fail(err, "Failed to move");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget.kind === "folder") {
        await deleteDriveFolder(deleteTarget.item.id);
      } else {
        await deleteDriveFile(deleteTarget.item.id);
      }
      toast({ title: "Deleted", description: `"${deleteTarget.item.name}" removed.` });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      fail(err, "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  // ── Move-picker option list (excludes self + own subtree for folders) ──────

  const moveOptions = useMemo(() => {
    if (!moveTarget) return allFolders;
    if (moveTarget.kind === "file") return allFolders;
    const excluded = new Set<number>([moveTarget.item.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of allFolders) {
        if (f.parentId !== null && excluded.has(f.parentId) && !excluded.has(f.id)) {
          excluded.add(f.id);
          changed = true;
        }
      }
    }
    return allFolders.filter((f) => !excluded.has(f.id));
  }, [moveTarget, allFolders]);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <HardDrive className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold">Creative Drive</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage the files and folders members see in their Creative Drive.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setNewFolderName("");
                setNewFolderOpen(true);
              }}
              data-testid="button-new-folder"
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              New Folder
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="button-upload"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="input-file-upload"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm flex-wrap">
          <button
            onClick={() => setFolderId(null)}
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
                onClick={() => setFolderId(crumb.id)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Drop zone + contents */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed transition-colors p-4 min-h-[300px] ${
            dragActive ? "border-primary bg-primary/5" : "border-border/60"
          }`}
          data-testid="drop-zone"
        >
          {uploadProgress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try again
              </Button>
            </div>
          ) : data && data.folders.length === 0 && data.files.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Upload className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                This folder is empty. Drag &amp; drop files here or use the buttons above.
              </p>
            </div>
          ) : (
            data && (
              <div className="space-y-4">
                {data.folders.map((folder) => (
                  <Card key={`folder-${folder.id}`} className="border-border/60">
                    <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
                      <button
                        onClick={() => setFolderId(folder.id)}
                        className="flex items-center gap-3 min-w-0 text-left"
                        data-testid={`admin-folder-${folder.id}`}
                      >
                        <Folder className="w-6 h-6 text-amber-500 shrink-0" />
                        <span className="text-sm font-medium truncate">{folder.name}</span>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`menu-folder-${folder.id}`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget({ kind: "folder", item: folder });
                              setRenameValue(folder.name);
                            }}
                          >
                            <Pencil className="w-4 h-4 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setMoveTarget({ kind: "folder", item: folder });
                              setMoveDestination("root");
                            }}
                          >
                            <FolderInput className="w-4 h-4 mr-2" /> Move
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ kind: "folder", item: folder })}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardContent>
                  </Card>
                ))}

                {data.files.map((file) => (
                  <Card key={`file-${file.id}`} className="border-border/60">
                    <CardContent className="flex items-center justify-between gap-3 py-3 px-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {isImageMime(file.mimeType) ? (
                          <img
                            src={driveFileContentUrl(file.id)}
                            alt={file.name}
                            loading="lazy"
                            className="w-10 h-10 rounded object-cover shrink-0 bg-secondary"
                          />
                        ) : (
                          fileTypeIcon(file.mimeType)
                        )}
                        <div className="min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            data-testid={`admin-file-name-${file.id}`}
                          >
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {file.mimeType || "Unknown type"} · {formatFileSize(file.sizeBytes)}
                          </p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`menu-file-${file.id}`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setPreviewFile(file)}>
                            <Eye className="w-4 h-4 mr-2" /> Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a href={driveFileDownloadUrl(file.id)} download={file.name}>
                              <Download className="w-4 h-4 mr-2" /> Download
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget({ kind: "file", item: file });
                              setRenameValue(file.name);
                            }}
                          >
                            <Pencil className="w-4 h-4 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setMoveTarget({ kind: "file", item: file });
                              setMoveDestination("root");
                            }}
                          >
                            <FolderInput className="w-4 h-4 mr-2" /> Move
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ kind: "file", item: file })}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>
              Created inside{" "}
              {folderId ? `"${pathLabels.get(folderId) ?? "this folder"}"` : "the drive root"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            data-testid="input-folder-name"
            onKeyDown={(e) => e.key === "Enter" && void handleCreateFolder()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateFolder()}
              disabled={busy || !newFolderName.trim()}
              data-testid="button-create-folder"
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.kind === "folder" ? "Folder" : "File"}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            data-testid="input-rename"
            onKeyDown={(e) => e.key === "Enter" && void handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleRename()}
              disabled={busy || !renameValue.trim()}
              data-testid="button-confirm-rename"
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move "{moveTarget?.item.name}"</DialogTitle>
            <DialogDescription>Choose a destination folder.</DialogDescription>
          </DialogHeader>
          <Select value={moveDestination} onValueChange={setMoveDestination}>
            <SelectTrigger data-testid="select-move-destination">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Drive root</SelectItem>
              {moveOptions.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {pathLabels.get(f.id) ?? f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleMove()} disabled={busy} data-testid="button-confirm-move">
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.kind === "folder" ? "folder" : "file"} "
              {deleteTarget?.item.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "folder"
                ? "The folder must be empty before it can be deleted. This cannot be undone."
                : "The file will be permanently removed from the Creative Drive. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </AdminLayout>
  );
}
