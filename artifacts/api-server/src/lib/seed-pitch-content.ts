/**
 * Task #1899: insert-only boot seed for the five email pitch-block content
 * rows. Runs idempotently at server startup — any block that already has a
 * saved `system_settings` row (i.e. an owner edit) is skipped, so this seed
 * can never clobber an admin's changes.
 *
 * The five blocks seeded here are the approved live copy supplied by the owner.
 * VIP_ARBITRAGE_PITCH is intentionally NOT touched — it stays behind the
 * fail-closed `reviewed` counsel gate and must never be seeded without
 * explicit counsel sign-off (see pitch-resolver.ts's `isPitchBlockReviewed`).
 */

import { setPitchContentIfAbsent } from "./pitch-content-settings";

const MACHINE_URL = "https://portal.buildtestscale.com/the-machine";
const UPGRADE_URL = "https://portal.buildtestscale.com/upgrade";

export async function seedPitchContent(): Promise<void> {
  const results = await Promise.all([
    // 1. MACHINE_PITCH — full commission-claim pitch for ranks 2+ (mentorship tiers and VIP)
    setPitchContentIfAbsent("MACHINE_PITCH", {
      heading: "The Machine — Included With Your Membership",
      body: "*Exactly like our team told you* — as a Build Test Scale member, **The Machine is yours to use, completely free.** It\u2019s the same AI-powered campaign engine our top affiliates run on: it builds your pages, writes your ads, wires up your tracking links, and optimizes everything automatically while the results roll into one dashboard. And here\u2019s the part that makes it a no-brainer: **you can point The Machine at the mentorship itself.** That means you can promote the very program you\u2019re already inside, **earn a commission on every new member you refer**, and let the software do the heavy lifting \u2014 *no content to create, no tech to configure, no extra software bill.* It\u2019s included in your membership for one simple reason: __when you grow, we grow.__ Claim your free access, hit **Initialize**, and put The Machine to work today.",
      buttonLabel: "Put The Machine to Work",
      buttonUrl: MACHINE_URL,
    }),

    // 2. MACHINE_INTRO_PITCH — softer intro for ranks 0–1 (no commission claim)
    setPitchContentIfAbsent("MACHINE_INTRO_PITCH", {
      heading: "Meet The Machine",
      body: "The Machine is the AI-powered campaign engine our top affiliates run on \u2014 it builds your pages, writes your ads, wires your tracking, and optimizes everything automatically. **Mentorship members get it included free** \u2014 plus the ability to point it at BTS itself and earn on every member they refer. *One more reason the upgrade pays for itself.*",
      buttonLabel: "See The Machine",
      buttonUrl: MACHINE_URL,
    }),

    // 3. LAUNCHPAD_PITCH — rank 0 (free/frontend-only members)
    setPitchContentIfAbsent("LAUNCHPAD_PITCH", {
      heading: "Ready for the Full System?",
      body: "You\u2019ve taken the first step \u2014 **LaunchPad is where it turns into momentum.** You\u2019ll get a **one-on-one kickoff call** with a BTS coach who maps out your plan, live LaunchPad group sessions, and the full training track that takes you from first lesson to first campaign. *No guesswork, no going it alone* \u2014 a clear path and a team that\u2019s walked it before.",
      buttonLabel: "Upgrade to LaunchPad",
      buttonUrl: UPGRADE_URL,
    }),

    // 4. MENTORSHIP_PITCH — rank 1 (LaunchPad members)
    setPitchContentIfAbsent("MENTORSHIP_PITCH", {
      heading: "Take the Next Step with Mentorship",
      body: "You\u2019ve built the foundation \u2014 **Mentorship is where the doors open.** You\u2019ll be paired with a **personal accountability partner** who walks with you through the entire program, join **live group coaching calls**, unlock the full BTS community, and gain **affiliate commissions** \u2014 including promoting BTS itself and earning on every member you refer.",
      buttonLabel: "View Mentorship Plans",
      buttonUrl: UPGRADE_URL,
    }),

    // VIP_ARBITRAGE_PITCH intentionally skipped — stays behind the fail-closed
    // `reviewed` counsel gate. Do not seed it without explicit counsel sign-off.
  ]);

  const inserted = results.filter(Boolean).length;
  if (inserted > 0) {
    console.log(`[seedPitchContent] Seeded ${inserted} new pitch content block(s).`);
  }
}
