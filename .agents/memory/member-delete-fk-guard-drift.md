---
name: Member-delete FK guard catches other features' drift
description: Why the admin-member-delete FK exhaustiveness test fails for unrelated features, and how to fix each class
---

The FK exhaustiveness guard in the admin member hard-delete test suite scans the LIVE shared dev DB for every FK referencing users.id and requires each constraint name to be classified in the test's knownConstraints set.

**Why:** Any merged feature that adds a user-referencing FK (common with KB reviewer/actor columns) makes this test fail even though your change is unrelated. Seen July 2026: several KB reviewer FKs + campaign_checklist_progress.

**How to apply:**
- SET NULL / CASCADE delete_rule → just add the constraint name to the matching section of knownConstraints.
- NO ACTION on a member-data table → also add an explicit `tx.delete(...)` for that table in the hard-delete transaction in admin-panel.ts (PIPELINE section), placed with the other per-user data deletes.
- Never blindly classify a NO ACTION FK as known without pipeline handling — the delete would 23503 in prod.
