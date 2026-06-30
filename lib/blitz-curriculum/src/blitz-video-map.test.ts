import { describe, it, expect } from "vitest";
import {
  getBlitzVideoMap,
  getBlitzLessonsForVideo,
  getBlitzVideoInfo,
  getKnownVidalyticsIds,
} from "./blitz-video-map";

describe("blitz video map (derived live from the guide HTML)", () => {
  it("derives a non-trivial set of videos", () => {
    const map = getBlitzVideoMap();
    // The guide currently has ~48 distinct videos; assert a sane floor so the
    // derivation can't silently collapse to nothing if the markup shifts.
    expect(map.byVideoId.size).toBeGreaterThan(40);
    expect(getKnownVidalyticsIds().size).toBe(map.byVideoId.size);
  });

  it("links a cross-lesson video to every lesson it appears in", () => {
    // "Using AI to Generate Ad Images" is embedded in lessons 7, 8 and 9.
    expect(getBlitzLessonsForVideo("KdXJA4N4m_Z_aW7Y")).toEqual([7, 8, 9]);
    // "Prepare Headlines and Image for Compliance" likewise.
    expect(getBlitzLessonsForVideo("EC_PTyt0Q22CX9lR")).toEqual([7, 8, 9]);
    // A two-lesson video.
    expect(getBlitzLessonsForVideo("W7ErW0djTSt_xAzc")).toEqual([8, 9]);
  });

  it("links a single-lesson video to exactly one lesson", () => {
    // "Watch This First: What Is Affiliate Arbitrage?" lives only in lesson 1.
    expect(getBlitzLessonsForVideo("x_8mSUUqDIhXNyQP")).toEqual([1]);
  });

  it("returns [] for an unknown id", () => {
    expect(getBlitzLessonsForVideo("not-a-real-id")).toEqual([]);
    expect(getBlitzVideoInfo("not-a-real-id")).toBeNull();
  });

  it("records per-lesson placement order and title", () => {
    const info = getBlitzVideoInfo("KdXJA4N4m_Z_aW7Y");
    expect(info).not.toBeNull();
    expect(info!.lessons).toEqual([7, 8, 9]);
    expect(info!.placements.length).toBeGreaterThanOrEqual(3);
    expect(info!.title).toBeTruthy();
  });
});
