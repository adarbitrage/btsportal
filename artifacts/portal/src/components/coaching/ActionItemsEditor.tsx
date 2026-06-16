import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";
import type { PackActionItem } from "@/lib/session-coaching-admin-api";

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface ActionItemsEditorProps {
  items: PackActionItem[];
  onChange: (items: PackActionItem[]) => void;
  disabled?: boolean;
}

export function ActionItemsEditor({ items, onChange, disabled }: ActionItemsEditorProps) {
  const [draft, setDraft] = useState("");

  function addItem() {
    const text = draft.trim();
    if (!text) return;
    onChange([
      ...items,
      {
        id: makeId(),
        text,
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
  }

  function toggle(id: string, completed: boolean) {
    onChange(
      items.map((item) =>
        item.id === id
          ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null }
          : item,
      ),
    );
  }

  function remove(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  return (
    <div className="space-y-2" data-testid="action-items-editor">
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
              data-testid={`action-item-${item.id}`}
            >
              <Checkbox
                checked={item.completed}
                disabled={disabled}
                onCheckedChange={(c) => toggle(item.id, c === true)}
              />
              <span
                className={`flex-1 text-sm ${
                  item.completed ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {item.text}
              </span>
              {!disabled && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(item.id)}
                  aria-label="Remove action item"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="Add an action item…"
            data-testid="action-item-input"
          />
          <Button type="button" variant="outline" onClick={addItem} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
