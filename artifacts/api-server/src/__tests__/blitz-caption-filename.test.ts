import { describe, it, expect } from "vitest";
import {
  BLITZ_SECTION_BY_ID,
  getBlitzLessonsForVideo,
  getKnownVidalyticsIds,
} from "@workspace/blitz-curriculum";
import {
  parseBlitzCaptionFilename,
  applyBlitzCaptionAutofill,
  sanitizeVidalyticsId,
} from "../lib/blitz-caption-filename";

describe("parseBlitzCaptionFilename", () => {
  it("parses a well-formed Blitz caption filename and resolves the lesson title", () => {
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson11-01-clone-flexy-website__sJ7NhNU9POi7DpXV.vtt",
    );
    expect(meta).not.toBeNull();
    const lessonTitle = BLITZ_SECTION_BY_ID[11].title;
    expect(meta).toMatchObject({
      lessonNumber: 11,
      inLessonOrder: 1,
      slug: "clone-flexy-website",
      vidalyticsId: "sJ7NhNU9POi7DpXV",
      lessonTitle,
      transcriptType: "blitz_video",
    });
    // Title is human-readable, carries the resolved lesson title (matches the
    // Blitz page) plus the per-video topic, and is NOT the raw filename.
    expect(meta!.title).toBe(`Lesson 11 · ${lessonTitle} · Clone Flexy Website`);
    expect(meta!.provenanceNote).toContain("sJ7NhNU9POi7DpXV");
    expect(meta!.provenanceNote).toContain(lessonTitle);
    expect(meta!.provenanceNote).toContain("video 1");
  });

  it("preserves the in-lesson order for later videos of the same lesson", () => {
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson06-03-write-your-headline__AbC123xyz.srt",
    );
    expect(meta?.lessonNumber).toBe(6);
    expect(meta?.inLessonOrder).toBe(3);
    expect(meta?.slug).toBe("write-your-headline");
  });

  it("accepts placeholder video ids and records them in provenance", () => {
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson04-02-choose-your-network__VIDEO_ID_004.vtt",
    );
    expect(meta).not.toBeNull();
    expect(meta!.vidalyticsId).toBe("VIDEO_ID_004");
    expect(meta!.provenanceNote).toContain("VIDEO_ID_004");
  });

  it("falls back gracefully for an out-of-range lesson number (no curriculum title)", () => {
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson99-01-mystery-topic__ZZ999.vtt",
    );
    expect(meta).not.toBeNull();
    expect(meta!.lessonTitle).toBeNull();
    expect(meta!.title).toBe("Lesson 99 · Mystery Topic");
    expect(meta!.provenanceNote).toContain("unknown lesson");
  });

  it("matches regardless of file extension (and with none)", () => {
    expect(parseBlitzCaptionFilename("blitz-lesson01-01-intro__Vid1.txt")).not.toBeNull();
    expect(parseBlitzCaptionFilename("blitz-lesson01-01-intro__Vid1")).not.toBeNull();
  });

  it("strips a leading directory path", () => {
    const meta = parseBlitzCaptionFilename(
      "captions/batch/blitz-lesson05-01-pick-offer__Vid5.vtt",
    );
    expect(meta?.lessonNumber).toBe(5);
    expect(meta?.slug).toBe("pick-offer");
  });

  it("returns null for non-matching filenames (current behavior preserved)", () => {
    expect(parseBlitzCaptionFilename("random-transcript.vtt")).toBeNull();
    expect(parseBlitzCaptionFilename("coaching-call-2025-01-01.txt")).toBeNull();
    expect(parseBlitzCaptionFilename("blitz-lesson11-clone__Vid.vtt")).toBeNull(); // missing order
    expect(parseBlitzCaptionFilename("blitz-lesson11-01-no-id.vtt")).toBeNull(); // missing __id
    expect(parseBlitzCaptionFilename("")).toBeNull();
    expect(parseBlitzCaptionFilename(undefined)).toBeNull();
  });

  it("derives EVERY lesson a reused video appears in, live from the guide", () => {
    // KdXJA4N4m_Z_aW7Y is embedded across lessons 7, 8 and 9 in the guide.
    const expected = getBlitzLessonsForVideo("KdXJA4N4m_Z_aW7Y");
    expect(expected.length).toBeGreaterThan(1); // guard: real cross-lesson video
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson07-04-generate-images__KdXJA4N4m_Z_aW7Y.vtt",
    );
    expect(meta).not.toBeNull();
    expect(meta!.vidalyticsId).toBe("KdXJA4N4m_Z_aW7Y");
    expect(meta!.lessons).toEqual(expected);
    // Provenance enumerates the full cross-lesson placement.
    expect(meta!.provenanceNote).toContain(
      `Appears in Blitz lessons ${expected.join(", ")}.`,
    );
  });

  it("falls back to the parsed lesson when the id is not referenced in the guide", () => {
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson12-02-some-topic__totallyUnknownId123.vtt",
    );
    expect(meta).not.toBeNull();
    expect(meta!.lessons).toEqual([12]);
    // Single-lesson placement adds no cross-lesson clause.
    expect(meta!.provenanceNote).not.toContain("Appears in Blitz lessons");
  });

  it("recovers the clean Vidalytics id from a timestamp-mangled filename", () => {
    // Real-world munging: the clean id with an upload timestamp appended.
    const meta = parseBlitzCaptionFilename(
      "blitz-lesson07-04-generate-images__KdXJA4N4m_Z_aW7Y_1782858624128.vtt",
    );
    expect(meta).not.toBeNull();
    expect(meta!.vidalyticsId).toBe("KdXJA4N4m_Z_aW7Y");
    expect(meta!.rawVidalyticsId).toBe("KdXJA4N4m_Z_aW7Y_1782858624128");
    // The clean id still resolves the full cross-lesson set.
    expect(meta!.lessons).toEqual(getBlitzLessonsForVideo("KdXJA4N4m_Z_aW7Y"));
  });
});

