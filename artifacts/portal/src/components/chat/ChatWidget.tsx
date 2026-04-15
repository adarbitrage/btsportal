import { useState, useEffect, useCallback } from "react";
import { MessageCircle, X, Minimize2, ExternalLink, ArrowUp } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import {
  useChatStatus,
  useChatStream,
  useChatMessages,
  useSavedPrompts,
  useCreateTicketFromChat,
  type ChatMessage,
} from "@/lib/chat-api";
import { useGetCurrentMember } from "@workspace/api-client-react";

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const [showPulse, setShowPulse] = useState(true);

  const { data: member } = useGetCurrentMember();
  const { data: chatStatus } = useChatStatus();
  const { data: savedPrompts } = useSavedPrompts();
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
    if (existingMessages && existingMessages.length > 0 && messages.length === 0) {
      setMessages(existingMessages);
    }
  }, [existingMessages, messages.length, setMessages]);

  useEffect(() => {
    const visited = sessionStorage.getItem("chat-widget-visited");
    if (visited) {
      setShowPulse(false);
    }
  }, []);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasBeenOpened(true);
    setShowPulse(false);
    sessionStorage.setItem("chat-widget-visited", "true");
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleCreateTicket = useCallback(
    (subject: string, description: string) => {
      if (!sessionId) return;
      createTicket.mutate(
        { sessionId, subject, description },
        {
          onSuccess: (data: any) => {
            const ticketMsg = `Support ticket #${data.ticketId} has been created. Our team will follow up with you shortly.`;
            setMessages((prev: ChatMessage[]) => [
              ...prev,
              {
                role: "assistant" as const,
                content: ticketMsg,
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

  if (!hasChatAccess) return null;

  const isLimitReached =
    chatStatus && chatStatus.dailyMessageLimit > 0 && chatStatus.dailyMessageCount >= chatStatus.dailyMessageLimit;

  const limitMessage = isLimitReached
    ? chatStatus?.tier === "basic"
      ? "Daily message limit reached. Upgrade for more messages!"
      : "Daily message limit reached. Resets at midnight."
    : undefined;

  return (
    <>
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Open chat"
        >
          <MessageCircle className="w-6 h-6" />
          {showPulse && (
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-30" />
          )}
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-0 right-0 z-50 sm:bottom-6 sm:right-6 w-full sm:w-[380px] h-full sm:h-[600px] sm:max-h-[80vh] bg-white sm:rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">BTS Assistant</h3>
                <p className="text-[10px] text-muted-foreground">AI-powered help</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link href="/ai-assistant">
                <button
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Open full chat"
                  onClick={() => setIsOpen(false)}
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </Link>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Minimize"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                }}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <ChatMessages
            messages={messages}
            isStreaming={isStreaming}
            onCreateTicket={handleCreateTicket}
            compact
          />

          {error && (
            <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs flex items-center justify-between">
              <span>{error}</span>
              <button onClick={clearError} className="text-destructive/70 hover:text-destructive underline text-xs">
                Dismiss
              </button>
            </div>
          )}

          <div className="p-3 border-t border-border bg-white shrink-0">
            <ChatInput
              onSend={(msg) => sendMessage(msg)}
              onStop={stopStreaming}
              isStreaming={isStreaming}
              disabled={!!isLimitReached}
              disabledMessage={limitMessage}
              savedPrompts={savedPrompts}
              showSavedPrompts={isLifetime}
              compact
            />
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-[10px] text-muted-foreground">
                {chatStatus
                  ? `${chatStatus.dailyMessageCount}/${chatStatus.dailyMessageLimit === -1 ? "∞" : chatStatus.dailyMessageLimit} messages today`
                  : ""}
              </span>
              {isLimitReached && chatStatus?.tier === "basic" && (
                <Link href="/ai-assistant">
                  <span className="text-[10px] text-primary font-medium hover:underline cursor-pointer flex items-center gap-0.5">
                    <ArrowUp className="w-3 h-3" />
                    Open Full Chat
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
