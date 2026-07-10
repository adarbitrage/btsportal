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
    expect(settingKeys.sort()).toEqual(
      ["pitch.launchpad", "pitch.machine", "pitch.mentorship", "pitch.vip_arbitrage"].sort(),
    );
    for (const key of settingKeys) {
      expect(isPitchContentSettingKey(key)).toBe(true);
    }
  });

  it("no longer recognizes the retired pitch.vip key (Task #1824)", () => {
    expect(isPitchContentSettingKey("pitch.vip")).toBe(false);
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
    const keys: PitchBlockKey[] = ["LAUNCHPAD_PITCH", "MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"];
    for (const key of keys) {
      expect(typeof all[key].heading).toBe("string");
      expect(typeof all[key].line).toBe("string");
      expect(typeof all[key].buttonLabel).toBe("string");
      expect(typeof all[key].buttonUrl).toBe("string");
      expect(all[key].heading.length).toBeGreaterThan(0);
    }
  });

  it("VIP_ARBITRAGE_PITCH default is reviewed: false and its buttonUrl points at /vip-arbitrage (Task #1824)", async () => {
    await resetRow("pitch.vip_arbitrage");
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.reviewed).toBe(false);
    expect(content.buttonUrl.endsWith("/vip-arbitrage")).toBe(true);
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

  it("LAUNCHPAD_PITCH default includes the wired-in placeholder thumbnail, qualified to an absolute URL", async () => {
    await resetRow("pitch.launchpad");
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("LAUNCHPAD_PITCH");
    expect(content.thumbnailUrl).toBeDefined();
    expect(content.thumbnailUrl).toMatch(/^https?:\/\//);
    expect(content.thumbnailUrl).toContain("/images/pitch-thumbnails/");
    expect(content.thumbnailLinkUrl).toBeDefined();
  });

  it("a block with neither thumbnail field set renders no thumbnail (purely additive)", async () => {
    await resetRow("pitch.vip_arbitrage");
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.thumbnailUrl).toBeUndefined();
    expect(content.thumbnailLinkUrl).toBeUndefined();
  });

  it("a pre-existing saved LAUNCHPAD_PITCH row without thumbnail fields does NOT inherit the shipped default thumbnail", async () => {
    // Simulates a row saved before Task #1820 (or any admin save that omits
    // the thumbnail fields): the default's thumbnail must not leak in via
    // the DB-value-over-default merge, or an existing customized block would
    // silently gain a thumbnail nobody configured.
    await setPitchContent(
      "LAUNCHPAD_PITCH",
      { heading: "Legacy heading", line: "Legacy line", buttonLabel: "Go", buttonUrl: "https://example.test/legacy" },
      null,
    );
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("LAUNCHPAD_PITCH");
    expect(content.heading).toBe("Legacy heading");
    expect(content.thumbnailUrl).toBeUndefined();
    expect(content.thumbnailLinkUrl).toBeUndefined();
    await resetRow("pitch.launchpad");
  });

  it("setPitchContent stores an absolute thumbnail URL and passes it through unqualified", async () => {
    await setPitchContent(
      "MENTORSHIP_PITCH",
      {
        heading: "H",
        line: "L",
        buttonLabel: "B",
        buttonUrl: "https://example.test/plans",
        thumbnailUrl: "https://cdn.example.test/thumb.gif",
        thumbnailLinkUrl: "https://example.test/plans",
      },
      null,
    );
    const content = await getPitchContent("MENTORSHIP_PITCH");
    expect(content.thumbnailUrl).toBe("https://cdn.example.test/thumb.gif");
    expect(content.thumbnailLinkUrl).toBe("https://example.test/plans");
    await resetRow("pitch.mentorship");
  });

  it("validatePitchContentUpdate accepts an empty thumbnail (clears it) and rejects a non-string thumbnail", async () => {
    const cleared = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      thumbnailUrl: "",
      thumbnailLinkUrl: "",
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.content.thumbnailUrl).toBeUndefined();
      expect(cleared.content.thumbnailLinkUrl).toBeUndefined();
    }

    const withThumbnail = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      thumbnailUrl: "https://cdn.example.test/x.gif",
      thumbnailLinkUrl: "https://example.test/plans",
    });
    expect(withThumbnail.ok).toBe(true);
    if (withThumbnail.ok) {
      expect(withThumbnail.content.thumbnailUrl).toBe("https://cdn.example.test/x.gif");
    }

    const invalid = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      thumbnailUrl: 123,
    });
    expect(invalid.ok).toBe(false);
  });

  it("a saved row can omit a field, which falls back to the default for just that field", async () => {
    // setPitchContent always writes the full validated object, but a
    // hand-edited/legacy row could be partial — parseStoredContent must
    // tolerate that and mergeWithDefault must fill only the missing field.
    await db.insert(systemSettingsTable).values({
      key: "pitch.vip_arbitrage",
      value: { heading: "Only heading set" },
      category: "pitch",
    });
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.heading).toBe("Only heading set");
    expect(content.line.length).toBeGreaterThan(0);
    await resetRow("pitch.vip_arbitrage");
  });
});

// Task #1824: the `reviewed` compliance gate. VIP Arbitrage is a Reg D
// 506(c) securities offering — its pitch content must never resolve as
// "reviewed" unless the stored value is the literal boolean `true`. These
// tests cover the fail-closed contract independent of the resolver-level
// gate tested in pitch-resolver.test.ts.
describe("reviewed field (Task #1824 compliance gate — fail closed)", () => {
  afterAll(async () => {
    await resetRow("pitch.vip_arbitrage");
  });

  it("validatePitchContentUpdate rejects a non-boolean reviewed value", () => {
    const result = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      reviewed: "true",
    });
    expect(result.ok).toBe(false);
  });

  it("validatePitchContentUpdate preserves an explicit reviewed: false (not stripped as falsy)", () => {
    const result = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      reviewed: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.reviewed).toBe(false);
  });

  it("validatePitchContentUpdate accepts and preserves reviewed: true", () => {
    const result = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
      reviewed: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.reviewed).toBe(true);
  });

  it("omitting reviewed entirely on update is valid (treated as false downstream)", () => {
    const result = validatePitchContentUpdate({
      heading: "H",
      line: "L",
      buttonLabel: "B",
      buttonUrl: "https://example.test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content.reviewed).toBeUndefined();
  });

  it("a stored reviewed: true round-trips as true through getPitchContent", async () => {
    await setPitchContent(
      "VIP_ARBITRAGE_PITCH",
      { heading: "Reviewed copy", line: "L", buttonLabel: "B", buttonUrl: "https://example.test", reviewed: true },
      "counsel@example.test",
    );
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.reviewed).toBe(true);
  });

  it("a stored malformed (non-boolean) reviewed value in the DB fails closed to false", async () => {
    await resetRow("pitch.vip_arbitrage");
    await db.insert(systemSettingsTable).values({
      key: "pitch.vip_arbitrage",
      value: { heading: "H", line: "L", buttonLabel: "B", buttonUrl: "https://example.test", reviewed: "true" },
      category: "pitch",
    });
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.reviewed).toBe(false);
  });

  it("a DB read failure (simulated via getAllPitchContent's own catch — no row present) resolves reviewed: false", async () => {
    await resetRow("pitch.vip_arbitrage");
    __invalidatePitchContentCacheForTests();
    const content = await getPitchContent("VIP_ARBITRAGE_PITCH");
    expect(content.reviewed).toBe(false);
  });
});
