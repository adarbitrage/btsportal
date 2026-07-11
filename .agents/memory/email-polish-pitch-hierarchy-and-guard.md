---
name: Email polish — pitch hierarchy, footer scale, img-src guard, acceptance sends
description: Pitch-stack visual hierarchy convention, the structural img-src regression guard, and how to force a real (non-suppressed) email send from a script for acceptance testing.
---

## Pitch stack visual hierarchy
`renderPitchBlock` (seed-templates.ts) takes a `PitchBlockPosition` ("primary" | "secondary" | "tertiary"). The stack renderer (`renderPitchStackHtml` in pitch-resolver.ts) assigns position by index (0→primary, 1→secondary, 2+→tertiary) and owns the SINGLE divider above the whole stack — individual blocks never render their own `border-top`. Tertiary blocks get a plain text-link CTA, not a button.

**Why:** the pre-fix version gave every stacked pitch identical weight and its own divider, so a multi-pitch stack read as several separate ads. Position-aware rendering plus one shared divider makes it read as "one offer + smaller mentions."

**How to apply:** any future change to pitch content/rendering must preserve: (a) the position parameter threading through renderPitchStackHtml, (b) exactly one divider per stack regardless of stack length, (c) no per-block divider.

## Structural img-src absolute-host guard
`email-img-src-absolute-guard.test.ts` must exercise the REAL send-time path (`CommunicationService.sendEmailNow` with `sgMail.send` mocked to capture, a real DB-backed portal URL row, and every starter template copied into test-tagged rows), not hand-built "common variables" — a test that reimplements `getCommonVariables`'s output locally can stay green while the real seam (logo qualification, person-block `<img>` qualification) regresses. It asserts every `<img src>` in the captured send matches `^https://portal\.buildtestscale\.com/`, covering all pitch-stack positions and an unqualified person-block photo path, plus a negative-control block proving the regex actually rejects known-bad shapes (relative path, http, localhost, other host) — don't remove that block, it's what proves the guard isn't a tautology.

**Why:** the recurring broken-logo bug came from ad-hoc scripts resolving the portal URL to the dev default when run outside a workflow (no PORTAL_URL in env); a first draft of this guard also fell into the same trap by asserting against manually-constructed variables instead of the real send path, so it couldn't have caught a regression in the qualification seam itself.

**How to apply:** any new template or new img-bearing render helper (logo, person block, pitch block, etc.) must be covered by this test — sent through `sendEmailNow`, never via variables assembled by the test itself — before shipping. Do not weaken the regex.

## Getting an acceptance script to actually send (not dev-suppressed)
All outbound email/SMS go through `lib/email-transport.ts`'s dev-suppression gate, which no-ops everything unless `NODE_ENV==="production"` OR the recipient is in `DEV_EMAIL_ALLOWLIST` (comma-separated addresses, or "*"). For a one-off acceptance-send script run via a temp console workflow, set `DEV_EMAIL_ALLOWLIST=<recipient>` in that workflow's env — do NOT flip `NODE_ENV=production` just to get a test email out, and do NOT use "*" for anything but test-setup.ts.

**Why:** without the allowlist, `sendEmailNow` returns `status: "skipped", reason: "dev_suppressed"` — the script "succeeds" but nothing is delivered, which looks like the images/links are fine when actually nothing was ever sent.
