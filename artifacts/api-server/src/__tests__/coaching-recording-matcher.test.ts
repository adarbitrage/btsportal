import { describe, it, expect } from "vitest";
import {
  matchBookingFiles,
  normalizeForMatch,
  type DriveFileMeta,
} from "../lib/coaching-recording-matcher";

// The matcher links a pack 1-on-1 booking to its Google Drive artifacts purely
// from file metadata — no live Google access — so it is fully unit-testable.

const SCHEDULED = new Date("2026-06-10T18:00:00Z");
const END = new Date("2026-06-10T19:00:00Z");

function booking(title: string | null = "1-on-1 Coaching with Sasha") {
  return { title, scheduledAt: SCHEDULED, endAt: END };
}

const GOOGLE_DOC = "application/vnd.google-apps.document";

function file(partial: Partial<DriveFileMeta> & { id: string }): DriveFileMeta {
  return {
    name: "1-on-1 Coaching with Sasha (2026-06-10 18:00 GMT)",
    mimeType: "video/mp4",
    createdTime: "2026-06-10T19:20:00Z",
    webViewLink: `https://drive.google.com/file/${partial.id}/view`,
    ...partial,
  };
}

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeForMatch("1-on-1 Coaching with Sasha!")).toBe(
      "1 on 1 coaching with sasha",
    );
  });
});

describe("matchBookingFiles", () => {
  it("matches recording, summary and transcript by title + time window", () => {
    const files: DriveFileMeta[] = [
      file({ id: "rec", mimeType: "video/mp4" }),
      file({
        id: "sum",
        mimeType: GOOGLE_DOC,
        name: "1-on-1 Coaching with Sasha - Notes by Gemini",
        createdTime: "2026-06-10T19:25:00Z",
      }),
      file({
        id: "tr",
        mimeType: GOOGLE_DOC,
        name: "1-on-1 Coaching with Sasha - Transcript",
        createdTime: "2026-06-10T19:26:00Z",
      }),
    ];
    const result = matchBookingFiles(booking(), files);
    expect(result.recordingUrl).toBe("https://drive.google.com/file/rec/view");
    expect(result.summaryUrl).toBe("https://drive.google.com/file/sum/view");
    expect(result.transcriptUrl).toBe("https://drive.google.com/file/tr/view");
    expect(result.matchedFileIds.sort()).toEqual(["rec", "sum", "tr"]);
  });

  it("never matches when the booking title is null/empty (group/internal calls)", () => {
    const files = [file({ id: "rec" })];
    expect(matchBookingFiles(booking(null), files).recordingUrl).toBeNull();
    expect(matchBookingFiles(booking("   "), files).recordingUrl).toBeNull();
  });

  it("ignores files whose name does not contain the booking title", () => {
    const files = [
      file({ id: "other", name: "Team Standup Recording 2026-06-10" }),
      file({ id: "grp", name: "Weekly Group Mastermind (2026-06-10)" }),
    ];
    const result = matchBookingFiles(booking(), files);
    expect(result.recordingUrl).toBeNull();
    expect(result.matchedFileIds).toEqual([]);
  });

  it("ignores files created outside the [start-lead, end+lag] window", () => {
    const tooEarly = file({ id: "early", createdTime: "2026-06-10T16:00:00Z" });
    const tooLate = file({ id: "late", createdTime: "2026-06-11T08:00:00Z" });
    const result = matchBookingFiles(booking(), [tooEarly, tooLate]);
    expect(result.recordingUrl).toBeNull();
  });

  it("disambiguates back-to-back calls by picking the file closest to call end", () => {
    // Two recordings for the same coach title in the window; the one created
    // right after THIS call's end wins over a later one (the next member's).
    const mine = file({ id: "mine", createdTime: "2026-06-10T19:15:00Z" });
    const next = file({ id: "next", createdTime: "2026-06-10T21:00:00Z" });
    const result = matchBookingFiles(booking(), [next, mine]);
    expect(result.recordingUrl).toBe("https://drive.google.com/file/mine/view");
  });

  it("does not classify a transcript doc as the summary", () => {
    const files = [
      file({
        id: "tr",
        mimeType: GOOGLE_DOC,
        name: "1-on-1 Coaching with Sasha - Transcript",
        createdTime: "2026-06-10T19:26:00Z",
      }),
    ];
    const result = matchBookingFiles(booking(), files);
    expect(result.summaryUrl).toBeNull();
    expect(result.transcriptUrl).toBe("https://drive.google.com/file/tr/view");
  });

  it("skips files with no webViewLink", () => {
    const files = [file({ id: "rec", webViewLink: null })];
    expect(matchBookingFiles(booking(), files).recordingUrl).toBeNull();
  });
});
