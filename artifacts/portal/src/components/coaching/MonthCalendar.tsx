import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";

// A single thing that happens on a calendar day. Deliberately GENERIC — it
// carries no coaching-specific fields beyond a date, a kind, and a couple of
// flags — so other day-scoped sources (e.g. the Google Calendar conflict
// overlay) can be merged into the same `events` list without touching this
// component.
export interface CalendarDayEvent {
  id: string | number;
  date: Date;
  // What this marker represents. Defaults to "group-call" when omitted.
  kind?: "group-call" | "busy";
  // group-call only: a soft-cancelled occurrence.
  cancelled?: boolean;
  // This event participates in a group-call ↔ external-event time conflict.
  // The owning page computes the time overlap; this component only renders it.
  conflict?: boolean;
}

interface MonthCalendarProps {
  month: Date;
  onMonthChange: (next: Date) => void;
  events: CalendarDayEvent[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthCalendar({
  month,
  onMonthChange,
  events,
  selectedDate,
  onSelectDate,
}: MonthCalendarProps) {
  // A full 6-week grid (Sun-aligned) so every month renders the same height and
  // trailing/leading days from adjacent months fill the edges.
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventsByDay = new Map<string, CalendarDayEvent[]>();
  for (const ev of events) {
    const key = format(ev.date, "yyyy-MM-dd");
    const list = eventsByDay.get(key);
    if (list) list.push(ev);
    else eventsByDay.set(key, [ev]);
  }

  return (
    <div data-testid="group-call-calendar">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          data-testid="calendar-prev"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div data-testid="calendar-month-label" className="text-base font-semibold">
          {format(month, "MMMM yyyy")}
        </div>
        <button
          type="button"
          data-testid="calendar-next"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-xs font-medium text-muted-foreground py-1"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const groupEvents = dayEvents.filter((e) => e.kind !== "busy");
          const busyEvents = dayEvents.filter((e) => e.kind === "busy");
          const hasGroupCall = groupEvents.length > 0;
          const hasBusy = busyEvents.length > 0;
          // A day is interactive when it has any marker worth inspecting.
          const hasEvents = hasGroupCall || hasBusy;
          const anyActive = groupEvents.some((e) => !e.cancelled);
          const allCancelled = hasGroupCall && !anyActive;
          // Conflict = a group call and an external event overlap in time on
          // this day (the owning page flags the participating events).
          const conflict = dayEvents.some((e) => e.conflict);
          const inMonth = isSameMonth(day, month);
          const selected = selectedDate !== null && isSameDay(day, selectedDate);

          return (
            <button
              key={key}
              type="button"
              data-testid={`calendar-day-${key}`}
              data-has-events={hasGroupCall ? "true" : "false"}
              data-has-busy={hasBusy ? "true" : "false"}
              data-conflict={conflict ? "true" : "false"}
              data-cancelled={allCancelled ? "true" : "false"}
              disabled={!hasEvents}
              aria-pressed={selected}
              onClick={() => hasEvents && onSelectDate(day)}
              className={cn(
                "relative flex h-12 flex-col items-center justify-center rounded-md border text-sm transition-colors",
                hasEvents
                  ? "cursor-pointer border-border/60 hover:border-primary/60 hover:bg-muted"
                  : "cursor-default border-transparent",
                selected && "border-primary bg-primary/10 ring-1 ring-primary",
                conflict && !selected && "border-amber-500 ring-1 ring-amber-500",
                !inMonth && "opacity-40",
              )}
            >
              {conflict && (
                <span
                  aria-hidden
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500"
                />
              )}
              <span
                className={cn(
                  "leading-none",
                  isToday(day) && !selected && "font-bold text-primary",
                )}
              >
                {format(day, "d")}
              </span>
              {hasEvents && (
                <span className="mt-1 flex items-center gap-0.5">
                  {hasGroupCall && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        anyActive ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                    />
                  )}
                  {hasBusy && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-500/70"
                      data-testid={`calendar-busy-dot-${key}`}
                    />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
