import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { db, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import {
  getAllPitchContent,
  getPitchContent,
  setPitchContent,
  validatePitchContentUpdate,
  isPitchContentSettingKey,
  getPitchContentSettingKeys,
  __invalidatePitchContentCacheForTests,
  type PitchBlockKey,
} from "../lib/pitch-content-settings";

// Task #1715: editable pitch content, DB value (per-field) over shipped
// default. Cleans up any row it writes so re-runs don't leak state into
// other tests that call getAllPitchContent().

const settingKeys = getPitchContentSettingKeys();

async function resetRow(key: string): Promise<void> {
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, key));
}

beforeEach(async () => {
  __invalidatePitchContentCacheForTests();
});

afterAll(async () => {
  await db.delete(systemSettingsTable).where(inArray(systemSettingsTable.key, settingKeys));
  __invalidatePitchContentCacheForTests();
});

describe("isPitchContentSettingKey / getPitchContentSettingKeys", () => {
  it("recognizes all four reserved pitch.* keys", () => {
    expect(settingKeys.sort()).toEqual(["pitch.launchpad", "pitch.machine", "pitch.mentorship", "pitch.vip"].sort());
    for (const key of settingKeys) {
      expect(isPitchContentSettingKey(key)).toBe(true);
    }
  });

  it("rejects unrelated keys", () => {
    expect(isPitchContentSettingKey("oncall.pagerduty_key")).toBe(false);
    expect(isPitchContentSettingKey("branding.portal_url")).toBe(false);
  });
});

describe("validatePitchContentUpdate", () => {
  it("accepts a fully-populated content object and trims whitespace", () => {
    const result = validatePitchContentUpdate({
      heading: "  Hello  ",
      line: "  World  ",
      buttonLabel: " Go ",
      buttonUrl: " https://example.test/plans ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toEqual({
        heading: "Hello",
        line: "World",
        buttonLabel: "Go",
        buttonUrl: "https://example.test/plans",
      });
    }
  });

  it("rejects a non-object body", () => {
    expect(validatePitchContentUpdate(null).ok).toBe(false);
    expect(validatePitchContentUpdate("nope").ok).toBe(false);
    expect(validatePitchContentUpdate([]).ok).toBe(false);
  });

  it("rejects a missing or empty required field", () => {
    const missing = validatePitchContentUpdate({ heading: "H", line: "L", buttonLabel: "B" });
    expect(missing.ok).toBe(false);

    const empty = validatePitchContentUpdate({ heading: "H", line: "L", buttonLabel: "  ", buttonUrl: "u" });
    expect(empty.ok).toBe(false);
  });
});

describe("getAllPitchContent / getPitchContent (default fallback + DB override)", () => {
  it("falls back to the shipped placeholder default when no DB row exists", async () => {
    await resetRow("pitch.launchpad");
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("LAUNCHPAD_PITCH");
    expect(content.heading).toContain("[Placeholder]");
    expect(content.buttonUrl.endsWith("/plans")).toBe(true);
  });

  it("returns a well-formed PitchContent for every block key", async () => {
    const all = await getAllPitchContent();
    const keys: PitchBlockKey[] = ["LAUNCHPAD_PITCH", "MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_PITCH"];
    for (const key of keys) {
      expect(typeof all[key].heading).toBe("string");
      expect(typeof all[key].line).toBe("string");
      expect(typeof all[key].buttonLabel).toBe("string");
      expect(typeof all[key].buttonUrl).toBe("string");
      expect(all[key].heading.length).toBeGreaterThan(0);
    }
  });

  it("DB value overrides the shipped default once saved", async () => {
    await setPitchContent(
      "MENTORSHIP_PITCH",
      { heading: "Custom Heading", line: "Custom line", buttonLabel: "Custom CTA", buttonUrl: "https://example.test/custom" },
      "test@example.test",
    );
    const content = await getPitchContent("MENTORSHIP_PITCH");
    expect(content).toEqual({
      heading: "Custom Heading",
      line: "Custom line",
      buttonLabel: "Custom CTA",
      buttonUrl: "https://example.test/custom",
    });
    await resetRow("pitch.mentorship");
  });

  it("setPitchContent invalidates the cache so the next read is fresh", async () => {
    await setPitchContent(
      "MACHINE_PITCH",
      { heading: "First", line: "L", buttonLabel: "B", buttonUrl: "https://example.test/1" },
      null,
    );
    expect((await getPitchContent("MACHINE_PITCH")).heading).toBe("First");

    await setPitchContent(
      "MACHINE_PITCH",
      { heading: "Second", line: "L", buttonLabel: "B", buttonUrl: "https://example.test/2" },
      null,
    );
    expect((await getPitchContent("MACHINE_PITCH")).heading).toBe("Second");
    await resetRow("pitch.machine");
  });

  it("a saved row can omit a field, which falls back to the default for just that field", async () => {
    // setPitchContent always writes the full validated object, but a
    // hand-edited/legacy row could be partial — parseStoredContent must
    // tolerate that and mergeWithDefault must fill only the missing field.
    await db.insert(systemSettingsTable).values({
      key: "pitch.vip",
      value: { heading: "Only heading set" },
      category: "pitch",
    });
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_PITCH");
    expect(content.heading).toBe("Only heading set");
    expect(content.line.length).toBeGreaterThan(0);
    await resetRow("pitch.vip");
  });
});
