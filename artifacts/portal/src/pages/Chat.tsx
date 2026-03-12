import { useState, useCallback, useEffect } from "react";
import { Link, Redirect } from "wouter";
import {
  Plus,
  Trash2,
  MessageCircle,
  ArrowLeft,
  Menu,
  X,
  Settings2,
  ArrowUp,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { SavedPromptsModal } from "@/components/chat/SavedPromptsModal";
import {
  useChatStatus,
  useChatSessions,
  useChatMessages,
  useChatStream,
  useDeleteSession,
  useSavedPrompts,
  useCreateTicketFromChat,
  type ChatSession,
  type ChatMessage,
} from "@/lib/chat-api";
import { useGetCurrentMember } from "@workspace/api-client-react";

function groupSessionsByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);
  const last30 = new Date(today.getTime() - 30 * 86400000);

  const groups: { label: string; sessions: ChatSession[] }[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Last 7 Days", sessions: [] },
    { label: "Last 30 Days", sessions: [] },
    { label: "Older", sessions: [] },
  ];

  for (const session of sessions) {
    const d = new Date(session.updatedAt);
    if (d >= today) groups[0].sessions.push(session);
    else if (d >= yesterday) groups[1].sessions.push(session);
    else if (d >= last7) groups[2].sessions.push(session);
    else if (d >= last30) groups[3].sessions.push(session);
    else groups[4].sessions.push(session);
  }

  return groups.filter((g) => g.sessions.length > 0);
}

export default function Chat() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [promptsModalOpen, setPromptsModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: member } = useGetCurrentMember();
  const { data: chatStatus } = useChatStatus();
  const { data: sessions = [] } = useChatSessions();
  const { data: savedPrompts } = useSavedPrompts();
  const deleteSession = useDeleteSession();
  const createTicket = useCreateTicketFromChat();

  const entitlements = new Set(member?.entitlements ?? []);
  const hasChatAccess = entitlements.has("chat:ai");
  const isLifetime = entitlements.has("access:lifetime");

  const {
    messages,
    isStreaming,
    sessionId,
    error,
    sendMessage,
    stopStreaming,
    setMessages,
    setSessionId,
    clearError,
  } = useChatStream();

  const { data: existingMessages } = useChatMessages(sessionId);

  useEffect(() => {
    if (existingMessages && existingMessages.length > 0) {
      setMessages(existingMessages);
    }
  }, [existingMessages, setMessages]);

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setMobileSidebarOpen(false);
  }, [setSessionId, setMessages]);

  const handleSelectSession = useCallback(
    (session: ChatSession) => {
      setSessionId(session.id);
      setMessages([]);
      setMobileSidebarOpen(false);
    },
    [setSessionId, setMessages]
  );

  const handleDeleteSession = useCallback(
    (sid: string) => {
      deleteSession.mutate(sid, {
        onSuccess: () => {
          setDeleteConfirm(null);
          if (sessionId === sid) {
            setSessionId(null);
            setMessages([]);
          }
        },
      });
    },
    [deleteSession, sessionId, setSessionId, setMessages]
  );

  const handleCreateTicket = useCallback(
    (subject: string, description: string) => {
      if (!sessionId) return;
      createTicket.mutate(
        { sessionId, subject, description },
        {
          onSuccess: (data: any) => {
            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: "assistant" as const,
                content: `Support ticket #${data.ticketId} has been created. Our team will follow up with you shortly.`,
                sessionId: sessionId || "",
                createdAt: new Date().toISOString(),
              },
            ]);
          },
        }
      );
    },
    [sessionId, createTicket, setMessages]
  );

  const isLimitReached =
    chatStatus && chatStatus.dailyMessageLimit > 0 && chatStatus.dailyMessageCount >= chatStatus.dailyMessageLimit;

  const limitMessage = isLimitReached
    ? chatStatus?.tier === "basic"
      ? "Daily message limit reached. Upgrade for more messages!"
      : "Daily message limit reached. Resets at midnight."
    : undefined;

  const grouped = groupSessionsByDate(sessions);

  if (member && !hasChatAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-sm mx-auto px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">AI Chat Not Available</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Upgrade your plan to access AI-powered chat assistance.
          </p>
          <Link href="/">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border shrink-0">
        <Button onClick={handleNewChat} className="w-full gap-2" size="sm">
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {grouped.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label}
            </p>
            {group.sessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-secondary/50 transition-colors ${
                  sessionId === session.id ? "bg-secondary" : ""
                }`}
                onClick={() => handleSelectSession(session)}
              >
                <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm text-foreground truncate">{session.title}</span>
                {deleteConfirm === session.id ? (
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      className="text-[10px] text-destructive font-medium hover:underline"
                    >
                      Delete
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground px-4">
            No conversations yet. Start a new chat!
          </div>
        )}
      </div>

      {isLifetime && (
        <div className="p-4 border-t border-border shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => setPromptsModalOpen(true)}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Manage Prompts
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      <div className={`hidden md:flex w-72 border-r border-border bg-white flex-col shrink-0 ${sidebarOpen ? "" : "md:hidden"}`}>
        {sidebarContent}
      </div>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebarOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold text-sm">Chat History</h3>
              <button onClick={() => setMobileSidebarOpen(false)} className="p-1 rounded-md hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/">
              <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </Link>
            <div>
              <h2 className="font-semibold text-foreground text-sm">BTS AI Assistant</h2>
              <p className="text-[10px] text-muted-foreground">
                {chatStatus
                  ? `${chatStatus.dailyMessageCount}/${chatStatus.dailyMessageLimit === -1 ? "∞" : chatStatus.dailyMessageLimit} messages today`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isLimitReached && chatStatus?.tier === "basic" && (
              <Link href="/upgrade">
                <Badge variant="outline" className="gap-1 text-primary border-primary/30 cursor-pointer hover:bg-primary/5">
                  <ArrowUp className="w-3 h-3" />
                  Upgrade
                </Badge>
              </Link>
            )}
          </div>
        </div>

        <ChatMessages
          messages={messages}
          isStreaming={isStreaming}
          onCreateTicket={handleCreateTicket}
        />

        {error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="text-destructive/70 hover:text-destructive underline text-xs">
              Dismiss
            </button>
          </div>
        )}

        <div className="p-4 border-t border-border bg-white shrink-0">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              onSend={(msg) => sendMessage(msg, sessionId)}
              onStop={stopStreaming}
              isStreaming={isStreaming}
              disabled={!!isLimitReached}
              disabledMessage={limitMessage}
              savedPrompts={savedPrompts}
              showSavedPrompts={isLifetime}
            />
          </div>
        </div>
      </div>

      <SavedPromptsModal open={promptsModalOpen} onClose={() => setPromptsModalOpen(false)} />
    </div>
  );
}
