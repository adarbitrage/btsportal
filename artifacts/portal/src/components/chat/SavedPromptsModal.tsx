import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useSavedPrompts,
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  type SavedPrompt,
} from "@/lib/chat-api";

interface SavedPromptsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SavedPromptsModal({ open, onClose }: SavedPromptsModalProps) {
  const { data: prompts = [], isLoading } = useSavedPrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();

  const [editing, setEditing] = useState<SavedPrompt | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  if (!open) return null;

  const handleStartCreate = () => {
    setEditing(null);
    setCreating(true);
    setTitle("");
    setContent("");
  };

  const handleStartEdit = (prompt: SavedPrompt) => {
    setCreating(false);
    setEditing(prompt);
    setTitle(prompt.title);
    setContent(prompt.content);
  };

  const handleSave = () => {
    if (!title.trim() || !content.trim()) return;
    if (editing) {
      updatePrompt.mutate(
        { id: editing.id, title: title.trim(), content: content.trim() },
        { onSuccess: () => { setEditing(null); setTitle(""); setContent(""); } }
      );
    } else {
      createPrompt.mutate(
        { title: title.trim(), content: content.trim() },
        { onSuccess: () => { setCreating(false); setTitle(""); setContent(""); } }
      );
    }
  };

  const handleDelete = (id: number) => {
    deletePrompt.mutate(id, {
      onSuccess: () => {
        setDeleteConfirm(null);
        if (editing?.id === id) {
          setEditing(null);
          setTitle("");
          setContent("");
        }
      },
    });
  };

  const handleCancel = () => {
    setEditing(null);
    setCreating(false);
    setTitle("");
    setContent("");
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Saved Prompts</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>
          ) : prompts.length === 0 && !creating ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-3">No saved prompts yet</p>
              <Button size="sm" onClick={handleStartCreate} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Create Prompt
              </Button>
            </div>
          ) : (
            <>
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`border border-border rounded-lg p-3 ${editing?.id === prompt.id ? "ring-2 ring-primary/30" : ""}`}
                >
                  {editing?.id === prompt.id ? null : (
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-foreground">{prompt.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{prompt.content}</p>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <button
                          onClick={() => handleStartEdit(prompt)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {deleteConfirm === prompt.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(prompt.id)}
                              className="text-[10px] text-destructive font-medium hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-[10px] text-muted-foreground hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(prompt.id)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {(creating || editing) && (
            <div className="border border-primary/30 rounded-lg p-4 bg-primary/5 space-y-3">
              <Input
                placeholder="Prompt title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm"
              />
              <Textarea
                placeholder="Prompt content..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                className="text-sm resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!title.trim() || !content.trim() || createPrompt.isPending || updatePrompt.isPending}
                >
                  {editing ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {!creating && !editing && prompts.length > 0 && (
          <div className="px-6 py-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={handleStartCreate} className="gap-1.5 w-full">
              <Plus className="w-3.5 h-3.5" />
              New Prompt
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
