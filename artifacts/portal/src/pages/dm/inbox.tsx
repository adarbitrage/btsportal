import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ThreadList } from "@/components/dm/thread-list";
import { NewConversationModal } from "@/components/dm/new-conversation-modal";
import { useThreads } from "@/hooks/use-dm";
import { useAuth } from "@/lib/auth";
import { MessageSquare, PlusCircle } from "lucide-react";

export default function DMInbox() {
  const { user } = useAuth();
  const { data: threads, isLoading } = useThreads();
  const [showNewConversation, setShowNewConversation] = useState(false);

  if (user?.role === "coach") return null;

  const isEmpty = !isLoading && (threads?.length ?? 0) === 0;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Messages</h1>
          </div>
          <Button
            onClick={() => setShowNewConversation(true)}
            className="gap-1.5"
            size="sm"
          >
            <PlusCircle className="w-4 h-4" />
            New Message
          </Button>
        </div>

        <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-4">
              <MessageSquare className="w-10 h-10 text-muted-foreground/40" />
              <div>
                <p className="font-medium text-foreground">No conversations yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Need help? Start a conversation with an admin.
                </p>
              </div>
              <Button
                onClick={() => setShowNewConversation(true)}
                variant="outline"
                className="gap-1.5 mt-2"
              >
                <PlusCircle className="w-4 h-4" />
                Start a conversation
              </Button>
            </div>
          ) : (
            <ThreadList threads={threads ?? []} isLoading={isLoading} />
          )}
        </div>
      </div>

      <NewConversationModal
        open={showNewConversation}
        onOpenChange={setShowNewConversation}
      />
    </AppLayout>
  );
}
