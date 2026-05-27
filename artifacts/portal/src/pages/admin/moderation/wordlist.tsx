import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PlusCircle, ShieldCheck } from "lucide-react";
import {
  useAdminWordlist,
  useAdminCreateWord,
  useAdminUpdateWord,
  useAdminDeleteWord,
  type WordlistEntryFormData,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { WordForm } from "@/components/admin/moderation/word-form";
import { WordlistTable } from "@/components/admin/moderation/wordlist-table";

export default function WordlistPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const { data: entries = [], isLoading } = useAdminWordlist();
  const createWord = useAdminCreateWord();
  const updateWord = useAdminUpdateWord();
  const deleteWord = useAdminDeleteWord();

  const handleCreate = async (data: WordlistEntryFormData) => {
    try {
      await createWord.mutateAsync(data);
      toast({ title: "Word added to wordlist" });
      setAddOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleUpdate = async (id: number, data: Partial<WordlistEntryFormData>) => {
    try {
      await updateWord.mutateAsync({ id, data });
      toast({ title: "Word updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteWord.mutateAsync(id);
      toast({ title: "Word removed from wordlist" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-muted-foreground" />
              <h1 className="text-2xl font-bold text-foreground">Moderation Wordlist</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              Manage words flagged during content submission. Hard words are auto-blocked;
              soft words are flagged for review.
            </p>
          </div>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="w-4 h-4 mr-2" />
                Add Word
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Word</DialogTitle>
              </DialogHeader>
              <WordForm
                onSubmit={handleCreate}
                isSubmitting={createWord.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading wordlist...</div>
        ) : entries.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">No words in the wordlist yet.</p>
              <p className="text-sm mt-1">
                Use "Add Word" to add the first entry.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} in wordlist
            </p>
            <WordlistTable
              entries={entries}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              isDeleting={deleteWord.isPending}
              isUpdating={updateWord.isPending}
            />
          </>
        )}
      </div>
    </AppLayout>
  );
}