describe("sanitizeVidalyticsId", () => {
  it("returns a known id unchanged", () => {
    expect(sanitizeVidalyticsId("KdXJA4N4m_Z_aW7Y")).toBe("KdXJA4N4m_Z_aW7Y");
  });

  it("trims whitespace and substitutes spaces for underscores to match a known id", () => {
    const known = [...getKnownVidalyticsIds()].find((id) => id.includes("_"));
    expect(known).toBeTruthy();
    const spaced = known!.replace(/_/g, " ");
    expect(sanitizeVidalyticsId(`  ${spaced}  `)).toBe(known);
  });

  it("recovers a known id that is a prefix of a junk-suffixed token", () => {
    expect(sanitizeVidalyticsId("KdXJA4N4m_Z_aW7Y_1782858624128")).toBe(
      "KdXJA4N4m_Z_aW7Y",
    );
    expect(sanitizeVidalyticsId("KdXJA4N4m_Z_aW7Y(1)")).toBe("KdXJA4N4m_Z_aW7Y");
  });

  it("keeps the leading id-shaped run for a brand-new unknown id", () => {
    expect(sanitizeVidalyticsId("brandNewId999.extra")).toBe("brandNewId999");
  });
});

describe("applyBlitzCaptionAutofill", () => {
  const sourceName = "blitz-lesson11-01-clone-flexy-website__sJ7NhNU9POi7DpXV.vtt";
  const lessonTitle = BLITZ_SECTION_BY_ID[11].title;

  it("fills all blank fields for a matching file", () => {
    const out = applyBlitzCaptionAutofill({ sourceName, content: "x" } as Record<string, unknown>);
    expect(out.title).toBe(`Lesson 11 · ${lessonTitle} · Clone Flexy Website`);
    expect(out.transcriptType).toBe("blitz_video");
    expect(out.inLessonOrder).toBe(1);
    expect(out.provenanceNote).toContain("sJ7NhNU9POi7DpXV");
    // The clean Vidalytics id is exposed for persistence.
    expect(out.vidalyticsId).toBe("sJ7NhNU9POi7DpXV");
  });

  it("autofills the clean id from a mangled filename but respects an explicit id", () => {
    const munged =
      "blitz-lesson07-04-generate-images__KdXJA4N4m_Z_aW7Y_1782858624128.vtt";
    const auto = applyBlitzCaptionAutofill({ sourceName: munged } as Record<string, unknown>);
    expect(auto.vidalyticsId).toBe("KdXJA4N4m_Z_aW7Y");

    const explicit = applyBlitzCaptionAutofill({
      sourceName: munged,
      vidalyticsId: "manualOverride",
    } as Record<string, unknown>);
    expect(explicit.vidalyticsId).toBe("manualOverride");
  });

  it("fills each blank field INDEPENDENTLY when some are pre-set", () => {
    // An explicit title must not block autofilling the other blank fields.
    const out = applyBlitzCaptionAutofill({
      sourceName,
      title: "My custom title",
    } as Record<string, unknown>);
    expect(out.title).toBe("My custom title"); // respected
    expect(out.transcriptType).toBe("blitz_video"); // still autofilled
    expect(out.inLessonOrder).toBe(1); // still autofilled
    expect(out.provenanceNote).toContain("sJ7NhNU9POi7DpXV"); // still autofilled
  });

  it("respects every explicitly provided field", () => {
    const out = applyBlitzCaptionAutofill({
      sourceName,
      title: "Custom",
      transcriptType: "coaching_call",
      provenanceNote: "manual note",
      inLessonOrder: 9,
    } as Record<string, unknown>);
    expect(out).toMatchObject({
      title: "Custom",
      transcriptType: "coaching_call",
      provenanceNote: "manual note",
      inLessonOrder: 9,
    });
  });

  it("treats blank/whitespace title and empty type as unset", () => {
    const out = applyBlitzCaptionAutofill({
      sourceName,
      title: "   ",
      transcriptType: "",
    } as Record<string, unknown>);
    expect(out.title).toBe(`Lesson 11 · ${lessonTitle} · Clone Flexy Website`);
    expect(out.transcriptType).toBe("blitz_video");
  });

  it("leaves non-matching files untouched (current behavior preserved)", () => {
    const input = { sourceName: "random-transcript.vtt", content: "x" } as Record<string, unknown>;
    const out = applyBlitzCaptionAutofill(input);
    expect(out).toBe(input);
    expect(out.title).toBeUndefined();
    expect(out.transcriptType).toBeUndefined();
  });
});
