import { useState } from "react";
import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/coaching/StatusPill";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPartnerMenteeDetail,
  useAddPartnerMenteeNote,
  useSetPartnerMenteeCadence,
  useMarkPartnerCallDoneRoute,
  getGetPartnerMenteeDetailQueryKey,
  getGetPartnerRosterQueryKey,
  getGetPartnerTodayQueryKey,
  type PartnerNote,
  type PartnerMenteeCall,
  type MenteeStatus,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  User,
  AlertTriangle,
  StickyNote,
  Video,
  ExternalLink,
  CheckCircle2,
  Send,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Admin-viewer support (same convention as PartnerDashboard)
// ---------------------------------------------------------------------------

function usePartnerIdParam(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("partnerId");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return !isNaN(parsed) && parsed > 0 ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Cadence setter
// ---------------------------------------------------------------------------

const CADENCE_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

function CadenceSetter({
  memberId,
  current,
  partnerId,
}: {
  memberId: number;
  current: number | null;
  partnerId?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setCadence = useSetPartnerMenteeCadence();

  function handleChange(value: string) {
    const cadencePerWeek = value === "none" ? null : parseInt(value, 10);
    setCadence.mutate(
      { memberId, data: { cadencePerWeek } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPartnerMenteeDetailQueryKey(memberId, { partnerId }) });
          queryClient.invalidateQueries({ queryKey: getGetPartnerRosterQueryKey({ partnerId }) });
          toast({ title: "Cadence updated" });
        },
        onError: () =>
          toast({
            title: "Couldn't update cadence",
            description: "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="cadence-select" className="text-sm text-muted-foreground">
        Weekly cadence
      </label>
      <select
        id="cadence-select"
        value={current ?? "none"}
        onChange={(e) => handleChange(e.target.value)}
        disabled={setCadence.isPending}
        className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <option value="none">No cadence set</option>
        {CADENCE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}x / week
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function NoteRow({ note }: { note: PartnerNote }) {
  return (
    <li className={`px-6 py-3 border-b border-border/50 last:border-0 ${note.is_concern ? "bg-amber-50/50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
        {note.is_concern && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
            <AlertTriangle className="w-3 h-3" /> Concern
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        {note.author_name ?? "Partner"} · {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
      </p>
    </li>
  );
}

function AddNoteForm({ memberId, partnerId }: { memberId: number; partnerId?: number }) {
  const [body, setBody] = useState("");
  const [isConcern, setIsConcern] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const addNote = useAddPartnerMenteeNote();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    addNote.mutate(
      { memberId, data: { body: trimmed, isConcern } },
      {
        onSuccess: () => {
          setBody("");
          setIsConcern(false);
          queryClient.invalidateQueries({ queryKey: getGetPartnerMenteeDetailQueryKey(memberId, { partnerId }) });
          queryClient.invalidateQueries({ queryKey: getGetPartnerRosterQueryKey({ partnerId }) });
        },
        onError: () =>
          toast({
            title: "Couldn't add note",
            description: "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 py-4 border-b border-border/50 space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note about this mentee…"
        rows={3}
        className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={isConcern}
            onChange={(e) => setIsConcern(e.target.checked)}
            className="rounded border-border"
          />
          Flag as concern
        </label>
        <Button type="submit" size="sm" disabled={addNote.isPending || !body.trim()} className="gap-1.5">
          <Send className="w-3.5 h-3.5" />
          {addNote.isPending ? "Adding…" : "Add Note"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Call history / mark done
// ---------------------------------------------------------------------------

function CallRow({ call, partnerId, memberId }: { call: PartnerMenteeCall; partnerId?: number; memberId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const markDone = useMarkPartnerCallDoneRoute();
  const isPast = new Date(call.scheduled_at) < new Date();
  const canMarkDone = call.status === "booked";

  function handleMarkDone() {
    markDone.mutate(
      { id: call.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPartnerMenteeDetailQueryKey(memberId, { partnerId }) });
          queryClient.invalidateQueries({ queryKey: getGetPartnerRosterQueryKey({ partnerId }) });
          queryClient.invalidateQueries({ queryKey: getGetPartnerTodayQueryKey({ partnerId }) });
          toast({ title: "Call marked as done" });
        },
        onError: () =>
          toast({
            title: "Couldn't mark call done",
            description: "Please try again in a moment.",
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <li className="flex items-center gap-4 px-6 py-3 border-b border-border/50 last:border-0">
      <div className="w-32 shrink-0">
        <p className="text-sm font-medium text-foreground">{format(new Date(call.scheduled_at), "MMM d, yyyy")}</p>
        <p className="text-xs text-muted-foreground">{format(new Date(call.scheduled_at), "h:mm a")}</p>
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full border font-semibold bg-secondary/50 text-muted-foreground border-border capitalize">
        {call.status.replace(/_/g, " ")}
      </span>
      {call.meeting_url && (
        <a
          href={call.meeting_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <Video className="w-3.5 h-3.5" /> Link <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <div className="flex-1" />
      {canMarkDone && isPast && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleMarkDone}
          disabled={markDone.isPending}
          className="gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {markDone.isPending ? "Marking…" : "Mark Done"}
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PartnerMenteeDetail() {
  const params = useParams<{ memberId: string }>();
  const memberId = parseInt(params.memberId ?? "", 10);
  const validMemberId = !isNaN(memberId) && memberId > 0 ? memberId : null;
  const partnerId = usePartnerIdParam();

  const { data: mentee, isLoading, isError } = useGetPartnerMenteeDetail(
    validMemberId ?? 0,
    { partnerId },
    { query: { queryKey: ["partner", "mentee", validMemberId, partnerId], enabled: validMemberId !== null } },
  );

  if (validMemberId === null) {
    return (
      <AppLayout>
        <p className="text-destructive">Invalid mentee ID.</p>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 animate-pulse">
          <div className="h-8 bg-card rounded w-48" />
          <div className="h-32 bg-card rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (isError || !mentee) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold">Mentee not found</h2>
          <p className="text-muted-foreground mt-2">This account may not be assigned to you.</p>
          <Link
            href="/partner/dashboard"
            className="inline-flex items-center gap-1 mt-4 text-primary text-sm hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <Link
          href="/partner/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Partner Dashboard
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl border border-border p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{mentee.name}</h1>
              <p className="text-muted-foreground text-sm">{mentee.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <StatusPill status={mentee.blitz_status as MenteeStatus} />
                <span className="text-xs text-muted-foreground">
                  {mentee.blitz_completion_pct}% complete
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                <span>
                  {mentee.days_since_last_completed_call === null
                    ? "No completed calls yet"
                    : `${mentee.days_since_last_completed_call}d since last completed call`}
                </span>
                {mentee.consecutive_no_shows > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-100 border border-red-200 rounded px-1.5 py-0.5">
                    <AlertTriangle className="w-3 h-3" />
                    {mentee.consecutive_no_shows} consecutive no-show{mentee.consecutive_no_shows === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Assigned {format(new Date(mentee.assigned_at), "MMMM d, yyyy")}
          </div>
        </div>

        {/* Cadence */}
        <Card>
          <CardContent className="py-4">
            <CadenceSetter memberId={validMemberId} current={mentee.cadence_per_week} partnerId={partnerId} />
          </CardContent>
        </Card>

        {/* Calls */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="text-base font-semibold text-foreground">Calls</h2>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {mentee.calls.length === 0 ? (
              <p className="px-6 py-8 text-center text-muted-foreground text-sm">No calls scheduled yet.</p>
            ) : (
              <ul>
                {mentee.calls.map((call) => (
                  <CallRow key={call.id} call={call} partnerId={partnerId} memberId={validMemberId} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <StickyNote className="w-4 h-4 text-primary" /> Notes
            </h2>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <AddNoteForm memberId={validMemberId} partnerId={partnerId} />
            {mentee.notes.length === 0 ? (
              <p className="px-6 py-8 text-center text-muted-foreground text-sm">No notes yet.</p>
            ) : (
              <ul>
                {mentee.notes.map((note) => (
                  <NoteRow key={note.id} note={note} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
