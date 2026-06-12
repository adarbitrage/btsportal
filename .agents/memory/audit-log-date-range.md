---
name: Audit-log date-range filter boundaries
description: How the audit-log start/end date filter is parsed on the server and the end-of-day inclusivity rule.
---

# Audit-log date-range filter

The Audit Log page sends `startDate`/`endDate` as **date-only** strings
(`<input type="date">` → "YYYY-MM-DD"). Both the read endpoint
(`/admin/audit-log`) and the export endpoint (`/admin/audit-log/export`) in
`artifacts/api-server/src/routes/admin-panel.ts` parse them through the shared
`parseAuditDateBoundary(raw, "start"|"end")` helper.

**Rule:** a bare date for the **end** boundary is expanded to `23:59:59.999Z`,
so the chosen end day is included; the **start** boundary maps to `00:00:00.000Z`.
Values that already carry a time component are used verbatim.

**Why:** a naive `new Date("2026-06-12")` is UTC midnight. Used as a `<=` end
ceiling it silently drops the entire end day, so a compliance reviewer who set
the end date to the incident day would see none of that day's rows.

**How to apply:** keep both endpoints routing every date boundary through
`parseAuditDateBoundary` (never raw `new Date(endDate)`); they must stay in
lockstep or read counts and export contents diverge. Boundaries are evaluated in
**UTC**, while the page's separate Jump-to picker renders in the admin's local
timezone — a non-UTC reviewer's day filter can therefore be offset; revisit if
timezone-correct day filtering is requested.
