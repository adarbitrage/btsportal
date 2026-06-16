import { useState } from "react";
import { PackCoachingAdminLayout } from "@/components/layout/PackCoachingAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ActionItemsEditor } from "@/components/coaching/ActionItemsEditor";
import {
  RecordingLinksEditor,
  EMPTY_RECORDING_LINKS,
  type RecordingLinkValues,
} from "@/components/coaching/RecordingLinksEditor";
import { useAdminPackCoaches } from "@/lib/session-coaching-admin-api";
import {
  useAdminPackSessions,
  useAdminCancelBooking,
  useAdminCompleteBooking,
  useAdminNoShowBooking,
  useAdminSaveNotes,
  useAdminSetRecording,
  type AdminPackBooking,
  type PackActionItem,
} from "@/lib/session-coaching-admin-api";

const PAGE_SIZE = 25;
type ActionType = "cancel" | "complete" | "no_show" | "notes" | "recording" | null;

// Coach/admin-only: links to the auto-ingested Meet recording + Gemini notes.
// Never rendered on any member-facing surface.
function RecordingLinks({ booking }: { booking: AdminPackBooking }) {
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

export default function PackSessions() {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [coachId, setCoachId] = useState("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const { data: coaches } = useAdminPackCoaches();
  const { data, isLoading } = useAdminPackSessions({
    status: status === "all" ? undefined : status,
    coachId: coachId === "all" ? undefined : Number(coachId),
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const [activeBooking, setActiveBooking] = useState<AdminPackBooking | null>(null);
  const [action, setAction] = useState<ActionType>(null);
  const [refund, setRefund] = useState(true);
  const [returnCredit, setReturnCredit] = useState(false);
  const [coachNotes, setCoachNotes] = useState("");
  const [actionItems, setActionItems] = useState<PackActionItem[]>([]);
  const [recordingLinks, setRecordingLinks] = useState<RecordingLinkValues>(EMPTY_RECORDING_LINKS);

  const cancelMutation = useAdminCancelBooking();
  const completeMutation = useAdminCompleteBooking();
  const noShowMutation = useAdminNoShowBooking();
  const notesMutation = useAdminSaveNotes();
  const recordingMutation = useAdminSetRecording();

  const bookings = data?.bookings ?? [];
  const stats = data?.stats ?? {};
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function openAction(booking: AdminPackBooking, type: ActionType) {
    setActiveBooking(booking);
    setAction(type);
    setRefund(true);
    setReturnCredit(false);
    setCoachNotes(booking.coachNotes ?? "");
    setActionItems(booking.actionItems ?? []);
    setRecordingLinks({
      recordingUrl: booking.recordingUrl ?? "",
      summaryUrl: booking.summaryUrl ?? "",
      transcriptUrl: booking.transcriptUrl ?? "",
    });
  }

  function closeAction() {
    setActiveBooking(null);
    setAction(null);
  }

  async function confirmAction() {
    if (!activeBooking || !action) return;
    try {
      if (action === "cancel") {
        await cancelMutation.mutateAsync({ bookingId: activeBooking.id, refund });
        toast({ title: "Session cancelled" });
      } else if (action === "complete") {
        await completeMutation.mutateAsync({
          bookingId: activeBooking.id,
          coachNotes: coachNotes.trim() || undefined,
          actionItems,
        });
        toast({ title: "Session marked completed" });
      } else if (action === "no_show") {
        await noShowMutation.mutateAsync({
          bookingId: activeBooking.id,
          returnCredit,
          coachNotes: coachNotes.trim() || undefined,
          actionItems,
        });
        toast({ title: "Session marked no-show" });
      } else if (action === "notes") {
        await notesMutation.mutateAsync({
          bookingId: activeBooking.id,
          coachNotes,
          actionItems,
        });
        toast({ title: "Notes saved" });
      } else if (action === "recording") {
        await recordingMutation.mutateAsync({
          bookingId: activeBooking.id,
          recordingUrl: recordingLinks.recordingUrl.trim() || null,
          summaryUrl: recordingLinks.summaryUrl.trim() || null,
          transcriptUrl: recordingLinks.transcriptUrl.trim() || null,
        });
        toast({ title: "Recording links saved" });
      }
      closeAction();
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const isMutating =
    cancelMutation.isPending ||
    completeMutation.isPending ||
    noShowMutation.isPending ||
    notesMutation.isPending ||
    recordingMutation.isPending;

  return (
    <PackCoachingAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">1-on-1 Sessions</h1>
          <p className="text-muted-foreground">All credit-based coaching bookings.</p>
        </div>

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
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
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
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
            </div>
            <div className="flex gap-2">
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
                        No bookings match these filters.
                      </td>
                    </tr>
                  ) : (
                    bookings.map((b) => (
                      <tr key={b.id} className="border-b border-border/50" data-testid={`booking-row-${b.id}`}>
                        <td className="p-3">
                          <p className="font-medium text-foreground">{b.memberName}</p>
                          <p className="text-xs text-muted-foreground">{b.memberEmail}</p>
                        </td>
                        <td className="p-3 text-foreground">{b.coachName}</td>
                        <td className="p-3 text-foreground">
                          {format(new Date(b.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
                        </td>
                        <td className="p-3">{statusBadge(b.status)}</td>
                        <td className="p-3">
                          <RecordingLinks booking={b} />
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1 flex-wrap">
                            {b.status === "booked" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openAction(b, "complete")}>
                                  Complete
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openAction(b, "no_show")}>
                                  No-show
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => openAction(b, "cancel")}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => openAction(b, "notes")}>
                              Notes
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openAction(b, "recording")}>
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

      <Dialog open={!!action} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "cancel" && "Cancel Session"}
              {action === "complete" && "Mark Completed"}
              {action === "no_show" && "Mark No-show"}
              {action === "notes" && "Coach Notes"}
              {action === "recording" && "Recording Links"}
            </DialogTitle>
            {activeBooking && (
              <DialogDescription>
                {activeBooking.memberName} · {activeBooking.coachName} ·{" "}
                {format(new Date(activeBooking.scheduledAt), "MMM d, yyyy 'at' h:mm a")}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {action === "cancel" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={refund} onCheckedChange={(c) => setRefund(c === true)} />
                Refund the member's session credit
              </label>
            )}
            {action === "no_show" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={returnCredit}
                  onCheckedChange={(c) => setReturnCredit(c === true)}
                />
                Return the session credit to the member
              </label>
            )}
            {(action === "complete" || action === "no_show" || action === "notes") && (
              <>
                <div>
                  <Label className="text-xs">Coach notes {action !== "notes" && "(optional)"}</Label>
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
              </>
            )}
            {action === "recording" && (
              <RecordingLinksEditor values={recordingLinks} onChange={setRecordingLinks} />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAction} disabled={isMutating}>
              Cancel
            </Button>
            <Button onClick={confirmAction} disabled={isMutating}>
              {isMutating ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PackCoachingAdminLayout>
  );
}
