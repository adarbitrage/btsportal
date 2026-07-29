---
name: Home (/) vs Dashboard (/dashboard) terminology trap
description: Two distinct member pages; most "dashboard" labels actually point at Home. /dashboard is hidden.
---

The member portal has TWO distinct pages that get called "dashboard":
- `/` → `pages/Home.tsx` — the "Welcome back" orientation page (7 Pillars,
  first steps). This is the post-login landing and where `navigate("/")`
  buttons go, even when their label says "dashboard".
- `/dashboard` → `pages/Dashboard.tsx` — the accountability-partner panel
  page. HIDDEN as of July 2026 (route replaced with a redirect to `/`; file
  deliberately kept on disk). The user wants nothing pointing there.

**Why:** conflating the two produced a whole wrong plan (rerouting checkout
success "away from the dashboard" when it already went to Home). Button
labels are unreliable — check the actual href/navigate target.

**How to apply:** before "hiding the dashboard" or rerouting anything, grep
for the literal path. Coach/admin/partner dashboards (`/coach/dashboard`
etc.) are separate, real, and untouched. Post-purchase, Checkout calls
`refreshUserQuietly()` (non-destructive auth refresh that never clears the
user on failure) so onboarding re-entry guards see fresh state — don't swap
it back to `refreshAuth()`, which logs the member out on a transient failure.
