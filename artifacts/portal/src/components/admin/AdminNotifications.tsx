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

export function AdminNotifications() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminPanelApi.getNotifications();
        setNotifications(data);
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

  return (
    <div ref={ref} className="relative" data-testid="admin-notifications">
      <Button
        variant="ghost"
        size="sm"
        className="relative p-2"
        onClick={() => setOpen(!open)}
        data-testid="button-admin-notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {notifications.length > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center"
            data-testid="badge-admin-notifications-count"
          >
            {notifications.length}
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
          )}
        </div>
      )}
    </div>
  );
}
