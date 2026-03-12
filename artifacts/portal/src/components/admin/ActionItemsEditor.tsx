import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, GripVertical, X } from "lucide-react";
import type { ActionItem } from "@/lib/admin-api";

interface ActionItemsEditorProps {
  items: ActionItem[];
  onChange: (items: ActionItem[]) => void;
}

export function ActionItemsEditor({ items, onChange }: ActionItemsEditorProps) {
  const [newText, setNewText] = useState("");

  const addItem = () => {
    if (!newText.trim()) return;
    const newItem: ActionItem = {
      id: crypto.randomUUID(),
      text: newText.trim(),
      sortOrder: items.length + 1,
    };
    onChange([...items, newItem]);
    setNewText("");
  };

  const removeItem = (id: string) => {
    onChange(items.filter((i) => i.id !== id).map((i, idx) => ({ ...i, sortOrder: idx + 1 })));
  };

  const updateItem = (id: string, text: string) => {
    onChange(items.map((i) => (i.id === id ? { ...i, text } : i)));
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length) return;
    const updated = [...items];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onChange(updated.map((i, idx) => ({ ...i, sortOrder: idx + 1 })));
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2 group">
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => moveItem(index, index - 1)}
                className="text-muted-foreground hover:text-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={index === 0}
              >
                <GripVertical className="w-4 h-4" />
              </button>
            </div>
            <div className="w-6 h-6 rounded border-2 border-muted-foreground/30 shrink-0" />
            <Input
              value={item.text}
              onChange={(e) => updateItem(item.id, e.target.value)}
              className="flex-1"
              placeholder="Action item text..."
            />
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add an action item..."
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={!newText.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}
