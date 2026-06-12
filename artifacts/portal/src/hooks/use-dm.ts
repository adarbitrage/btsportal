import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchThreads,
  fetchMessages,
  sendMessage,
  markThreadRead,
  fetchRecipients,
  fetchUnreadCount,
  createThread,
} from "@/lib/dm-api";

export function useThreads() {
  return useQuery({
    queryKey: ["dm", "threads"],
    queryFn: fetchThreads,
    refetchInterval: 30_000,
  });
}

export function useMessages(threadId: number, focused = true) {
  return useQuery({
    queryKey: ["dm", "messages", threadId],
    queryFn: () => fetchMessages(threadId),
    enabled: threadId > 0,
    refetchInterval: focused ? 10_000 : false,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }: { threadId: number; body: string }) =>
      sendMessage(threadId, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dm", "messages", variables.threadId] });
      queryClient.invalidateQueries({ queryKey: ["dm", "threads"] });
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: number) => markThreadRead(threadId),
    onSuccess: (_data, threadId) => {
      queryClient.invalidateQueries({ queryKey: ["dm", "threads"] });
      queryClient.invalidateQueries({ queryKey: ["dm", "unread-count"] });
      queryClient.setQueryData<import("@/lib/dm-api").DMThread[]>(
        ["dm", "threads"],
        (old) =>
          old?.map((t) => (t.id === threadId ? { ...t, unreadCount: 0 } : t)) ?? old,
      );
    },
  });
}

export function useRecipients() {
  return useQuery({
    queryKey: ["dm", "recipients"],
    queryFn: fetchRecipients,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["dm", "unread-count"],
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
  });
}

export function useCreateThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recipientId, body }: { recipientId: number; body: string }) =>
      createThread(recipientId).then(async (thread) => {
        await sendMessage(thread.id, body);
        return thread;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm", "threads"] });
      queryClient.invalidateQueries({ queryKey: ["dm", "unread-count"] });
    },
  });
}

export function useStartThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipientId: number) => createThread(recipientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm", "threads"] });
    },
  });
}
