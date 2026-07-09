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
