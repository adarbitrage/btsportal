import { useEffect, useState } from "react";
import { useVoiceCalls, type VoiceCallRecord, type VoiceCallsRange } from "@/lib/voice-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, Loader2, FileText, Clock, ChevronRight, MessageSquare, Search, X } from "lucide-react";

const PAGE_SIZE = 5;

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function parseTranscript(transcript: string): { role: string; content: string }[] {
  const lines = transcript.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const m = line.match(/^\s*(Agent|User|You|Assistant)\s*:\s*(.*)$/i);
    if (m) {
      const role = /agent|assistant/i.test(m[1]) ? "Agent" : "You";
      return { role, content: m[2] };
    }
    return { role: "", content: line };
  });
}

function CallDetail({ call }: { call: VoiceCallRecord }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-500 dark:text-stone-400">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {formatDuration(call.duration_seconds)}
        </span>
        <span>{formatDate(call.started_at)} · {formatTime(call.started_at)}</span>
      </div>

      {call.summary && (
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2">
            <FileText className="w-3.5 h-3.5" />
            Summary
          </h4>
          <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed whitespace-pre-line">
            {call.summary}
          </p>
        </div>
      )}

      <div>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2">
          <MessageSquare className="w-3.5 h-3.5" />
          Transcript
        </h4>
        {call.transcript ? (
          <div className="space-y-2.5 max-h-[40vh] overflow-y-auto pr-1">
            {parseTranscript(call.transcript).map((turn, i) => (
              <div key={i} className="text-sm leading-relaxed">
                {turn.role && (
                  <span
                    className={`font-semibold ${
                      turn.role === "Agent"
                        ? "text-primary"
                        : "text-stone-900 dark:text-stone-100"
                    }`}
                  >
                    {turn.role}:{" "}
                  </span>
                )}
                <span className="text-stone-700 dark:text-stone-300">{turn.content}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-400 italic">
            No transcript is available for this call.
          </p>
        )}
      </div>
    </div>
  );
}

export function PastCalls() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VoiceCallRecord | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<VoiceCallsRange>("all");

  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [query, range]);

  const { data, isLoading, isFetching } = useVoiceCalls(
    PAGE_SIZE,
    page * PAGE_SIZE,
    query,
    range,
  );

  const calls = data?.calls ?? [];
  const hasFilters = query !== "" || range !== "all";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
      </div>
    );
  }

  if (calls.length === 0 && page === 0 && !hasFilters) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 p-8 text-center">
        <History className="w-6 h-6 text-stone-400 mx-auto mb-2" />
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Your past calls will appear here once you've had a conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">Past Calls</h2>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search summaries and transcripts…"
            className="pl-9 pr-9"
            aria-label="Search past calls"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as VoiceCallsRange)}>
          <SelectTrigger className="sm:w-40" aria-label="Filter by date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {calls.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 p-8 text-center">
          <Search className="w-6 h-6 text-stone-400 mx-auto mb-2" />
          <p className="text-sm text-stone-500 dark:text-stone-400">
            No calls match your search.
          </p>
          {hasFilters && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSearchInput("");
                setRange("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
      <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden bg-white dark:bg-stone-950">
        {calls.map((call) => (
          <button
            key={call.id}
            onClick={() => setSelected(call)}
            className="w-full flex items-start gap-3 text-left px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-900 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {formatDate(call.started_at)}
                </span>
                <span className="text-xs text-stone-400">·</span>
                <span className="inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                  <Clock className="w-3 h-3" />
                  {formatDuration(call.duration_seconds)}
                </span>
              </div>
              <p className="text-sm text-stone-600 dark:text-stone-400 line-clamp-2">
                {call.summary
                  ? call.summary
                  : call.transcript
                  ? "Transcript available — tap to view."
                  : "No summary available for this call."}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-stone-400 mt-1 shrink-0" />
          </button>
        ))}
      </div>
      )}

      {(page > 0 || data?.has_more) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Page ${page + 1}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.has_more || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Call Details</DialogTitle>
            <DialogDescription>
              {selected ? `${formatDate(selected.started_at)} at ${formatTime(selected.started_at)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && <CallDetail call={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
