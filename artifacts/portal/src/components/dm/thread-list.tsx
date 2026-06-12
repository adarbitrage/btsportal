import { type DMThread } from "@/lib/dm-api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

interface ThreadListProps {
  threads: DMThread[];
  isLoading?: boolean;
  activeThreadId?: number;
}

function formatRelativeTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ThreadList({ threads, isLoading, activeThreadId }: ThreadListProps) {
  const { user } = useAuth();
  const threadBasePath = user?.role === "coach" ? "/coach/messages" : "/dm";

  if (isLoading) {
    return (
      <div className="divide-y">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return null;
  }

  return (
    <div className="divide-y">
      {threads.map((thread) => {
        const isActive = thread.id === activeThreadId;
        const hasUnread = thread.unreadCount > 0;
        const initials = thread.otherParty.name.charAt(0).toUpperCase();

        return (
          <Link key={thread.id} href={`${threadBasePath}/${thread.id}`}>
            <div
              className={cn(
                "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors",
                isActive && "bg-muted",
              )}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm truncate",
                      hasUnread
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground/80",
                    )}
                  >
                    {thread.otherParty.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelativeTime(thread.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <p
                    className={cn(
                      "text-xs truncate",
                      hasUnread ? "text-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    {thread.lastMessagePreview ?? "No messages yet"}
                  </p>
                  {hasUnread && (
                    <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-semibold bg-destructive text-destructive-foreground shrink-0">
                      {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
