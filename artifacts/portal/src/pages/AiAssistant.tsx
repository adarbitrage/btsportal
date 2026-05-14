import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Send, Bot, User, Trash2, Plus, MessageCircle,
  Loader2, AlertCircle, Menu, X
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

const API_BASE = `${import.meta.env.BASE_URL}api/ai-chat`;

interface Conversation {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
}

function groupByDate(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7 = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Last 7 Days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of conversations) {
    const d = new Date(c.updatedAt || c.createdAt);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= last7) groups[2].items.push(c);
    else groups[3].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

export default function AiAssistant() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + "/conversations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadMessages = useCallback(async (convId: number) => {
    try {
      const res = await fetch(API_BASE + `/conversations/${convId}/messages`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch {}
  }, []);

  const handleSelectConv = (conv: Conversation) => {
    setActiveConv(conv.id);
    loadMessages(conv.id);
    setMobileSidebar(false);
    setError(null);
  };

  const handleNewChat = () => {
    setActiveConv(null);
    setMessages([]);
    setInput("");
    setError(null);
    setMobileSidebar(false);
    inputRef.current?.focus();
  };

  const handleDeleteConv = async (convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(API_BASE + `/conversations/${convId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConv === convId) {
        setActiveConv(null);
        setMessages([]);
      }
    } catch {}
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setError(null);

    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);

    let convId = activeConv;

    try {
      if (!convId) {
        const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        const res = await fetch(API_BASE + "/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error("Failed to create conversation");
        const conv = await res.json();
        convId = conv.id;
        setActiveConv(conv.id);
        setConversations((prev) => [conv, ...prev]);
      }

      setIsStreaming(true);
      const assistantMsg: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMsg]);

      const abort = new AbortController();
      abortRef.current = abort;

      const res = await fetch(API_BASE + `/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error("Failed to send message");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === "assistant") {
                      updated[updated.length - 1] = {
                        ...last,
                        content: last.content + data.content,
                      };
                    }
                    return updated;
                  });
                }
                if (data.error) {
                  setError(data.error);
                }
              } catch {}
            }
          }
        }
      }

      fetchConversations();
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Something went wrong");
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const grouped = groupByDate(conversations);
  const activeTitle = conversations.find((c) => c.id === activeConv)?.title || "BTS AI Assistant";

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <Button onClick={handleNewChat} className="w-full gap-2" size="sm" data-testid="button-new-chat">
          <Plus className="w-4 h-4" />
          New Chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {grouped.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label}
            </p>
            {group.items.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-secondary/50 transition-colors ${
                  activeConv === conv.id ? "bg-secondary" : ""
                }`}
                data-testid={`item-conversation-${conv.id}`}
              >
                <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm text-foreground truncate">{conv.title}</span>
                <button
                  onClick={(e) => handleDeleteConv(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                  data-testid={`button-delete-conversation-${conv.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground px-4">
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
          <p className="text-muted-foreground">
            Ask anything about your mentorship, tools, campaigns, or strategies. Trained
            on BTS coaching sessions, Q&A articles, and your complete tool documentation.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden flex h-[calc(100vh-14rem)] md:h-[calc(100vh-11rem)] min-h-[360px] md:min-h-[480px]">
          <div className="hidden md:flex w-64 border-r border-border bg-background flex-col shrink-0">
            {sidebarContent}
          </div>

          {mobileSidebar && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setMobileSidebar(false)} />
              <div className="absolute left-0 top-0 bottom-0 w-64 bg-card shadow-xl flex flex-col">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <h3 className="font-semibold text-sm">Chat History</h3>
                  <button onClick={() => setMobileSidebar(false)} className="p-1 rounded-md hover:bg-secondary">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {sidebarContent}
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
              <button
                onClick={() => setMobileSidebar(true)}
                className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                data-testid="button-mobile-history"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-foreground" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-foreground text-sm truncate">{activeTitle}</h2>
                  <p className="text-[10px] text-muted-foreground">Powered by your BTS knowledge base</p>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <Bot className="w-8 h-8 text-foreground" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">BTS AI Assistant</h3>
                  <p className="text-sm text-muted-foreground max-w-md mb-6">
                    Ask me anything about your mentorship, tools, campaigns, or strategies. I'm trained on BTS coaching sessions, Q&A articles, and your complete tool documentation.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
                    {[
                      "How do I set up my first DIYTrax campaign?",
                      "What are the live coaching call times?",
                      "How do I book a Concierge session?",
                      "What is MetricMover and how do I use it?",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setInput(suggestion);
                          setTimeout(() => inputRef.current?.focus(), 100);
                        }}
                        className="text-left p-3 rounded-xl border border-border hover:border-foreground/40 hover:bg-secondary/50 text-sm text-muted-foreground transition-colors"
                        data-testid={`button-suggestion-${suggestion.slice(0, 20)}`}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                          <Bot className="w-4 h-4 text-foreground" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary/50 text-foreground"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <div className="prose prose-sm max-w-none [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-0.5 [&_a]:text-primary [&_a]:underline [&_strong]:text-foreground [&_code]:bg-secondary [&_code]:px-1 [&_code]:rounded">
                            <ReactMarkdown>{msg.content || (isStreaming && i === messages.length - 1 ? "..." : "")}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                          <User className="w-4 h-4 text-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                  {isStreaming && messages[messages.length - 1]?.content === "" && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-foreground" />
                      </div>
                      <div className="bg-secondary/50 rounded-2xl px-4 py-3">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {error && (
              <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="underline text-xs">
                  Dismiss
                </button>
              </div>
            )}

            <div className="p-4 border-t border-border bg-card shrink-0">
              <div className="max-w-3xl mx-auto flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask the BTS Assistant anything..."
                  rows={1}
                  className="flex-1 px-4 py-3 border border-border rounded-xl text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/40 min-h-[44px] max-h-[120px]"
                  style={{ height: "auto", overflow: "hidden" }}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 120) + "px";
                  }}
                  data-testid="input-message"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  className="shrink-0 h-[44px] w-[44px] p-0 rounded-xl"
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
