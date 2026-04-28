import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, Loader2, Mail, MessageSquare, RefreshCw, Search } from "lucide-react";

export type FlexyResetEvent = {
  id: number;
  createdAt: string | null;
  actionType: "regenerate_password" | "notify_password" | string;
  actorId: number | null;
  actorEmail: string | null;
  memberId: number | null;
  memberEmail: string | null;
  description: string;
  channels: {
    email?: { status: string; reason?: string };
    sms?: { status: string; reason?: string };
  } | null;
};

export async function fetchFlexyResetHistory(params: {
  userId?: number;
  actorEmail?: string;
  limit?: number;
}): Promise<FlexyResetEvent[]> {
  const qs = new URLSearchParams();
  if (params.userId) qs.set("userId", String(params.userId));
  if (params.actorEmail) qs.set("actorEmail", params.actorEmail);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(
    `/api/admin/apps/flexy/password-reset-history?${qs.toString()}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to load reset history");
  }
  const data = (await res.json()) as { events?: FlexyResetEvent[] };
  return data.events ?? [];
}

function channelStatusClass(status: string): string {
  if (status === "sent") return "bg-green-50 text-green-700 border-green-200";
  if (status === "skipped") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export function FlexyResetHistoryItem({ event }: { event: FlexyResetEvent }) {
  const when = event.createdAt ? new Date(event.createdAt).toLocaleString() : "Unknown time";
  const actor = event.actorEmail ?? (event.actorId ? `Admin #${event.actorId}` : "System");
  const isNotify = event.actionType === "notify_password";
  const channels = event.channels ?? {};
  const channelEntries = (
    [
      ["email", channels.email, Mail],
      ["sms", channels.sms, MessageSquare],
    ] as const
  ).filter(([, c]) => !!c);

  return (
    <li
      className="rounded-md border bg-white px-3 py-2 text-xs space-y-1"
      data-testid={`flexy-history-event-${event.id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={
            isNotify
              ? "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"
              : "bg-purple-50 text-purple-700 border-purple-200 text-[10px]"
          }
        >
          {isNotify ? "Notification sent" : "Password regenerated"}
        </Badge>
        <span className="text-muted-foreground">{when}</span>
      </div>
      <p className="text-muted-foreground">
        Initiated by <span className="font-medium text-foreground">{actor}</span>
      </p>
      {isNotify && channelEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {channelEntries.map(([key, channel, Icon]) => (
            <Badge
              key={key}
              variant="outline"
              className={`text-[10px] ${channelStatusClass(channel!.status)}`}
            >
              <Icon className="w-3 h-3 mr-1" />
              {key === "sms" ? "SMS" : "Email"}: {channel!.status}
              {channel!.reason ? ` (${channel!.reason})` : ""}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}

type FlexyResetHistoryPanelProps = {
  userId: number | null | undefined;
  reloadKey?: number;
  showActorFilter?: boolean;
  headerLabel?: string;
  containerTestId?: string;
  itemTestIdPrefix?: string;
};

export function FlexyResetHistoryPanel({
  userId,
  reloadKey = 0,
  showActorFilter = true,
  headerLabel = "Recent password resets for this member",
  containerTestId = "flexy-reset-history",
  itemTestIdPrefix = "flexy-history",
}: FlexyResetHistoryPanelProps) {
  const [history, setHistory] = useState<FlexyResetEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState("");
  const [internalReload, setInternalReload] = useState(0);

  useEffect(() => {
    if (!userId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const trimmed = actorFilter.trim();
    fetchFlexyResetHistory({
      userId,
      actorEmail: trimmed.length > 0 ? trimmed : undefined,
      limit: 25,
    })
      .then((events) => {
        if (!cancelled) setHistory(events);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, actorFilter, reloadKey, internalReload]);

  return (
    <div className="space-y-2" data-testid={containerTestId}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <History className="w-3.5 h-3.5" />
          {headerLabel}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setInternalReload((v) => v + 1)}
          disabled={loading}
          data-testid={`button-refresh-${itemTestIdPrefix}`}
          aria-label="Refresh password reset history"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {showActorFilter && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Filter by initiator email..."
            className="pl-8 h-8 text-xs"
            data-testid={`input-${itemTestIdPrefix}-actor`}
          />
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history...
        </div>
      ) : error ? (
        <p className="text-xs text-red-700 py-2">{error}</p>
      ) : history.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          {actorFilter.trim().length > 0
            ? "No password reset events for this initiator."
            : "No password reset events recorded for this member yet."}
        </p>
      ) : (
        <ul className="space-y-2" data-testid={`list-${itemTestIdPrefix}`}>
          {history.map((event) => (
            <FlexyResetHistoryItem key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}
