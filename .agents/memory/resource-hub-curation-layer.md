---
name: Resource Hub curation layer
description: How the member Resource Hub renders from a curation table over creative-drive storage, and the boot-hook rules that keep dev/prod in sync.
---

# Resource Hub curation layer

- The member Resource Hub renders entirely from a curation table layered OVER creative-drive file storage; the drive tables are untouched. Items are slug-keyed with kind file/external/group, a self-FK parent for one level of grouping, and a sub-group label.
- **Seeding rule:** boot seeds NEVER overwrite existing curation rows (admin edits always win); file-kind seeds match drive files by name and gracefully skip when the file record is absent (fresh environments just omit those cards).
- All hub data changes (folder reorg, renames, deletes, curation + glossary seeding, live-doc link repair, assistant-card rename) live in one advisory-locked idempotent boot hook — the prod-parity path; never one-off dev scripts.
- Glossary terms have draft/approved/rejected status; only approved terms are served to members; regeneration never touches approved terms.
- **Why:** schema push-force is forbidden; prod only receives data changes when it boots after Publish; admins own curation post-launch.
- **How to apply:** future hub content changes go through the admin Content page, not code; any new seeded item follows match-by-name + skip-if-absent + never-overwrite.

## Editor forms with nullable relations
When an edit dialog is initialized from a list row, every nullable relation (e.g. parent-group id) MUST be carried in the list payload and pre-populated in the editor — otherwise saving an unrelated field silently nulls the relation (data loss). Guarded by a portal test that edits a child item and asserts the parent linkage survives.

## Retired-page lockstep checklist (route removals)
When retiring member routes: content-access registry key, portal-nav-map package, sidebar, SPA redirects, live AI navigation truth docs (idempotent string-replace boot repair), assistant card titles (rename in place — title-keyed seeds duplicate otherwise), AND hardcoded route lists in the api-server nav-guard tests and the portal member-nav-vs-nav-map fixtures.
