import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
} from "lucide-react";
import { FlexyResetHistoryPanel } from "@/components/admin/FlexyResetHistory";

export type FlexyLookup = {
  member: {
    id: number;
    name: string;
    email: string;
    hasPhone: boolean;
    smsOptIn: boolean;
  };
  flexy: {
    status: string;
    email: string | null;
    locationId: string | null;
    hasStaffUser: boolean;
    updatedAt: string | null;
  };
};

export type NotifyChannelStatus = "sent" | "skipped" | "failed";
export type RegenerateResponse = {
  email: string;
  newPassword: string;
  notifications: {
    email: { requested: boolean; status: NotifyChannelStatus; reason?: string };
    sms: { requested: boolean; status: NotifyChannelStatus; reason?: string };
  };
};

export async function fetchFlexyLookup(userId: number): Promise<FlexyLookup> {
  const res = await fetch(`/api/admin/apps/flexy/lookup/${userId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to look up Flexy details");
  }
  return res.json();
}

export async function regenerateFlexyPassword(
  userId: number,
  notify: { notifyEmail: boolean; notifySms: boolean },
): Promise<RegenerateResponse> {
  const res = await fetch(`/api/admin/apps/flexy/regenerate-password/${userId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notify),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to regenerate password");
  }
  return res.json();
}

export function FlexyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    installed: { label: "Installed", className: "bg-green-50 text-green-700 border-green-200" },
    installing: { label: "Installing", className: "bg-blue-50 text-blue-700 border-blue-200" },
    uninstalling: { label: "Uninstalling", className: "bg-orange-50 text-orange-700 border-orange-200" },
    install_failed: { label: "Install failed", className: "bg-red-50 text-red-700 border-red-200" },
    not_installed: { label: "Not installed", className: "bg-muted text-muted-foreground" },
  };
  const entry = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={`text-xs ${entry.className}`}>
      {entry.label}
    </Badge>
  );
}

type FlexyStatusSummaryProps = {
  lookup: FlexyLookup;
  testIdPrefix?: string;
};

export function FlexyStatusSummary({
  lookup,
  testIdPrefix = "flexy",
}: FlexyStatusSummaryProps) {
  const status = lookup.flexy.status ?? "not_installed";
  return (
    <div
      className="flex items-center gap-2 flex-wrap"
      data-testid={`${testIdPrefix}-status-summary`}
    >
      <span className="text-xs text-muted-foreground">Status:</span>
      <FlexyStatusBadge status={status} />
      {lookup.flexy.hasStaffUser ? (
        <Badge
          variant="outline"
          className="bg-green-50 text-green-700 border-green-200 text-[10px]"
          data-testid={`badge-${testIdPrefix}-staff-user`}
        >
          Staff user linked
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
          data-testid={`badge-${testIdPrefix}-staff-user`}
        >
          No staff user
        </Badge>
      )}
      {lookup.member.hasPhone ? (
        lookup.member.smsOptIn ? (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 text-[10px]"
            data-testid={`badge-${testIdPrefix}-sms`}
          >
            SMS opt-in
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"
            data-testid={`badge-${testIdPrefix}-sms`}
          >
            Phone on file, no SMS opt-in
          </Badge>
        )
      ) : (
        <Badge
          variant="outline"
          className="bg-muted text-muted-foreground text-[10px]"
          data-testid={`badge-${testIdPrefix}-sms`}
        >
          No phone on file
        </Badge>
      )}
    </div>
  );
}

type FlexyRegeneratePanelProps = {
  userId: number;
  showHistory?: boolean;
  historyContainerTestId?: string;
  historyItemTestIdPrefix?: string;
  historyHeaderLabel?: string;
  showHistoryActorFilter?: boolean;
  initialLookup?: FlexyLookup | null;
};

