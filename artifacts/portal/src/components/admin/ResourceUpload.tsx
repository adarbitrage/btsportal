import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, File, X, GripVertical } from "lucide-react";
import type { LessonResource } from "@/lib/admin-api";

interface ResourceUploadProps {
  resources: LessonResource[];
  onChange: (resources: LessonResource[]) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string): string {
  if (type.startsWith("image/")) return "🖼️";
  if (type.includes("pdf")) return "📄";
  if (type.includes("spreadsheet") || type.includes("excel") || type.includes("csv")) return "📊";
  if (type.includes("document") || type.includes("word")) return "📝";
  if (type.includes("zip") || type.includes("compressed")) return "📦";
  return "📎";
}

export function ResourceUpload({ resources, onChange }: ResourceUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList) => {
      const newResources: LessonResource[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        type: file.type || "application/octet-stream",
      }));
      onChange([...resources, ...newResources]);
    },
    [resources, onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const removeResource = (id: string) => {
    onChange(resources.filter((r) => r.id !== id));
  };

  const moveResource = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= resources.length) return;
    const updated = [...resources];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-secondary/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Drop files here or <span className="text-primary font-medium">browse</span>
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">PDF, DOC, XLS, images, and more</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {resources.length > 0 && (
        <div className="space-y-2">
          {resources.map((resource, index) => (
            <div
              key={resource.id}
              className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg border border-border/50 group"
            >
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => moveResource(index, index - 1)}
              >
                <GripVertical className="w-4 h-4" />
              </button>
              <span className="text-lg">{getFileIcon(resource.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{resource.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(resource.size)} · {resource.type.split("/").pop()?.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeResource(resource.id)}
                className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
