const API_BASE = `${import.meta.env.BASE_URL}api`;

async function dmFetch(path: string, options?: RequestInit) {
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
  return res.json();
}

export interface DMOtherParty {
  id: number;
  name: string;
  role: string;
}

export interface DMThread {
  id: number;
  otherParty: DMOtherParty;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DMMessage {
  id: number;
  threadId: number;
  senderId: number;
  body: string;
  createdAt: string;
}

export interface DMRecipient {
  id: number;
  name: string;
  role: string;
  email: string;
}

export async function fetchThreads(): Promise<DMThread[]> {
  const data = await dmFetch("/dm/threads");
  return data.threads;
}

export async function fetchMessages(threadId: number): Promise<DMMessage[]> {
  const data = await dmFetch(`/dm/threads/${threadId}/messages`);
  const messages: DMMessage[] = data.messages;
  return [...messages].reverse();
}

export async function sendMessage(threadId: number, body: string): Promise<DMMessage> {
  const data = await dmFetch(`/dm/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return data.message;
}

export async function markThreadRead(threadId: number): Promise<void> {
  await dmFetch(`/dm/threads/${threadId}/read`, { method: "POST" });
}

export async function fetchRecipients(): Promise<DMRecipient[]> {
  const data = await dmFetch("/dm/recipients");
  return data.recipients;
}

export async function fetchUnreadCount(): Promise<{ unreadCount: number }> {
  return dmFetch("/dm/unread-count");
}

export async function createThread(recipientId: number): Promise<{ id: number }> {
  const data = await dmFetch("/dm/threads", {
    method: "POST",
    body: JSON.stringify({ recipient_user_id: recipientId }),
  });
  return data.thread;
}
