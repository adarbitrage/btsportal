import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WordlistEntry, WordlistEntryFormData } from "@/lib/admin-api";

interface WordFormProps {
  initial?: WordlistEntry | null;
  onSubmit: (data: WordlistEntryFormData) => void;
  isSubmitting?: boolean;
}

const defaultForm: WordlistEntryFormData = {
  word: "",
  category: "profanity",
  severity: "soft",
};

export function WordForm({ initial, onSubmit, isSubmitting }: WordFormProps) {
  const [form, setForm] = useState<WordlistEntryFormData>(defaultForm);

  useEffect(() => {
    if (initial) {
      setForm({ word: initial.word, category: initial.category, severity: initial.severity });
    } else {
      setForm(defaultForm);
    }
  }, [initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.word.trim()) return;
    onSubmit({ ...form, word: form.word.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div>
        <Label htmlFor="wf-word">Word</Label>
        <Input
          id="wf-word"
          value={form.word}
          onChange={(e) => setForm((f) => ({ ...f, word: e.target.value }))}
          placeholder="e.g. badword"
          autoComplete="off"
          required
        />
      </div>

      <div>
        <Label htmlFor="wf-category">Category</Label>
        <Select
          value={form.category}
          onValueChange={(v) => setForm((f) => ({ ...f, category: v as WordlistEntryFormData["category"] }))}
        >
          <SelectTrigger id="wf-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="profanity">Profanity</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="wf-severity">Severity</Label>
        <Select
          value={form.severity}
          onValueChange={(v) => setForm((f) => ({ ...f, severity: v as WordlistEntryFormData["severity"] }))}
        >
          <SelectTrigger id="wf-severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hard">Hard — auto-block</SelectItem>
            <SelectItem value="soft">Soft — flag for review</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting || !form.word.trim()}>
        {initial ? "Update Word" : "Add Word"}
      </Button>
    </form>
  );
}
