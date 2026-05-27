import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Search, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import type { WordlistEntry, WordlistEntryFormData } from "@/lib/admin-api";
import { WordForm } from "./word-form";

type SortField = "word" | "category" | "severity" | "addedAt";
type SortDir = "asc" | "desc";

interface WordlistTableProps {
  entries: WordlistEntry[];
  onUpdate: (id: number, data: Partial<WordlistEntryFormData>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  isDeleting?: boolean;
  isUpdating?: boolean;
}

function CategoryBadge({ category }: { category: WordlistEntry["category"] }) {
  return (
    <Badge variant="outline" className="capitalize text-xs">
      {category}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: WordlistEntry["severity"] }) {
  return severity === "hard" ? (
    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs capitalize">Hard</Badge>
  ) : (
    <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs capitalize">Soft</Badge>
  );
}

export function WordlistTable({
  entries,
  onUpdate,
  onDelete,
  isDeleting,
  isUpdating,
}: WordlistTableProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | WordlistEntry["category"]>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | WordlistEntry["severity"]>("all");
  const [sortField, setSortField] = useState<SortField>("addedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [editTarget, setEditTarget] = useState<WordlistEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WordlistEntry | null>(null);

  const filtered = useMemo(() => {
    let result = [...entries];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((e) => e.word.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") {
      result = result.filter((e) => e.category === categoryFilter);
    }
    if (severityFilter !== "all") {
      result = result.filter((e) => e.severity === severityFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "word") cmp = a.word.localeCompare(b.word);
      else if (sortField === "category") cmp = a.category.localeCompare(b.category);
      else if (sortField === "severity") cmp = a.severity.localeCompare(b.severity);
      else cmp = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [entries, search, categoryFilter, severityFilter, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortField === field ? "text-primary" : "opacity-40"}`} />
    </button>
  );

  const handleEdit = async (data: WordlistEntryFormData) => {
    if (!editTarget) return;
    await onUpdate(editTarget.id, data);
    setEditTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search words..."
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as typeof categoryFilter)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="profanity">Profanity</SelectItem>
            <SelectItem value="spam">Spam</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="hard">Hard</SelectItem>
            <SelectItem value="soft">Soft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No words match the current filters.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">
                  <SortButton field="word" label="Word" />
                </TableHead>
                <TableHead>
                  <SortButton field="category" label="Category" />
                </TableHead>
                <TableHead>
                  <SortButton field="severity" label="Severity" />
                </TableHead>
                <TableHead>Added By</TableHead>
                <TableHead>
                  <SortButton field="addedAt" label="Added At" />
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono font-medium">{entry.word}</TableCell>
                  <TableCell>
                    <CategoryBadge category={entry.category} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={entry.severity} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entry.addedBy ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(entry.addedAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(entry)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(entry)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Word</DialogTitle>
          </DialogHeader>
          <WordForm
            initial={editTarget}
            onSubmit={handleEdit}
            isSubmitting={isUpdating}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete word?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <span className="font-mono font-semibold">"{deleteTarget?.word}"</span> from the
              wordlist. The server-side cache will be invalidated so the change takes effect
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
