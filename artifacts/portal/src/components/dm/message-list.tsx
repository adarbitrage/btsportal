import { useEffect, useRef } from "react";
import { type DMMessage } from "@/lib/dm-api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface MessageListProps {
  messages: DMMessage[];
  otherUserName: string;
  isLoading?: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

export function MessageList({ messages, otherUserName, isLoading }: MessageListProps) {
  const { user } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn("flex gap-2", i % 2 === 0 ? "justify-start" : "justify-end")}
          >
            <Skeleton className="h-10 w-48 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground text-sm">
        No messages yet. Say hello!
      </div>
    );
  }

  const otherInitial = otherUserName.charAt(0).toUpperCase();

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.map((msg) => {
        const isMine = msg.senderId === user?.id;
        return (
          <div
            key={msg.id}
            className={cn(
              "flex gap-2 items-end",
              isMine ? "justify-end" : "justify-start",
            )}
          >
            {!isMine && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                {otherInitial}
              </div>
            )}
            <div
              className={cn(
                "max-w-[75%] flex flex-col gap-0.5",
                isMine ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "px-3 py-2 rounded-2xl text-sm leading-relaxed break-words",
                  isMine
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm",
                )}
              >
                {msg.body}
              </div>
              <span className="text-[10px] text-muted-foreground px-1">
                {formatTime(msg.createdAt)}
              </span>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
