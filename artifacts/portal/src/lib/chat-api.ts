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
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return res;
}

export interface ChatMessage {
  id?: number;
  sessionId?: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface ChatSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStatus {
  hasAccess: boolean;
  dailyLimit: number;
  messagesUsedToday: number;
  messagesRemaining: number;
  resetTime: string;
  maxOutputTokens: number;
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
      const res = await chatFetch("/chat/sessions?limit=50");
      const data = await res.json();
      return Array.isArray(data) ? data : (data.sessions ?? []);
    },
  });
}

export function useChatMessages(sessionId: number | null) {
  return useQuery<ChatMessage[]>({
    queryKey: ["chat", "messages", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await chatFetch(`/chat/sessions/${sessionId}`);
      const data = await res.json();
      return data.messages ?? [];
    },
    enabled: !!sessionId,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) => {
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
        method: "PATCH",
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
    mutationFn: async (data: { sessionId: number; subject: string }) => {
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
  sessionId: number | null;
  error: string | null;
  suggestTicket: boolean;
}

export function useChatStream() {
  const [state, setState] = useState<StreamingState>({
    messages: [],
    isStreaming: false,
    sessionId: null,
    error: null,
    suggestTicket: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const setMessages = useCallback(
    (msgsOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setState((s) => ({
        ...s,
        messages: typeof msgsOrUpdater === "function" ? msgsOrUpdater(s.messages) : msgsOrUpdater,
      }));
    },
    [],
  );

  const setSessionId = useCallback((id: number | null) => {
    setState((s) => ({ ...s, sessionId: id, suggestTicket: false }));
  }, []);

  const sendMessage = useCallback(
    async (content: string, existingSessionId?: number | null) => {
      const startingSessionId = existingSessionId ?? state.sessionId;
      const userMessage: ChatMessage = {
        role: "user",
        content,
        sessionId: startingSessionId ?? undefined,
        createdAt: new Date().toISOString(),
      };

      setState((s) => ({
        ...s,
        messages: [...s.messages, userMessage],
        isStreaming: true,
        error: null,
        suggestTicket: false,
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
            sessionId: startingSessionId ?? undefined,
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
        let newSessionId = startingSessionId ?? null;
        let buffer = "";

        const processLine = (line: string) => {
          if (!line.startsWith("data: ")) return;
          const data = line.slice(6).trim();
          if (!data) return;

          try {
            const event = JSON.parse(data);

            if (typeof event.sessionId === "number") {
              newSessionId = event.sessionId;
              setState((s) => ({ ...s, sessionId: event.sessionId }));
            }
            if (typeof event.content === "string" && event.content.length > 0) {
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
                    sessionId: newSessionId ?? undefined,
                    createdAt: new Date().toISOString(),
                  });
                }
                return { ...s, messages: msgs };
              });
            }
            if (event.done) {
              if (event.suggestTicket) {
                setState((s) => ({ ...s, suggestTicket: true }));
              }
              queryClient.invalidateQueries({ queryKey: ["chat", "status"] });
              queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
            }
            if (event.error) {
              throw new Error(typeof event.error === "string" ? event.error : "Stream error");
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
    [state.sessionId, queryClient],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, isStreaming: false }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const dismissTicketSuggestion = useCallback(() => {
    setState((s) => ({ ...s, suggestTicket: false }));
  }, []);

  return {
    ...state,
    sendMessage,
    stopStreaming,
    setMessages,
    setSessionId,
    clearError,
    dismissTicketSuggestion,
  };
}
