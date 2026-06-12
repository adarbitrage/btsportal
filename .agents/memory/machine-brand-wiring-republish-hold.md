---
name: Machine brand-wiring republish hold
description: Why the merged Machine front-end brand grant fix is intentionally NOT live in prod, and the condition for releasing it.
---

# Machine brand-wiring: merged-but-intentionally-not-live

The BTS portal changes that make Machine brand buyers receive their own product
(the 5 front-end brands: `backroad`, `offmarket`, `reserve_income`,
`silent_partner`, `test_like_mad`) are **merged to the codebase but deliberately
NOT republished to production**. The receiver fix only takes effect on republish,
so until then prod brand purchases still fall back to `yse_front_end`.

**Why:** There is zero brand traffic today, so "merged but not live" is safe. The
plan is ONE coordinated republish of **both** codebases (BTS portal + The Machine)
done together once The Machine's final phase (Tapfiliate) is built — a single
coordinated deploy avoids intermediate half-synced states between the two systems.

**STATUS UPDATE (2026-06-12):** The BTS side of this hold was released EARLY. A
production login outage (junk `TURNSTILE_SECRET_KEY` blocking all logins) forced
a BTS republish to pick up the corrected secret, and the user explicitly approved
shipping the held brand-wiring along with it (safe today — zero brand traffic).
So BTS brand-wiring is now LIVE. The Machine side still needs its deploy after
Tapfiliate; the "coordinated single deploy" is no longer possible — sequence The
Machine's deploy and run the YSE parity check then.

**How to apply:**
- BTS brand-wiring is already live as of the captcha-fix republish — do not treat
  it as "merged but not live" anymore.
- The remaining pending item is The Machine's deploy (post-Tapfiliate). After it
  ships, run the production YSE byte-identical parity check (confirm YSE
  purchases are unaffected).