export function FlexyRegeneratePanel({
  userId,
  showHistory = true,
  historyContainerTestId,
  historyItemTestIdPrefix,
  historyHeaderLabel,
  showHistoryActorFilter = true,
  initialLookup = null,
}: FlexyRegeneratePanelProps) {
  const { toast } = useToast();
  const [lookup, setLookup] = useState<FlexyLookup | null>(
    initialLookup && initialLookup.member.id === userId ? initialLookup : null,
  );
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [lastNotifications, setLastNotifications] = useState<RegenerateResponse["notifications"] | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const seeded =
      initialLookup && initialLookup.member.id === userId ? initialLookup : null;
    setLookup(seeded);
    setLookupError(null);
    setNewPassword(null);
    setLastNotifications(null);
    setNotifyEmail(true);
    setNotifySms(false);
    if (seeded) {
      setLookupLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLookupLoading(true);
    fetchFlexyLookup(userId)
      .then((result) => {
        if (!cancelled) setLookup(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLookupError(err instanceof Error ? err.message : "Lookup failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, initialLookup]);

  const flexyStatus = lookup?.flexy.status ?? "not_installed";
  const canRegenerate =
    !!lookup &&
    flexyStatus === "installed" &&
    lookup.flexy.hasStaffUser &&
    !!lookup.flexy.email;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleRegenerate = async () => {
    if (!lookup) return;
    setConfirmingRegen(false);
    setRegenerating(true);
    setNewPassword(null);
    setLastNotifications(null);
    try {
      const result = await regenerateFlexyPassword(lookup.member.id, {
        notifyEmail,
        notifySms,
      });
      setNewPassword(result.newPassword);
      setLastNotifications(result.notifications);
      setHistoryVersion((v) => v + 1);

      const sentParts: string[] = [];
      const failedParts: string[] = [];
      if (result.notifications.email.requested) {
        if (result.notifications.email.status === "sent") sentParts.push("email");
        else
          failedParts.push(
            `email (${result.notifications.email.reason ?? result.notifications.email.status})`,
          );
      }
      if (result.notifications.sms.requested) {
        if (result.notifications.sms.status === "sent") sentParts.push("SMS");
        else
          failedParts.push(
            `SMS (${result.notifications.sms.reason ?? result.notifications.sms.status})`,
          );
      }

      if (failedParts.length > 0) {
        toast({
          title: "Password regenerated, notifications partially delivered",
          description: `${sentParts.length > 0 ? `Sent via ${sentParts.join(" + ")}. ` : ""}Could not send: ${failedParts.join(", ")}.`,
          variant: "destructive",
        });
      } else if (sentParts.length > 0) {
        toast({
          title: "Password regenerated and sent",
          description: `New credentials sent to member via ${sentParts.join(" + ")}.`,
        });
      } else {
        toast({
          title: "Password regenerated",
          description: "Share the new password with the member, then close this panel.",
        });
      }
    } catch (err) {
      toast({
        title: "Regenerate failed",
        description: err instanceof Error ? err.message : "Could not regenerate password",
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
    }
  };

  if (lookupLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Looking up Flexy details...
      </div>
    );
  }

  if (lookupError) {
    return <p className="text-sm text-red-700">{lookupError}</p>;
  }

  if (!lookup) {
    return null;
  }

  return (
    <div className="space-y-3" data-testid="flexy-regenerate-panel">
      <FlexyStatusSummary lookup={lookup} testIdPrefix="flexy" />

      {lookup.flexy.email ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Flexy login email</p>
          <div className="flex items-center gap-2">
            <code
              className="text-sm font-mono bg-white border rounded px-2 py-1 flex-1 truncate"
              data-testid="text-flexy-email"
            >
              {lookup.flexy.email}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(lookup.flexy.email!, "Email")}
              data-testid="button-copy-flexy-email"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This member does not have a Flexy login on record.
          {flexyStatus === "not_installed" && " They have not installed Flexy yet."}
        </p>
      )}

      {newPassword && (
        <div className="space-y-1 border-t pt-3">
          <p className="text-xs text-muted-foreground">New password (shown once)</p>
          <div className="flex items-center gap-2">
            <code
              className="text-sm font-mono bg-white border rounded px-2 py-1 flex-1 truncate"
              data-testid="text-flexy-new-password"
            >
              {newPassword}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(newPassword, "Password")}
              data-testid="button-copy-flexy-password"
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this with the member securely. It will not be shown again.
          </p>
          {lastNotifications && (
            <div className="mt-2 space-y-1" data-testid="flexy-notification-summary">
              {lastNotifications.email.requested && (
                <p className="text-xs">
                  <Mail className="w-3 h-3 inline mr-1" />
                  Email to member:{" "}
                  <span
                    className={
                      lastNotifications.email.status === "sent"
                        ? "text-green-700 font-medium"
                        : "text-red-700 font-medium"
                    }
                  >
                    {lastNotifications.email.status === "sent"
                      ? "sent"
                      : `${lastNotifications.email.status}${lastNotifications.email.reason ? ` (${lastNotifications.email.reason})` : ""}`}
                  </span>
                </p>
              )}
              {lastNotifications.sms.requested && (
                <p className="text-xs">
                  <MessageSquare className="w-3 h-3 inline mr-1" />
                  SMS to member:{" "}
                  <span
                    className={
                      lastNotifications.sms.status === "sent"
                        ? "text-green-700 font-medium"
                        : "text-red-700 font-medium"
                    }
                  >
                    {lastNotifications.sms.status === "sent"
                      ? "sent"
                      : `${lastNotifications.sms.status}${lastNotifications.sms.reason ? ` (${lastNotifications.sms.reason})` : ""}`}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 border-t pt-3">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            After regenerating, also send the new password to the member:
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`notify-flexy-email-${lookup.member.id}`}
              checked={notifyEmail}
              onCheckedChange={(v) => setNotifyEmail(v === true)}
              disabled={!canRegenerate || regenerating}
              data-testid="checkbox-notify-flexy-email"
            />
            <label
              htmlFor={`notify-flexy-email-${lookup.member.id}`}
              className="text-sm flex items-center gap-1 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              Email new password to {lookup.member.email}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`notify-flexy-sms-${lookup.member.id}`}
              checked={notifySms}
              onCheckedChange={(v) => setNotifySms(v === true)}
              disabled={
                !canRegenerate ||
                regenerating ||
                !lookup.member.hasPhone ||
                !lookup.member.smsOptIn
              }
              data-testid="checkbox-notify-flexy-sms"
            />
            <label
              htmlFor={`notify-flexy-sms-${lookup.member.id}`}
              className={`text-sm flex items-center gap-1 ${
                !lookup.member.hasPhone || !lookup.member.smsOptIn
                  ? "text-muted-foreground"
                  : "cursor-pointer"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Text new password via SMS
              {!lookup.member.hasPhone && (
                <span className="text-xs text-muted-foreground">(no phone on file)</span>
              )}
              {lookup.member.hasPhone && !lookup.member.smsOptIn && (
                <span className="text-xs text-muted-foreground">
                  (member not opted in to SMS)
                </span>
              )}
            </label>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={!canRegenerate || regenerating}
          onClick={() => setConfirmingRegen(true)}
          data-testid="button-regenerate-flexy-password"
        >
          {regenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Regenerating...
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4 mr-2" /> Regenerate password
            </>
          )}
        </Button>
        {!canRegenerate && (
          <p className="text-xs text-muted-foreground mt-2">
            Regenerate is available once Flexy is installed for this member with a staff user
            on record.
          </p>
        )}
      </div>

      {showHistory && (
        <div className="border-t pt-3">
          <FlexyResetHistoryPanel
            userId={lookup.member.id}
            reloadKey={historyVersion}
            containerTestId={historyContainerTestId}
            itemTestIdPrefix={historyItemTestIdPrefix}
            headerLabel={historyHeaderLabel}
            showActorFilter={showHistoryActorFilter}
          />
        </div>
      )}

      <Dialog
        open={confirmingRegen}
        onOpenChange={(open) => {
          if (!open) setConfirmingRegen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Flexy password?</DialogTitle>
            <DialogDescription>
              This will replace this member's Flexy password immediately. Their existing
              password will stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-2 py-2">
            {notifyEmail || notifySms ? (
              <>
                <p>The new password will be sent to the member via:</p>
                <ul className="list-disc ml-5 space-y-1">
                  {notifyEmail && (
                    <li>
                      Email to <strong>{lookup.member.email}</strong>
                    </li>
                  )}
                  {notifySms && <li>SMS to their phone on file</li>}
                </ul>
              </>
            ) : (
              <p>
                No notification will be sent. You will need to share the new password with the
                member yourself before closing this panel.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingRegen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRegenerate}
              disabled={regenerating}
              data-testid="button-confirm-regenerate-flexy"
            >
              {regenerating ? "Regenerating..." : "Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
