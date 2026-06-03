import { describe, expect, it } from "vitest";
import { BLITZ_SECTION_IDS } from "@workspace/blitz-curriculum";
import { LESSON_CONTENT } from "../BlitzHub";
import { LESSON_LABELS, LESSON_SHORT_TITLES } from "../Blitz";
import { LESSON_TITLES as CONTINUE_CARD_TITLES } from "../../components/blitz/BlitzContinueCard";

// The Blitz curriculum skeleton (ids, phases, titles, anchors) is owned by the
// shared @workspace/blitz-curriculum package. Each portal surface keeps only
// its own presentation maps keyed by that id set. These guards fail loudly if a
// section is added/removed in the shared source without updating the matching
// portal copy — otherwise a lesson would silently render with no description,
// label, or pager title.
describe("portal Blitz presentation maps track the shared skeleton", () => {
  const sharedIds = [...BLITZ_SECTION_IDS].sort((a, b) => a - b);

  const idsOf = (map: Record<number, unknown>) =>
    Object.keys(map)
      .map(Number)
      .sort((a, b) => a - b);

  it("lesson-hub descriptions cover exactly the shared section ids", () => {
    expect(idsOf(LESSON_CONTENT)).toEqual(sharedIds);
  });

  it("guide chrome labels cover exactly the shared section ids", () => {
    expect(idsOf(LESSON_LABELS)).toEqual(sharedIds);
  });

  it("guide pager short titles cover exactly the shared section ids", () => {
    expect(idsOf(LESSON_SHORT_TITLES)).toEqual(sharedIds);
  });

  it("continue-card labels cover exactly the shared section ids", () => {
    expect(idsOf(CONTINUE_CARD_TITLES)).toEqual(sharedIds);
  });
});
