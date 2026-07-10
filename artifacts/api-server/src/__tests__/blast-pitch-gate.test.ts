import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { db, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { setPitchContent, __invalidatePitchContentCacheForTests } from "../lib/pitch-content-settings";
import { renderPitchHtmlForRank } from "../scripts/blast-all-emails";
import { renderPitchHtmlForRank as renderPitchHtmlForRankV2 } from "../scripts/blast-all-emails-v2";

// Task #1824: guard test proving the bulk blast scripts cannot bypass the
// VIP Arbitrage compliance gate. Both scripts render pitch HTML exclusively
// through the shared `renderGatedPitchBlock` seam — this asserts that
// end-to-end behavior directly against the scripts' own exported functions,
// not just the seam in isolation.

const KEY = "pitch.vip_arbitrage";

async function resetRow(): Promise<void> {
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, KEY));
}

beforeEach(async () => {
  await resetRow();
  __invalidatePitchContentCacheForTests();
});

afterAll(async () => {
  await resetRow();
  __invalidatePitchContentCacheForTests();
});

describe("blast scripts honor the VIP Arbitrage compliance gate", () => {
  it.each([
    ["blast-all-emails.ts", renderPitchHtmlForRank],
    ["blast-all-emails-v2.ts", renderPitchHtmlForRankV2],
  ])("%s never includes VIP Arbitrage content while reviewed=false, at every eligible rank", async (_label, renderFn) => {
    await setPitchContent(
      "VIP_ARBITRAGE_PITCH",
      {
        heading: "VIP Arbitrage Opportunity",
        line: "A distinctive marker string for this guard test.",
        buttonLabel: "Learn More",
        buttonUrl: "https://portal.test/vip-arbitrage",
        reviewed: false,
      },
      "test-runner",
    );
    __invalidatePitchContentCacheForTests();

    for (const rank of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const html = await renderFn(rank);
      expect(html).not.toContain("VIP Arbitrage Opportunity");
      expect(html).not.toContain("distinctive marker string");
    }
  });

  it.each([
    ["blast-all-emails.ts", renderPitchHtmlForRank],
    ["blast-all-emails-v2.ts", renderPitchHtmlForRankV2],
  ])("%s renders VIP Arbitrage content once reviewed=true is explicitly set", async (_label, renderFn) => {
    await setPitchContent(
      "VIP_ARBITRAGE_PITCH",
      {
        heading: "VIP Arbitrage Opportunity",
        line: "A distinctive marker string for this guard test.",
        buttonLabel: "Learn More",
        buttonUrl: "https://portal.test/vip-arbitrage",
        reviewed: true,
      },
      "test-runner",
    );
    __invalidatePitchContentCacheForTests();

    const html = await renderFn(0);
    expect(html).toContain("VIP Arbitrage Opportunity");
    expect(html).toContain("distinctive marker string");
  });
});
