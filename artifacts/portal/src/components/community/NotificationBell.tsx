import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCommunityNotifications, useMarkAllNotificationsRead } from "@/hooks/use-community";
import { Bell, MessageSquare, Flame, AtSign, Award, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { CommunityNotification } from "@/lib/community-api";

const notificationIcons: Record<string, typeof Bell> = {
  reaction: Flame,
  comment: MessageSquare,
  reply: MessageSquare,
  mention: AtSign,
  badge: Award,
};

function NotificationItem({ notification }: { notification: CommunityNotification }) {
  const Icon = notificationIcons[notification.type] ?? Bell;
  let href = "/community";
  if (notification.postId) {
    href = `/community#post-${notification.postId}`;
    if (notification.commentId) {
      href = `/community#comment-${notification.commentId}`;
    }
  }

  return (
    <Link href={href}>
      <div
        className={cn(
          "flex items-start gap-3 p-3 hover:bg-muted/50 transition-colors cursor-pointer border-b border-border/30 last:border-0",
          !notification.isRead && "bg-primary/[0.03]"
        )}
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          notification.type === "reaction" ? "bg-orange-100 text-orange-500" :
          notification.type === "badge" ? "bg-amber-100 text-amber-600" :
          "bg-primary/10 text-primary"
        )}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm leading-snug", !notification.isRead && "font-medium")}>
            {notification.message}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
          </p>
        </div>
        {!notification.isRead && (
          <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
        )}
      </div>
    </Link>
  );
}

export function NotificationBell() {
  const { data } = useCommunityNotifications();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              className="h-7 text-xs gap-1"
            >
              <Check className="w-3 h-3" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="p-6 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => <NotificationItem key={n.id} notification={n} />)
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationBadgeCount() {
  const { data } = useCommunityNotifications();
  const unreadCount = data?.unreadCount ?? 0;
  if (unreadCount === 0) return null;
  return (
    <span className="ml-auto bg-primary text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
      {unreadCount > 9 ? "9+" : unreadCount}
    </span>
  );
}
