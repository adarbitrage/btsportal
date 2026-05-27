import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useRecipients, useCreateThread } from "@/hooks/use-dm";
import { type DMRecipient } from "@/lib/dm-api";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

interface NewConversationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewConversationModal({ open, onOpenChange }: NewConversationModalProps) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data: recipients, isLoading } = useRecipients();
  const createThread = useCreateThread();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DMRecipient | null>(null);
  const [body, setBody] = useState("");

  const isAdmin = user?.role === "admin" || user?.role === "support_agent";
  const heading = isAdmin ? "Message a member" : "Message an admin";

  const filtered = (recipients ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setSearch("");
      setSelected(null);
      setBody("");
    }
    onOpenChange(isOpen);
  }

  function handleSend() {
    if (!selected || !body.trim()) return;
    createThread.mutate(
      { recipientId: selected.id, body: body.trim() },
      {
        onSuccess: (thread) => {
          handleClose(false);
          navigate(`/dm/${thread.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!selected ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3">
                      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  ))
                ) : filtered.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">
                    No results found.
                  </p>
                ) : (
                  filtered.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left",
                      )}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold shrink-0">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">{r.name}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold shrink-0">
                  {selected.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{selected.name}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground"
                >
                  Change
                </Button>
              </div>

              <div>
                <Label htmlFor="dm-body">Message</Label>
                <Textarea
                  id="dm-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your first message…"
                  className="mt-1.5 min-h-[100px] resize-none"
                  autoFocus
                  maxLength={2000}
                />
                <p className="text-[11px] text-muted-foreground mt-1 text-right">
                  {body.length}/2000
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={!body.trim() || createThread.isPending}
                >
                  {createThread.isPending ? "Sending…" : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
