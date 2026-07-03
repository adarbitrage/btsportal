---
name: Onboarding step-contract migrations chain, don't replace
description: When an onboarding/step-numbering contract is superseded again, keep the prior migration function and run migrations in historical order — don't delete the old one.
---

When a step-numbering contract changes a second time (e.g. 5-step -> 7-step -> 6-step), each mid-flight migration function must be **kept**, not replaced, and run in strict historical order at boot. A later migration's old->new map assumes the numbering left behind by the migration before it — deleting an earlier migration function (even though "superseded") breaks the chain for any member who never got remapped, and also breaks the build if anything still imports it (e.g. a boot-sequencing file).

**Why:** During a step-removal renumbering (7-step -> 6-step), the old 5-step -> 7-step migration function was overwritten instead of kept, silently breaking a boot-sequencing file's import and the boot sequence. It had to be restored from git history (`git show <prior-commit>:<path>`) with a caveat: the restored function must use **literal historical step numbers**, not the live step-numbering constant — that constant's values are reused with new meaning across contract versions, so referencing it from an old migration would silently corrupt the remap.

**How to apply:** Before removing/rewriting any step-migration function in favor of a new one, check whether older members might still be un-migrated and need the OLD function to run first. Keep old migration functions as literal-number, frozen snapshots; never point them at a "live" numbering constant. Verify with `git log -- <file>` / `git show <commit>:<file>` if a function's history is unclear.

A renumbering also leaves stray hardcoded step-number checks scattered outside the obvious onboarding files (e.g. a route guard's "let this exact step through" exception, or a test fixture hardcoding a step number as a stand-in for "in progress"). Full-repo grep for the OLD numeric step values (not just step names) after a renumbering, and run the FULL test suite (not just the files you touched) — a stale fixture value can silently keep passing against the new code by accident (wrong step, right redirect) yet still trip elsewhere.
