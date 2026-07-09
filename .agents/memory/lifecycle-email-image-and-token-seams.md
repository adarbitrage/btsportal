---
name: Lifecycle email image qualification + token guard
description: How lifecycle email images are made Gmail-safe and how the raw-token bug was actually caused by a test script, not the template engine.
---

Absolute-image qualification lives in ONE helper (`qualifyPublicAssetUrl` in
`seed-templates.ts`), called by `renderPersonBlock` for staff/partner photos
and by `communication-service.ts::renderLogoHtml` (exported pure fn used by
`getCommonVariables`) for the logo. The helper never trusts the runtime
portal URL for asset hosting: `resolveEmailAssetHost()` rejects dev-internal
hostnames (localhost / 127.* / ::1 / *.local / *.replit.dev / *.repl.co —
NOT *.replit.app, which is a real prod host) and falls back to the canonical
`https://portal.buildtestscale.com`; dev-internal *absolute* stored URLs get
re-based onto the canonical host too. `/objects/...` paths degrade to `null`
(initials-avatar fallback) rather than a broken-image box.

**Why:** Gmail proxies every image and refuses relative/dev-host URLs. The
original regression: emails sent from dev qualified img srcs against the dev
default (`http://localhost:5000/...`), shipping broken logos to real inboxes.
A structural guard test (`email-img-src-structural-guard.test.ts`) renders
EVERY starter template through the real seams under worst-case portal URLs
(localhost / null / replit.dev) and fails any `<img src>` not on the
canonical host — keep it in lockstep when adding templates or img seams.

**The "raw `{{token}}` in Gmail" bug was NOT a template/interpolation bug.**
The template and `replaceVariables()` were correct. The actual bug was that
`scripts/preview-emails.ts`'s real-send test call for `kickoff_call_reminder`
simply omitted `staff_name`/`call_date`/`call_time` from its `variables`
object — so the send-site variable *supply* was incomplete, not the render
engine.

**How to apply:** When a lifecycle email ships a raw token in production,
suspect the send-site variable-building code (real route handler AND any
preview/test script that exercises the same template) before touching
`replaceVariables` or the template string itself. A structural guard test
(`lifecycle-email-token-guard.test.ts`) now renders every lifecycle
slug×send-site variable set and fails on any leftover `{{`, but only catches
this class of bug if the guard's fixtures are kept in lockstep with the real
send-site variable-building code — mirror it, don't invent a superset.

**Gmail dark-mode footer lock.** The dark navy legal footer `<td>` in
`wrapHtml()` (seed-templates.ts) carries `bgcolor` + `data-ogsb`/`data-ogsc`
attributes AND `background:#0f172a !important;background-color:#0f172a
!important` to prevent dark-mode clients from inverting it into unreadable
text. **How to apply:** keep these when touching the footer; any `wrapHtml`
change propagates to all ~52 seeded templates on next boot via the
starterHash refresh in `ensureRequiredEmailTemplates` (admin-customized rows
are skipped). Actual visual Gmail dark-mode verification requires a human
with inbox access — agents cannot open Gmail.
