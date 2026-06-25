import { useEffect, useState, type ReactNode } from "react";
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

function formatInputDate(value: string): string {
  // `value` is a YYYY-MM-DD string from a native date input. Parse the parts
  // manually so the displayed day matches what was picked (avoids the UTC
  // shift you get from `new Date("2026-03-01")`).
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FilterChip({
  label,
  onClear,
  clearLabel,
}: {
  label: string;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 pl-2.5 pr-1 py-0.5 text-xs font-medium text-stone-700 dark:text-stone-200">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="rounded-full p-0.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200 dark:hover:text-stone-100 dark:hover:bg-stone-700 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

const PRESET_RANGE_LABELS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark
        key={i}
        className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function transcriptSnippet(transcript: string, query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  const idx = transcript.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  const radius = 60;
  const start = Math.max(0, idx - radius);
  const end = Math.min(transcript.length, idx + q.length + radius);
  let snippet = transcript.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < transcript.length) snippet = `${snippet}…`;
  return snippet;
}

function CallDetail({ call, query }: { call: VoiceCallRecord; query: string }) {
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
            {highlight(call.summary, query)}
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
                <span className="text-stone-900 dark:text-stone-100">{highlight(turn.content, query)}</span>
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

type RangeSelection = VoiceCallsRange | "custom";

export function PastCalls() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<VoiceCallRecord | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeSelection>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [query, range, fromDate, toDate]);

  const isCustom = range === "custom";
  // Only treat a custom range as active once at least one bound is set; an
  // invalid order (from after to) is ignored so we never query an empty window.
  const rangeOrderValid = !fromDate || !toDate || fromDate <= toDate;
  const customRange =
    isCustom && rangeOrderValid ? { from: fromDate, to: toDate } : {};

  const { data, isLoading, isFetching } = useVoiceCalls(
    PAGE_SIZE,
    page * PAGE_SIZE,
    query,
    isCustom ? "all" : (range as VoiceCallsRange),
    customRange,
  );

  const calls = data?.calls ?? [];
  const hasCustomBounds = isCustom && (fromDate !== "" || toDate !== "");
  const hasFilters = query !== "" || (range !== "all" && !isCustom) || hasCustomBounds;
  const activeFilterCount =
    (query !== "" ? 1 : 0) +
    (range !== "all" && !isCustom ? 1 : 0) +
    (isCustom && fromDate ? 1 : 0) +
    (isCustom && toDate ? 1 : 0);

  const clearFilters = () => {
    setSearchInput("");
    setRange("all");
    setFromDate("");
    setToDate("");
  };

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
        <Select value={range} onValueChange={(v) => setRange(v as RangeSelection)}>
          <SelectTrigger className="sm:w-40" aria-label="Filter by date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="custom">Custom range…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustom && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="calls-from" className="text-xs font-medium text-stone-500 dark:text-stone-400 shrink-0">
              From
            </label>
            <Input
              id="calls-from"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="sm:w-44"
              aria-label="Start date"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="calls-to" className="text-xs font-medium text-stone-500 dark:text-stone-400 shrink-0">
              To
            </label>
            <Input
              id="calls-to"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="sm:w-44"
              aria-label="End date"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
              className="text-xs text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 underline self-start sm:self-auto"
            >
              Clear dates
            </button>
          )}
        </div>
      )}

      {isCustom && !rangeOrderValid && (
        <p className="text-xs text-red-600 dark:text-red-400">
          The start date must be on or before the end date.
        </p>
      )}

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">Showing calls</span>
          {query && (
            <FilterChip
              label={`matching “${query}”`}
              onClear={() => setSearchInput("")}
              clearLabel="Clear keyword filter"
            />
          )}
          {range !== "all" && !isCustom && (
            <FilterChip
              label={PRESET_RANGE_LABELS[range] ?? range}
              onClear={() => setRange("all")}
              clearLabel="Clear date range filter"
            />
          )}
          {isCustom && fromDate && (
            <FilterChip
              label={`from ${formatInputDate(fromDate)}`}
              onClear={() => setFromDate("")}
              clearLabel="Clear start date filter"
            />
          )}
          {isCustom && toDate && (
            <FilterChip
              label={`to ${formatInputDate(toDate)}`}
              onClear={() => setToDate("")}
              clearLabel="Clear end date filter"
            />
          )}
          {activeFilterCount >= 2 && (
            <button
              type="button"
              onClick={clearFilters}
              aria-label="Clear all filters"
              className="text-xs font-medium text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

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
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
      <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden bg-white dark:bg-stone-950">
        {calls.map((call) => {
          const summaryHasMatch =
            !!query &&
            !!call.summary &&
            call.summary.toLowerCase().includes(query.toLowerCase());
          const snippet =
            !summaryHasMatch && call.transcript
              ? transcriptSnippet(call.transcript, query)
              : null;
          return (
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
              {snippet ? (
                <p className="text-sm text-stone-600 dark:text-stone-400 line-clamp-2">
                  <MessageSquare className="inline w-3 h-3 mr-1 -mt-0.5 text-stone-400" />
                  {highlight(snippet, query)}
                </p>
              ) : (
                <p className="text-sm text-stone-600 dark:text-stone-400 line-clamp-2">
                  {call.summary
                    ? highlight(call.summary, query)
                    : call.transcript
                    ? "Transcript available — tap to view."
                    : "No summary available for this call."}
                </p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-stone-400 mt-1 shrink-0" />
          </button>
          );
        })}
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
          {selected && <CallDetail call={selected} query={query} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
