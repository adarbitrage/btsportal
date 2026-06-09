---
name: Auth email links need matching SPA routes
description: Transactional email links must have a corresponding portal router route + page, or the link 404s on the SPA catch-all.
---

Every path embedded in a transactional email template (`seed-templates.ts`) must
have a matching wouter `<Route>` in the portal `App.tsx` AND a page that consumes
the token. The portal is an SPA: an unknown path falls through to the catch-all
NotFound, which renders inside whatever layout matches and looks like a broken
"logged-in but every tab bounces to login" state for an unauthenticated user.

**Why:** the password-reset flow shipped half-built — the email linked to
`/reset-password?token=...` and the backend `POST /api/auth/reset-password`
existed, but no `/reset-password` route or set-new-password page existed, so the
link 404'd. Requesting a reset (`/forgot-password`) and completing one
(`/reset-password`) are two distinct pages; don't assume one implies the other.

**How to apply:** when adding/changing an email link path, grep the template for
the path and confirm a route exists in `App.tsx`. Token-completion pages should
be plain `<Route>` (not GuestRoute) so they work regardless of session, mirror
`VerifyEmail.tsx`/`ForgotPassword.tsx` styling, and match the backend payload
field names exactly (reset uses `{ token, password }`).
