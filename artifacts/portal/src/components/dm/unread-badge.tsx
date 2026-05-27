import { useUnreadCount } from "@/hooks/use-dm";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface UnreadBadgeProps {
  className?: string;
}

export function UnreadBadge({ className }: UnreadBadgeProps) {
  const { user } = useAuth();
  const { data } = useUnreadCount();

  if (user?.role === "coach") return null;

  const count = data?.unreadCount ?? 0;
  if (count === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] font-semibold leading-none bg-destructive text-destructive-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
