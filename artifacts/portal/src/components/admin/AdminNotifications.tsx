import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Bell,
  AlertTriangle,
  Webhook,
  DollarSign,
  Clock,
  Inbox,
  ServerCrash,
  ShieldOff,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminPanelApi } from "@/lib/admin-panel-api";

// Cap how many notifications the bell dropdown loads per 60s poll. During a
// sync storm or runaway alerter the unbounded payload can grow into the
// hundreds, which is wasteful on the wire and makes a 320px popover
// effectively unusable. The API returns a `total` so the badge can still
// reflect the true scale of the incident even when items are truncated, and
// we surface a footer link to the full audit log so admins can see the rest
// when they need it.
const NOTIFICATIONS_PAGE_SIZE = 50;

export function AdminNotifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminPanelApi.getNotifications(NOTIFICATIONS_PAGE_SIZE);
        setNotifications(data.notifications);
        setTotal(data.total);
      } catch { }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keep this map in sync with the notification `type` values emitted by
  // GET /api/admin/notifications (artifacts/api-server/src/routes/admin-panel.ts).
  // When the backend adds a new notification type, add a matching icon here so
  // admins can scan the dropdown at a glance. The fallback below keeps things
  // working until the entry is added.
  const iconMap: Record<string, typeof AlertTriangle> = {
    sla_breach: Clock,
    sync_failure: Webhook,
    payout_approval: DollarSign,
    ticket_backlog: Inbox,
    queue_fallback: ServerCrash,
    signup_challenge_disabled: ShieldOff,
    production_env_secret_missing: KeyRound,
  };

  const severityColors: Record<string, string> = {
    high: "text-red-600",
    medium: "text-amber-600",
    low: "text-blue-600",
  };

  // Use the server-reported total (not the truncated `notifications.length`)
  // so the badge keeps reflecting the true scale of the incident — otherwise
  // a 200-item storm would silently look like a quiet 50-item day to anyone
  // glancing at the bell.
  const count = total;
  const displayCount = count > 99 ? "99+" : String(count);
  const ariaLabel = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  const truncated = count > notifications.length;

  return (
    <div ref={ref} className="relative" data-testid="admin-notifications">
      <Button
        variant="ghost"
        size="sm"
        className="relative p-2"
        onClick={() => setOpen(!open)}
        data-testid="button-admin-notifications"
        aria-label={ariaLabel}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] leading-none rounded-full flex items-center justify-center"
            data-testid="badge-admin-notifications-count"
            aria-hidden="true"
          >
            {displayCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-80 bg-white border rounded-lg shadow-lg z-50"
          data-testid="dropdown-admin-notifications"
        >
          <div className="p-3 border-b">
            <p className="text-sm font-semibold">Notifications</p>
          </div>
          {notifications.length === 0 ? (
            <div
              className="p-4 text-sm text-muted-foreground text-center"
              data-testid="text-admin-notifications-empty"
            >
              No notifications
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto divide-y">
                {notifications.map((n) => {
                  const Icon = iconMap[n.type] || AlertTriangle;
                  return (
                    <button
                      key={n.id}
                      onClick={() => { if (n.link) navigate(n.link); setOpen(false); }}
                      className="w-full flex items-start gap-3 p-3 hover:bg-muted/50 text-left transition-colors"
                      data-testid={`notification-item-${n.id}`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${severityColors[n.severity] || ""}`} />
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-medium"
                          data-testid={`notification-title-${n.id}`}
                        >
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                      </div>
                      <Badge
                        variant={n.severity === "high" ? "destructive" : "secondary"}
                        className="text-[10px] shrink-0"
                        data-testid={`notification-severity-${n.id}`}
                      >
                        {n.severity}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              {truncated && (
                <div
                  className="px-3 py-2 text-[11px] text-muted-foreground border-t bg-muted/30"
                  data-testid="text-admin-notifications-truncation"
                >
                  Showing the {notifications.length} most recent of {count}.
                </div>
              )}
            </>
          )}
          {/* Always offer the audit-log escape hatch — even when nothing is
              truncated, admins often want to dig into the full history of
              what fired. */}
          <button
            type="button"
            onClick={() => { navigate("/admin/audit-log"); setOpen(false); }}
            className="w-full px-3 py-2 text-xs text-center font-medium text-primary hover:bg-muted/50 border-t transition-colors"
            data-testid="link-admin-notifications-view-all"
          >
            View all in audit log
          </button>
        </div>
      )}
    </div>
  );
}
