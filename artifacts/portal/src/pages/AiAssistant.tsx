import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Send, Bot, Trash2, Plus, MessageCircle,
  Loader2, AlertCircle, Menu, X, Mic, LifeBuoy,
} from "lucide-react";
import { Link } from "wouter";
import { AssistantEmptyState } from "@/components/assistant/AssistantEmptyState";
import { RetrievalSourcesPanel } from "@/components/assistant/RetrievalSourcesPanel";
import { useAuth } from "@/lib/auth";
import { hasPermission, isAdminRole } from "@/lib/permissions";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useChatSessions,
  useChatMessages,
  useDeleteSession,
  useChatStream,
  useCreateTicketFromChat,
  type ChatSession,
  type ChatMessage,
} from "@/lib/chat-api";

function groupByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: ChatSession[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 Days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of sessions) {
    const d = new Date(c.updatedAt || c.createdAt);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= last7) groups[2].items.push(c);
    else groups[3].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function AiAssistant() {
  const [input, setInput] = useState("");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [ticketCreated, setTicketCreated] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { user } = useAuth();
  // Admin-only source tracing (Task #1925): the API only returns traces to
  // admin chat:view holders; this mirrors that gate client-side.
  const canViewTraces = !!user && isAdminRole(user.role) && hasPermission(user.role as any, "chat:view");

  const { data: sessions = [] } = useChatSessions();
  const {
    messages,
    isStreaming,
    sessionId,
    error,
    suggestTicket,
    sendMessage,
    setMessages,
    setSessionId,
    clearError,
    dismissTicketSuggestion,
  } = useChatStream();
  const { data: loadedMessages } = useChatMessages(sessionId);
  const deleteSession = useDeleteSession();
  const createTicket = useCreateTicketFromChat();

  // Track which session's history we've hydrated so streaming updates aren't clobbered.
  const hydratedSessionRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      sessionId &&
      loadedMessages &&
      hydratedSessionRef.current !== sessionId &&
      !isStreaming
    ) {
      hydratedSessionRef.current = sessionId;
      setMessages(loadedMessages.filter((m) => m.role !== "system"));
    }
  }, [sessionId, loadedMessages, isStreaming, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectSession = (session: ChatSession) => {
    if (session.id === sessionId) {
      setMobileSidebar(false);
      return;
    }
    hydratedSessionRef.current = null;
    setSessionId(session.id);
    setMessages([]);
    setMobileSidebar(false);
    setTicketCreated(null);
    clearError();
  };

  const handleNewChat = () => {
    hydratedSessionRef.current = null;
    setSessionId(null);
    setMessages([]);
    setInput("");
    setTicketCreated(null);
    clearError();
    setMobileSidebar(false);
    inputRef.current?.focus();
  };

  const handleDeleteSession = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession.mutate(id);
    if (sessionId === id) {
      handleNewChat();
    }
  };

  const handleSend = (overrideText?: string) => {
    const content = (overrideText ?? input).trim();
    if (!content || isStreaming) return;
    setInput("");
    setTicketCreated(null);
    // When a brand-new chat starts, mark the (upcoming) session as hydrated so
    // the history query doesn't overwrite the streamed messages.
    if (!sessionId) hydratedSessionRef.current = -1;
    sendMessage(content, sessionId);
  };

  const handleCreateTicket = () => {
    if (!sessionId) return;
    const firstUserMessage = messages.find((m) => m.role === "user");
    const subject =
      (firstUserMessage?.content || "AI Assistant conversation").slice(0, 80);
    createTicket.mutate(
      { sessionId, subject },
      {
        onSuccess: (data: { ticketNumber?: string }) => {
          setTicketCreated(data?.ticketNumber || "created");
          dismissTicketSuggestion();
        },
      },
    );
  };

  // Once a session id exists, keep the hydrated marker pinned to it.
  useEffect(() => {
    if (sessionId && hydratedSessionRef.current === -1) {
      hydratedSessionRef.current = sessionId;
    }
  }, [sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const grouped = groupByDate(sessions);
  const activeTitle = sessions.find((c) => c.id === sessionId)?.title || "BTS AI Assistant";
  const visibleMessages = messages.filter((m: ChatMessage) => m.role !== "system");

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-14 px-3 flex items-center border-b border-[#DDE3EE] dark:border-stone-800 shrink-0">
        <Button
          onClick={handleNewChat}
          className="w-full gap-2 bg-[#3B5FA8] hover:bg-[#33538F] text-white dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900"
          size="sm"
          data-testid="button-new-chat"
        >
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {grouped.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="px-3 py-1 text-[10px] font-semibold text-[#64748B] dark:text-stone-400 uppercase tracking-wider">
              {group.label}
            </p>
            {group.items.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session)}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  sessionId === session.id
                    ? "bg-[#DCE3F0] dark:bg-stone-800"
                    : "hover:bg-[#E4E9F2] dark:hover:bg-stone-800/60"
                }`}
                data-testid={`item-conversation-${session.id}`}
              >
                <MessageCircle className="w-3.5 h-3.5 text-[#94A3B8] dark:text-stone-400 shrink-0" />
                <span className="flex-1 text-sm text-[#1E293B] dark:text-stone-200 truncate">{session.title}</span>
                <button
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#64748B] hover:text-rose-600 dark:text-stone-500 dark:hover:text-rose-400 transition-all shrink-0"
                  data-testid={`button-delete-conversation-${session.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-center py-8 text-sm text-[#64748B] dark:text-stone-400 px-4">
            No conversations yet.
            <br />
            Start a new chat!
          </div>
        )}
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">AI Assistant</h1>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground flex-1">
              Ask anything about your mentorship, tools, campaigns, or strategies. Trained
              on BTS coaching sessions, Q&A articles, and your complete tool documentation.
            </p>
            <Link href="/assistant/voice">
              <a className="shrink-0">
                <Button variant="outline" size="sm" className="gap-1.5 text-sm">
                  <Mic className="w-3.5 h-3.5" />
                  Talk it through (voice)
                </Button>
              </a>
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-[#D6DEEC] dark:border-stone-800 bg-[#FDFDFE] dark:bg-stone-950 overflow-hidden flex h-[calc(100vh-14rem)] md:h-[calc(100vh-11rem)] min-h-[360px] md:min-h-[480px] shadow-[0_20px_50px_-20px_rgba(51,65,85,0.18),0_8px_20px_-8px_rgba(51,65,85,0.08)]">
          <div className="hidden md:flex w-64 border-r border-[#DDE3EE] dark:border-stone-800 bg-[#EEF1F7] dark:bg-stone-900/60 flex-col shrink-0">
            {sidebarContent}
          </div>

          {mobileSidebar && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileSidebar(false)} />
              <div className="absolute left-0 top-0 bottom-0 w-64 bg-[#EEF1F7] dark:bg-stone-950 shadow-xl flex flex-col">
                <div className="h-14 px-4 flex items-center justify-between border-b border-[#DDE3EE] dark:border-stone-800">
                  <h3 className="font-semibold text-sm text-[#1E293B] dark:text-stone-100">Chat History</h3>
                  <button onClick={() => setMobileSidebar(false)} className="p-1 rounded-md hover:bg-[#E4E9F2] dark:hover:bg-stone-800/60 text-[#64748B] dark:text-stone-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {sidebarContent}
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#FDFDFE] dark:bg-stone-950">
            <div className="h-14 px-4 flex items-center gap-3 border-b border-[#E4E9F2] dark:border-stone-800 shrink-0">
              <button
                onClick={() => setMobileSidebar(true)}
                className="md:hidden p-1.5 rounded-md text-[#64748B] hover:text-[#1E293B] dark:text-stone-500 dark:hover:text-stone-100 hover:bg-[#EEF1F7] dark:hover:bg-stone-800"
                data-testid="button-mobile-history"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-[#E7EDF9] dark:bg-stone-800 ring-1 ring-[#D6DEEC] dark:ring-stone-700 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-[#3B5FA8] dark:text-stone-200" />
                </div>
                <div className="min-w-0 leading-tight">
                  <h2 className="font-semibold text-[#1E293B] dark:text-stone-100 text-sm truncate">{activeTitle}</h2>
                  <p className="text-[11px] text-[#64748B] dark:text-stone-500">Powered by your BTS knowledge base</p>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {visibleMessages.length === 0 ? (
                <AssistantEmptyState onSendMessage={handleSend} />
              ) : (
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                  {visibleMessages.map((msg, i) => (
                    <div key={msg.id ?? `local-${i}`} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-full bg-[#E7EDF9] dark:bg-stone-800 ring-1 ring-[#D6DEEC] dark:ring-stone-700 flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="w-4 h-4 text-[#3B5FA8] dark:text-stone-200" />
                        </div>
                      )}
                      {msg.role === "assistant" ? (
                        <div className="flex-1 min-w-0 pt-1 text-[#1E293B] dark:text-stone-100">
                          <div className="prose prose-sm max-w-none text-[15px] leading-7 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_a]:text-[#2F55A4] dark:[&_a]:text-teal-400 [&_a]:underline [&_strong]:text-[#1E293B] dark:[&_strong]:text-stone-100 [&_code]:bg-[#EEF1F7] dark:[&_code]:bg-stone-800 [&_code]:text-[#334155] dark:[&_code]:text-stone-200 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_table]:my-2 [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_th]:border [&_th]:border-[#D6DEEC] dark:[&_th]:border-stone-700 [&_th]:bg-[#EEF1F7] dark:[&_th]:bg-stone-800 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[#1E293B] dark:[&_th]:text-stone-100 [&_td]:border [&_td]:border-[#D6DEEC] dark:[&_td]:border-stone-700 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                table: ({ node: _node, ...props }) => (
                                  <div className="overflow-x-auto max-w-full" data-testid="chat-markdown-table-wrapper">
                                    <table {...props} />
                                  </div>
                                ),
                              }}
                            >
                              {msg.content || (isStreaming && i === visibleMessages.length - 1 ? "..." : "")}
                            </ReactMarkdown>
                          </div>
                          {canViewTraces && msg.retrievalTrace && (
                            <RetrievalSourcesPanel trace={msg.retrievalTrace} />
                          )}
                        </div>
                      ) : (
                        <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-[#E7EDF9] dark:bg-stone-800 text-[#1E293B] dark:text-stone-100">
                          <p className="text-[15px] whitespace-pre-wrap leading-6">{msg.content}</p>
                        </div>
                      )}
                    </div>
                  ))}
                  {isStreaming && visibleMessages[visibleMessages.length - 1]?.role === "user" && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#E7EDF9] dark:bg-stone-800 ring-1 ring-[#D6DEEC] dark:ring-stone-700 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-[#3B5FA8] dark:text-stone-200" />
                      </div>
                      <div className="pt-2">
                        <Loader2 className="w-4 h-4 animate-spin text-[#94A3B8] dark:text-stone-400" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {suggestTicket && !ticketCreated && (
              <div className="px-4 py-2.5 bg-teal-50 dark:bg-teal-950/40 border-t border-teal-200 dark:border-teal-900 text-sm flex items-center gap-2.5" data-testid="banner-suggest-ticket">
                <LifeBuoy className="w-4 h-4 shrink-0 text-teal-700 dark:text-teal-400" />
                <span className="flex-1 text-teal-900 dark:text-teal-100">
                  Sounds like this needs a human. Want me to open a support ticket with this conversation attached?
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-teal-300 dark:border-teal-800 text-teal-800 dark:text-teal-200"
                  onClick={handleCreateTicket}
                  disabled={createTicket.isPending}
                  data-testid="button-create-ticket"
                >
                  {createTicket.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create ticket"}
                </Button>
                <button
                  onClick={dismissTicketSuggestion}
                  className="p-1 rounded text-teal-700 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40"
                  data-testid="button-dismiss-ticket-suggestion"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {ticketCreated && (
              <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/40 border-t border-emerald-200 dark:border-emerald-900 text-sm flex items-center gap-2.5" data-testid="banner-ticket-created">
                <LifeBuoy className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                <span className="flex-1 text-emerald-900 dark:text-emerald-100">
                  Support ticket {ticketCreated !== "created" ? ticketCreated + " " : ""}created — our team will follow up shortly.
                </span>
                <button
                  onClick={() => setTicketCreated(null)}
                  className="p-1 rounded text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {error && (
              <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={clearError} className="underline text-xs">
                  Dismiss
                </button>
              </div>
            )}

            <div className="p-4 border-t border-[#E4E9F2] dark:border-stone-800 shrink-0">
              <div className="max-w-3xl mx-auto flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask the BTS Assistant anything..."
                  rows={1}
                  className="flex-1 px-4 py-3 border border-[#D6DEEC] dark:border-stone-800 rounded-2xl text-[15px] bg-[#F6F8FC] dark:bg-stone-900 text-[#1E293B] dark:text-stone-100 placeholder:text-[#94A3B8] dark:placeholder:text-stone-500 resize-none focus:outline-none focus:bg-white dark:focus:bg-stone-950 focus:border-[#B9C7E2] dark:focus:border-stone-700 focus:ring-2 focus:ring-[#DCE3F0]/70 dark:focus:ring-stone-800/70 min-h-[44px] max-h-[120px] transition-colors shadow-sm"
                  style={{ height: "auto", overflow: "hidden" }}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 120) + "px";
                  }}
                  data-testid="input-message"
                />
                <Button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isStreaming}
                  className="shrink-0 h-[44px] w-[44px] p-0 rounded-2xl bg-[#3B5FA8] hover:bg-[#33538F] text-white dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 disabled:bg-[#CBD5E1] disabled:text-[#94A3B8]"
                  data-testid="button-send"
                >
                  {isStreaming ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
