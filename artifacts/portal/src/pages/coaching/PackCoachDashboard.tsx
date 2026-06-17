import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ActionItemsEditor } from "@/components/coaching/ActionItemsEditor";
import { useAdminPackCoaches, type PackActionItem } from "@/lib/session-coaching-admin-api";
import type { AdminPackBooking } from "@/lib/session-coaching-admin-api";
import {
  useCoachPackSessions,
  useCoachPackMemberHistory,
  useCoachSavePackNotes,
  useCoachSetRecording,
  type CoachPackMemberSession,
} from "@/lib/coach-pack-api";
import {
  RecordingLinksEditor,
  EMPTY_RECORDING_LINKS,
  type RecordingLinkValues,
} from "@/components/coaching/RecordingLinksEditor";
import {
  useCoachGoogleStatus,
  useCoachGoogleDisconnect,
  startGoogleConnect,
} from "@/lib/coach-google-api";

const PAGE_SIZE = 25;

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Your connect link expired. Please try again.",
  no_email: "Google did not share your email. Please try again.",
  not_configured: "Google sign-in isn't configured yet. Contact an admin.",
  exchange_failed: "Google sign-in failed. Please try again.",
  access_denied: "You declined access. Connect again to enable recordings.",
};

// Coach-facing card to connect their own Google Drive so the ingest can find
// their Meet recordings + Gemini notes. Per-coach OAuth — no Workspace admin.
function GoogleDriveCard() {
  const { toast } = useToast();
  const { data, isLoading } = useCoachGoogleStatus();
  const disconnect = useCoachGoogleDisconnect();

  // Surface the result of the OAuth round-trip (?google=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") {
      toast({ title: "Google Drive connected" });
    } else if (result === "error") {
      const reason = params.get("reason") ?? "";
      toast({
        title: "Could not connect Google Drive",
        description: GOOGLE_ERROR_MESSAGES[reason] ?? "Please try again.",
        variant: "destructive",
      });
    }
    params.delete("google");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
  }, [toast]);

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast({ title: "Google Drive disconnected" });
    } catch (err) {
      toast({
        title: "Could not disconnect",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  if (isLoading) return null;

  const connected = data?.connected;
  const notConfigured = data && !data.configured;

  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground">Google Drive</p>
            {connected ? (
              <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/10">
                Connected
              </Badge>
            ) : (
              <Badge variant="outline">Not connected</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {connected
              ? `Recordings & notes from ${data?.email ?? "your account"} link automatically.`
              : notConfigured
                ? "Google sign-in isn't set up yet. Ask an admin to add the Google credentials."
                : "Connect your Google account so your Meet recordings and notes link to each session automatically."}
          </p>
          {connected && (
            <div
              className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
              data-testid="callout-meet-folder-sharing"
            >
              <p className="text-xs font-medium text-foreground">
                One-time setup: share your Meet Recordings folder
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                In Google Drive, open your{" "}
                <span className="font-medium text-foreground">Meet Recordings</span>{" "}
                folder, choose <span className="font-medium text-foreground">Share</span>, and set
                General access to{" "}
                <span className="font-medium text-foreground">
                  “Anyone with the link”
                </span>{" "}
                (Viewer). You only need to do this once.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Members open recording links directly in Google Drive — the portal
                doesn’t re-host or stream the videos, so without this, links will hit
                a permission wall.
              </p>
            </div>
          )}
        </div>
        <div className="shrink-0">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={startGoogleConnect}
              disabled={notConfigured}
            >
              Connect Google Drive
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface RecordingFields {
  recordingUrl: string | null;
  summaryUrl: string | null;
  transcriptUrl: string | null;
  recordingIngestStatus: string;
  status: string;
}

// Coach/admin-only: links to the auto-ingested Meet recording + Gemini notes.
// Never rendered on any member-facing surface.
function RecordingLinks({ booking }: { booking: RecordingFields }) {
  const links = [
    { href: booking.recordingUrl, label: "Recording" },
    { href: booking.summaryUrl, label: "Notes" },
    { href: booking.transcriptUrl, label: "Transcript" },
  ].filter((l) => !!l.href);

  if (links.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
          >
            {l.label}
          </a>
        ))}
        {booking.recordingIngestStatus === "manual" && (
          <Badge variant="outline" className="text-[10px]" data-testid="badge-manual-recording">
            Manual
          </Badge>
        )}
      </div>
    );
  }

  // No links yet — show why, but only for sessions that have actually happened.
  if (booking.status === "cancelled") {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  const hint =
    booking.recordingIngestStatus === "not_found" ||
    booking.recordingIngestStatus === "error"
      ? "No recording found"
      : "Pending…";
  return <span className="text-xs text-muted-foreground/60 italic">{hint}</span>;
}

function statusBadge(status: string) {
  switch (status) {
    case "booked":
      return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Booked</Badge>;
    case "completed":
      return <Badge variant="secondary">Completed</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    case "no_show":
      return <Badge variant="warning">No-show</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// Derived review hint: a past, still-"booked" session whose recording ingest
// found nothing. Surfaced so coaches can confirm the real outcome via the
// manual mark-completed / no-show controls — never auto-applied.
function LikelyNoShowBadge() {
  return (
    <Badge
      variant="warning"
      className="text-[10px] whitespace-nowrap"
      data-testid="badge-likely-no-show"
      title="Past session still booked with no recording found — likely a no-show. Confirm the real outcome with an admin."
    >
      Likely no-show
    </Badge>
  );
}

export default function PackCoachDashboard() {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [coachId, setCoachId] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [likelyOnly, setLikelyOnly] = useState(false);
  const [page, setPage] = useState(0);

  const { data: coaches } = useAdminPackCoaches();
  const { data, isLoading } = useCoachPackSessions({
    status: status === "all" ? undefined : status,
    coachId: coachId === "all" ? undefined : Number(coachId),
    q: search || undefined,
    likelyNoShow: likelyOnly || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  // Member history drawer
  const [historyMemberId, setHistoryMemberId] = useState<number | null>(null);
  const { data: history, isLoading: historyLoading } =
    useCoachPackMemberHistory(historyMemberId);

  // Notes / action-items editor
  const [editing, setEditing] = useState<AdminPackBooking | CoachPackMemberSession | null>(null);
  const [editMember, setEditMember] = useState<string>("");
  const [coachNotes, setCoachNotes] = useState("");
  const [actionItems, setActionItems] = useState<PackActionItem[]>([]);
  const saveMutation = useCoachSavePackNotes();

  // Manual recording-link editor
  const [recordingEditing, setRecordingEditing] = useState<
    AdminPackBooking | CoachPackMemberSession | null
  >(null);
  const [recordingMember, setRecordingMember] = useState<string>("");
  const [recordingLinks, setRecordingLinks] = useState<RecordingLinkValues>(EMPTY_RECORDING_LINKS);
  const recordingMutation = useCoachSetRecording();

  const bookings = data?.bookings ?? [];
  const stats = data?.stats ?? {};
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function openEditor(
    booking: AdminPackBooking | CoachPackMemberSession,
    memberLabel: string,
  ) {
    setEditing(booking);
    setEditMember(memberLabel);
    setCoachNotes(booking.coachNotes ?? "");
    setActionItems(booking.actionItems ?? []);
  }

  function closeEditor() {
    setEditing(null);
  }

  function openRecording(
    booking: AdminPackBooking | CoachPackMemberSession,
    memberLabel: string,
  ) {
    setRecordingEditing(booking);
    setRecordingMember(memberLabel);
    setRecordingLinks({
      recordingUrl: booking.recordingUrl ?? "",
      summaryUrl: booking.summaryUrl ?? "",
      transcriptUrl: booking.transcriptUrl ?? "",
    });
  }

  function closeRecording() {
    setRecordingEditing(null);
  }

  async function saveRecording() {
    if (!recordingEditing) return;
    try {
      await recordingMutation.mutateAsync({
        bookingId: recordingEditing.id,
        recordingUrl: recordingLinks.recordingUrl.trim() || null,
        summaryUrl: recordingLinks.summaryUrl.trim() || null,
        transcriptUrl: recordingLinks.transcriptUrl.trim() || null,
      });
      toast({ title: "Recording links saved" });
      closeRecording();
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function saveEditor() {
    if (!editing) return;
    try {
      await saveMutation.mutateAsync({
        bookingId: editing.id,
        coachNotes,
        actionItems,
      });
      toast({ title: "Saved" });
      closeEditor();
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">1-on-1 Sessions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Notes and action items are shared across all coaches and never shown to members.
          </p>
        </div>

        {/* Google Drive connection */}
        <GoogleDriveCard />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Booked", value: stats.booked ?? 0 },
            { label: "Completed", value: stats.completed ?? 0 },
            { label: "Cancelled", value: stats.cancelled ?? 0 },
            { label: "No-show", value: stats.no_show ?? 0 },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="booked">Booked</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Coach</Label>
              <Select value={coachId} onValueChange={(v) => { setCoachId(v); setPage(0); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All coaches</SelectItem>
                  {(coaches ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Member</Label>
                <Input
                  placeholder="Name or email"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSearch(q);
                      setPage(0);
                    }
                  }}
                />
              </div>
              <Button
                variant="outline"
                className="self-end"
                onClick={() => { setSearch(q); setPage(0); }}
              >
                Search
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-4">
              <Checkbox
                checked={likelyOnly}
                onCheckedChange={(c) => { setLikelyOnly(c === true); setPage(0); }}
                data-testid="checkbox-likely-no-show-only"
              />
              <span>
                Show only likely no-shows to review
                {(stats.likely_no_show ?? 0) > 0 && (
                  <span className="ml-1 text-muted-foreground">({stats.likely_no_show})</span>
                )}
              </span>
            </label>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="p-3 font-medium">Member</th>
                    <th className="p-3 font-medium">Coach</th>
                    <th className="p-3 font-medium">When</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Recording</th>
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        Loading…
                      </td>
                    </tr>
                  ) : bookings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        No sessions match these filters.
                      </td>
                    </tr>
                  ) : (
                    bookings.map((b) => (
                      <tr key={b.id} className="border-b border-border/50" data-testid={`session-row-${b.id}`}>
                        <td className="p-3">
                          <p className="font-medium text-foreground">{b.memberName}</p>
                          <p className="text-xs text-muted-foreground">{b.memberEmail}</p>
                        </td>
                        <td className="p-3 text-foreground">{b.coachName}</td>
                        <td className="p-3 text-foreground">
                          {format(new Date(b.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {statusBadge(b.status)}
                            {b.likelyNoShow && <LikelyNoShowBadge />}
                          </div>
                        </td>
                        <td className="p-3">
                          <RecordingLinks booking={b} />
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setHistoryMemberId(b.memberId)}
                            >
                              History
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openEditor(b, `${b.memberName}`)}>
                              Notes
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openRecording(b, `${b.memberName}`)}>
                              Recording
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Member cross-coach history drawer */}
      <Sheet open={historyMemberId !== null} onOpenChange={(open) => !open && setHistoryMemberId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{history?.member.name ?? "Session history"}</SheetTitle>
            <SheetDescription>
              {history?.member.email
                ? `All ${history.sessions.length} session${history.sessions.length !== 1 ? "s" : ""} across coaches`
                : "Every coach sees all prior notes and action items."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !history || history.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              history.sessions.map((s) => (
                <Card key={s.id} data-testid={`history-session-${s.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {format(new Date(s.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        <p className="text-xs text-muted-foreground">with {s.coachName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {statusBadge(s.status)}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditor(s, history.member.name)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openRecording(s, history.member.name)}
                        >
                          Recording
                        </Button>
                      </div>
                    </div>
                    {s.coachNotes && (
                      <p className="text-sm text-foreground whitespace-pre-wrap">{s.coachNotes}</p>
                    )}
                    {s.actionItems.length > 0 && (
                      <ul className="space-y-1">
                        {s.actionItems.map((item) => (
                          <li key={item.id} className="text-xs flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                item.completed ? "bg-green-500" : "bg-muted-foreground/40"
                              }`}
                            />
                            <span className={item.completed ? "line-through text-muted-foreground" : "text-foreground"}>
                              {item.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!s.coachNotes && s.actionItems.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">No notes recorded.</p>
                    )}
                    <div className="pt-1">
                      <RecordingLinks booking={s} />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Notes / action-items editor */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session notes</DialogTitle>
            <DialogDescription>
              {editMember}
              {editing && (
                <>
                  {" · "}
                  {format(new Date(editing.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">Coach notes</Label>
              <Textarea
                value={coachNotes}
                onChange={(e) => setCoachNotes(e.target.value)}
                rows={4}
                placeholder="Internal notes about this session"
              />
            </div>
            <div>
              <Label className="text-xs">Action items</Label>
              <ActionItemsEditor items={actionItems} onChange={setActionItems} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={saveEditor} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual recording-link editor */}
      <Dialog open={recordingEditing !== null} onOpenChange={(open) => !open && closeRecording()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recording links</DialogTitle>
            <DialogDescription>
              {recordingMember}
              {recordingEditing && (
                <>
                  {" · "}
                  {format(new Date(recordingEditing.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <RecordingLinksEditor values={recordingLinks} onChange={setRecordingLinks} />

          <DialogFooter>
            <Button variant="outline" onClick={closeRecording} disabled={recordingMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={saveRecording} disabled={recordingMutation.isPending}>
              {recordingMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
