---
name: Concierge live-row at-a-glance summary
description: Durable constraints behind the concierge submissions view (per-row detail fetch, shared status labels, Compliance scope)
---

Concierge submissions ARE support tickets (category `concierge_task`); there is
no separate concierge entity or structured "selected tasks" field.

**Constraint that drives the design:** the ticket *list* endpoint carries no
messages and no attachments, and selected tasks live only inside the member's
intake message body. So any row-level summary (task(s) + file count) requires a
per-row ticket *detail* fetch — there is no cheaper source. Accept the fan-out;
it only ever adds info to a row that already shows offer+date.

**Scope decisions (don't undo without a reason):**
- Member-facing ticket status grouping + labels are centralized in
  `@workspace/support-config` so member and admin views can't drift. Concierge
  consumes them; the admin queue was intentionally left on its own map.
- Compliance keeps its own "Under review" wording — that's deliberate domain
  phrasing, not drift. Only Concierge's spec mandates the row summary; do not
  retrofit Compliance.
