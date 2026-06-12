import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { MessageList } from "@/components/dm/message-list";
import { MessageComposer } from "@/components/dm/message-composer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages, useSendMessage, useMarkRead, useThreads } from "@/hooks/use-dm";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, MessageSquare } from "lucide-react";

export default function DMThread() {
  const { user } = useAuth();
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const threadId = Number(threadIdParam ?? 0);
  const isMobile = useIsMobile();

  const isCoach = user?.role === "coach";
  const inboxPath = isCoach ? "/coach/messages" : "/dm";

  const [tabFocused, setTabFocused] = useState(
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );

  useEffect(() => {
    function handleVisibility() {
      setTabFocused(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const { data: messages, isLoading: messagesLoading } = useMessages(threadId, tabFocused);
  const { data: threads, isLoading: threadsLoading } = useThreads();
  const sendMessage = useSendMessage();
  const markRead = useMarkRead();
  const { toast } = useToast();

  const thread = threads?.find((t) => t.id === threadId);
  const otherParty = thread?.otherParty;
  const otherUserName = otherParty?.name ?? "";

  const threadUnreadCount = thread?.unreadCount ?? 0;

  const doMarkRead = useCallback(() => {
    if (threadId > 0 && threadUnreadCount > 0) {
      markRead.mutate(threadId);
    }
  }, [threadId, threadUnreadCount]);

  useEffect(() => {
    doMarkRead();
  }, [doMarkRead]);

  useEffect(() => {
    if (tabFocused && threadUnreadCount > 0) {
      doMarkRead();
    }
  }, [tabFocused, threadUnreadCount]);

  function handleSend(body: string) {
    sendMessage.mutate(
      { threadId, body },
      {
        onError: () =>
          toast({
            title: "Couldn't send message",
            description: "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <AppLayout>
      <div
        className={
          isMobile
            ? "fixed inset-0 flex flex-col bg-background z-40"
            : "max-w-2xl mx-auto flex flex-col border rounded-xl overflow-hidden bg-card shadow-sm"
        }
        style={isMobile ? undefined : { height: "calc(100vh - 10rem)" }}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3 shrink-0 bg-card">
          {isMobile && (
            <Link href={inboxPath}>
              <Button variant="ghost" size="icon" className="-ml-2">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
          )}
          {threadsLoading ? (
            <Skeleton className="h-5 w-36" />
          ) : otherParty ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold shrink-0">
                {otherParty.name.charAt(0).toUpperCase()}
              </div>
              <span className="font-semibold text-sm truncate">{otherParty.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold text-sm text-muted-foreground">Conversation</span>
            </div>
          )}

          {!isMobile && (
            <div className="ml-auto">
              <Link href={inboxPath}>
                <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5">
                  <ArrowLeft className="w-4 h-4" />
                  Back to inbox
                </Button>
              </Link>
            </div>
          )}
        </div>

        <MessageList
          messages={messages ?? []}
          otherUserName={otherUserName}
          isLoading={messagesLoading}
        />

        <MessageComposer onSend={handleSend} isPending={sendMessage.isPending} />
      </div>
    </AppLayout>
  );
}
