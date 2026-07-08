import { describe, it, expect } from "vitest";
import { extractBusyEvents } from "../lib/ghl-coaching-calendar";

// extractBusyEvents maps a GHL calendar-events payload to absolute busy
// intervals. Contract: cancelled events are EXCLUDED (a cancelled Cherrington
// appointment must not keep blocking BTS times) and malformed events are
// skipped rather than producing NaN intervals.
describe("extractBusyEvents", () => {
  const start = "2026-07-20T14:00:00-05:00";
  const end = "2026-07-20T15:00:00-05:00";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  it("maps confirmed events to epoch busy intervals", () => {
    const busy = extractBusyEvents({
      events: [{ startTime: start, endTime: end, appointmentStatus: "confirmed" }],
    });
    expect(busy).toEqual([{ startMs, endMs }]);
  });

  it("excludes cancelled events (both spellings, either status field)", () => {
    const busy = extractBusyEvents({
      events: [
        { startTime: start, endTime: end, appointmentStatus: "cancelled" },
        { startTime: start, endTime: end, appointmentStatus: "Cancelled" },
        { startTime: start, endTime: end, status: "canceled" },
        { startTime: start, endTime: end, appointmentStatus: "confirmed" },
      ],
    });
    expect(busy).toEqual([{ startMs, endMs }]);
  });

  it("excludes deleted events, keeps deleted:false (live payloads carry a deleted flag)", () => {
    const busy = extractBusyEvents({
      events: [
        { startTime: start, endTime: end, appointmentStatus: "confirmed", deleted: true },
        { startTime: start, endTime: end, appointmentStatus: "confirmed", deleted: false },
      ],
    });
    expect(busy).toEqual([{ startMs, endMs }]);
  });

  it("keeps events with no status field (blocks/holds report as busy)", () => {
    const busy = extractBusyEvents({ events: [{ startTime: start, endTime: end }] });
    expect(busy).toEqual([{ startMs, endMs }]);
  });

  it("skips events with missing, unparseable, or inverted times", () => {
    const busy = extractBusyEvents({
      events: [
        { endTime: end },
        { startTime: "not-a-date", endTime: end },
        { startTime: end, endTime: start },
      ],
    });
    expect(busy).toEqual([]);
  });

  it("returns [] for an empty or absent events list", () => {
    expect(extractBusyEvents({})).toEqual([]);
    expect(extractBusyEvents({ events: [] })).toEqual([]);
  });
});
