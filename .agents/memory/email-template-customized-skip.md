---
name: Admin-customized email templates skip starter refreshes
description: starter_hash NULL rows are never refreshed by boot seed; fix content via the admin editor PUT, not by touching seeds.
---

The boot seed (`ensureRequiredEmailTemplates`) refreshes an email template's
content only when its `starter_hash` matches a known starter revision.
A row with `starter_hash` NULL is treated as admin-customized and is
skipped forever (boot logs `skippedCustomized=[...]`). A stale-footer or
stale-copy bug on such a row can NEVER be fixed by editing
seed-templates.ts.

**Why:** the skip is a deliberate guarantee that boot never clobbers an
admin's edits; also note leftover test writes ("ADMIN OVERRIDE ..." rows in
the shared dev DB) null the hash and silently freeze a template.

**How to apply:** fix the row the way an admin would — PUT the corrected
HTML through `/api/admin/communications/email-templates/:id` (records a
version snapshot + audit entry; keeps starterHash NULL). A working one-shot
script (login as founding super admin, PUT starter content, verify footer,
real SendGrid test send via temp workflow with DEV_EMAIL_ALLOWLIST) exists:
`artifacts/api-server/src/scripts/fix-signup-attempted-footer.ts`.

**Dev/prod split:** customization state is PER-DATABASE. signup_attempted was
admin-owned (NULL hash) only in dev; prod's row stayed starter-tracked, so the
publish-time boot refresh fixed prod's footer automatically — always read-only
query prod's starter_hash before assuming prod needs the dev repair. Also: the
audit-writes test has clobbered the shared dev row before ("ADMIN OVERRIDE for
audit-writes test", NULL hash); restore from starter content if seen.

**Test rule (fixed July 2026):** tests must NEVER mutate a real starter-slug
email_templates row in place — afterAll restore doesn't run on a crashed
suite. Restore-default tests use a throwaway slug + a vi.mock of
seed-templates overriding BOTH getStarterEmailTemplate AND
listStarterEmailTemplateSlugs (the route's STARTER_SLUG_SET is frozen at
module import, so the fixture slug must come from vi.hoisted, not beforeAll).
