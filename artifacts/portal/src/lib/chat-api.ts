import { useCallback, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function chatFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res;
}

export interface ChatMessage {
  id?: number;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  tokenCount?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatStatus {
  dailyMessageCount: number;
  dailyMessageLimit: number;
  tier: string;
  chatEnabled: boolean;
}

export interface SavedPrompt {
  id: number;
  title: string;
  content: string;
  createdAt: string;
}

export function useChatStatus() {
  return useQuery<ChatStatus>({
    queryKey: ["chat", "status"],
    queryFn: async () => {
      const res = await chatFetch("/chat/status");
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useChatSessions() {
  return useQuery<ChatSession[]>({
    queryKey: ["chat", "sessions"],
    queryFn: async () => {
      const res = await chatFetch("/chat/sessions");
      return res.json();
    },
  });
}

export function useChatMessages(sessionId: string | null) {
  return useQuery<ChatMessage[]>({
    queryKey: ["chat", "messages", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await chatFetch(`/chat/sessions/${sessionId}/messages`);
      return res.json();
    },
    enabled: !!sessionId,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      await chatFetch(`/chat/sessions/${sessionId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
  });
}

export function useSavedPrompts() {
  return useQuery<SavedPrompt[]>({
    queryKey: ["chat", "prompts"],
    queryFn: async () => {
      const res = await chatFetch("/chat/prompts");
      return res.json();
    },
  });
}

export function useCreatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title: string; content: string }) => {
      const res = await chatFetch("/chat/prompts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "prompts"] });
    },
  });
}

export function useUpdatePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; title: string; content: string }) => {
      const res = await chatFetch(`/chat/prompts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "prompts"] });
    },
  });
}

export function useDeletePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await chatFetch(`/chat/prompts/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "prompts"] });
    },
  });
}

export function useCreateTicketFromChat() {
  return useMutation({
    mutationFn: async (data: { sessionId: string; subject: string; description: string }) => {
      const res = await chatFetch("/chat/create-ticket", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.json();
    },
  });
}

export interface StreamingState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId: string | null;
  error: string | null;
}

export function useChatStream() {
  const [state, setState] = useState<StreamingState>({
    messages: [],
    isStreaming: false,
    sessionId: null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const setMessages = useCallback((msgsOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setState((s) => ({
      ...s,
      messages: typeof msgsOrUpdater === "function" ? msgsOrUpdater(s.messages) : msgsOrUpdater,
    }));
  }, []);

  const setSessionId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, sessionId: id }));
  }, []);

  const sendMessage = useCallback(
    async (content: string, existingSessionId?: string | null) => {
      const userMessage: ChatMessage = {
        role: "user",
        content,
        sessionId: existingSessionId || state.sessionId || "",
        createdAt: new Date().toISOString(),
      };

      setState((s) => ({
        ...s,
        messages: [...s.messages, userMessage],
        isStreaming: true,
        error: null,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/chat`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            sessionId: existingSessionId || state.sessionId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Failed to send message" }));
          throw new Error(errData.error || "Failed to send message");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let assistantContent = "";
        let newSessionId = existingSessionId || state.sessionId;
        let buffer = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6).trim();
          if (!data) return;

          try {
            const event = JSON.parse(data);

            if (event.type === "session") {
              newSessionId = event.sessionId;
              setState((s) => ({ ...s, sessionId: event.sessionId }));
            } else if (event.type === "chunk") {
              assistantContent += event.content;
              setState((s) => {
                const msgs = [...s.messages];
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg?.role === "assistant") {
                  msgs[msgs.length - 1] = { ...lastMsg, content: assistantContent };
                } else {
                  msgs.push({
                    role: "assistant",
                    content: assistantContent,
                    sessionId: newSessionId || "",
                    createdAt: new Date().toISOString(),
                  });
                }
                return { ...s, messages: msgs };
              });
            } else if (event.type === "done") {
              queryClient.invalidateQueries({ queryKey: ["chat", "status"] });
              queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
            } else if (event.type === "error") {
              throw new Error(event.message || "Stream error");
            }
          } catch (e) {
            if (e instanceof SyntaxError) return;
            throw e;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            processLine(line);
          }
        }

        if (buffer.trim()) {
          processLine(buffer);
        }

        setState((s) => ({ ...s, isStreaming: false }));
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: err.message || "Something went wrong",
        }));
      }
    },
    [state.sessionId, queryClient]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, isStreaming: false }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    sendMessage,
    stopStreaming,
    setMessages,
    setSessionId,
    clearError,
  };
}
