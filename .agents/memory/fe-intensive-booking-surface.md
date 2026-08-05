---
name: FE-Intensive booking surface
description: Welcome-page native GHL booking for front-end buyers — dormant-config pattern, own table, born-enforced gating
---

- Store of record is its OWN `fe_intensive_bookings` table — deliberately NOT `call_bookings` (that table's NOT NULL polymorphic staff columns + reminder/step-advancement/partner consumers would need sentinels and risk cross-feature breakage). **Why:** an FE booking has no staff row and must never enter kickoff/partner/pack flows.
- Feature is DORMANT until an admin sets `fe_intensive_calendar_id` (optional `fe_intensive_location_id`) in system_settings (env fallback `FE_INTENSIVE_*`); unset ⇒ routes report `configured:false` and the Welcome page keeps its pending card. Config card lives in AdminSettings, saving via the generic settings PUT (auto audit-logged).
- Routes are born-enforced: router-scoped `requirePageAccess("frontend-welcome")` — fail-closed, admin/coach bypass.
- Book AND cancel share one per-member `pg_advisory_xact_lock`; cancel does GHL-first then row flip inside the lock (double-submit replays as `alreadyCanceled`, GHL called once).
- All member-facing booking copy (incl. support line + dialog labels) rides the `frontendWelcome.booking.ui` curriculum payload for brand tokens — nothing user-visible hardcoded in the component; keep FE type `FeBookingUiCopy` in sync with server content.
- **How to apply:** when the real calendar id arrives, set it in the admin card and run a live e2e booking — that step was explicitly deferred.
