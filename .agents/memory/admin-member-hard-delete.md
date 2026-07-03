---
name: Admin member hard-delete pipeline
description: Durable rules for super-admin-only hard-delete of member accounts — reference before touching related endpoints or building similar destructive-action tools.
---

A destructive account-deletion endpoint needs a fixed **target allow-list**, not a denylist: only
proceed when the target's role is exactly the intended "deletable" type. New roles added later must
be excluded by default, never silently become deletable because a denylist wasn't updated. Apply this
check first, before any other eligibility logic (financial history, confirmation, etc.) — and return
it from both the delete action and any accompanying "preview/eligibility" endpoint, since a preview
call is itself information a caller could act on.

Financial-history-style safety guards (any row in a payments/refunds/orders table blocks deletion)
must count via a query path that fails **closed**: if the count query itself errors, the guard must
propagate/throw, never coerce the error to `0` and let the destructive action proceed. The same logic
applies to external-system preconditions — e.g. a "booked" row with no external (GHL) appointment id
can't be proven canceled, so it must abort the whole operation rather than being skipped over.

A typed confirmation string (e.g. "type the member's email to confirm") must be compared with an
EXACT match — no trim/lowercase on either side. A case/whitespace-insensitive compare defeats the
deliberate friction the confirmation exists to add.

External-system side effects that can't be transactionally rolled back (GHL calendar cancellations)
must all be performed and verified successful BEFORE any DB write begins; abort with zero DB changes
if any one of them fails.

**Why:** these are the exact classes of gap a security-focused code review will flag on any
destructive admin action — missing target-type scoping, fail-open counters, loose confirmation
matching, and DB writes issued before an irreversible external call is confirmed.

**How to apply:** reuse this checklist for any future hard-delete/erasure endpoint (GDPR erasure,
self-service account deletion, bulk-delete tooling): target-role allow-list check → fail-closed
safety-guard counts → external-side-effects-first-then-abort-on-failure → single audit log entry with
explicit actor fields.

A read-only "preview/eligibility" GET for a guarded destructive action should return HTTP 200 with an
`eligible:false` + reason payload for every non-eligible case (blocked by role, financial history,
etc.), not 422 — the GET itself succeeded at computing the answer. Reserve 422 for the actual mutating
endpoint (the DELETE), where "blocked" really is a rejected request. Returning 422 from the GET forces
API clients to catch-and-parse an error response just to read a normal result, which is easy to get
wrong (client throws instead of surfacing the reason in the UI).
