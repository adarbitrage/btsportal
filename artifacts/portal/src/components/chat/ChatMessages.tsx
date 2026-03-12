import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";
import type { ChatMessage } from "@/lib/chat-api";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onCreateTicket?: (subject: string, description: string) => void;
  compact?: boolean;
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary" />
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

export function ChatMessages({ messages, isStreaming, onCreateTicket, compact }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-sm mb-1">BTS AI Assistant</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ask questions about your training, membership, account, or anything BTS-related.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      {messages.map((msg, idx) => (
        <div key={idx} className={`flex items-start gap-3 py-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
          {msg.role === "assistant" ? (
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-4 h-4 text-primary" />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <div
            className={`${compact ? "max-w-[85%]" : "max-w-[75%]"} ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5"
                : "bg-secondary/50 rounded-2xl rounded-tl-md px-4 py-2.5"
            }`}
          >
            {msg.role === "assistant" ? (
              <ChatMarkdown content={msg.content} onCreateTicket={onCreateTicket} />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            )}
          </div>
        </div>
      ))}
      {isStreaming && messages[messages.length - 1]?.role !== "assistant" && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
