import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Bell, AlertTriangle, Webhook, DollarSign } from "lucide-react";
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

  const iconMap: Record<string, typeof AlertTriangle> = {
    sla_breach: AlertTriangle,
    sync_failure: Webhook,
    payout_approval: DollarSign,
  };

  const severityColors: Record<string, string> = {
    high: "text-red-600",
    medium: "text-amber-600",
    low: "text-blue-600",
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" className="relative p-2" onClick={() => setOpen(!open)}>
        <Bell className="w-4 h-4" />
        {notifications.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {notifications.length}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-white border rounded-lg shadow-lg z-50">
          <div className="p-3 border-b">
            <p className="text-sm font-semibold">Notifications</p>
          </div>
          {notifications.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No notifications</div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y">
              {notifications.map((n) => {
                const Icon = iconMap[n.type] || AlertTriangle;
                return (
                  <button
                    key={n.id}
                    onClick={() => { if (n.link) navigate(n.link); setOpen(false); }}
                    className="w-full flex items-start gap-3 p-3 hover:bg-muted/50 text-left transition-colors"
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${severityColors[n.severity] || ""}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    </div>
                    <Badge variant={n.severity === "high" ? "destructive" : "secondary"} className="text-[10px] shrink-0">{n.severity}</Badge>
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
