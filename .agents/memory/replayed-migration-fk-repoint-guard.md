---
name: Replayed-migration FK repoint guard
description: When a later idempotent migration repoints a foreign key, the earlier migration must skip its legacy FK add on replay.
---
The companion-migration set is replayed in full on every post-merge/sync run. If migration B drops an FK from migration A and re-adds it pointing at a different table, then on every subsequent replay A re-adds the legacy FK before B drops it again. That works only while all rows still satisfy the legacy FK — it fails loudly (breaking post-merge setup) the moment rows reference ids valid only under the new target.

**Why:** kb_doc_provenance's doc_id FK was repointed from knowledgebase_docs to ai_live_documents; replay of the older migration re-added the legacy FK and started failing once provenance rows carried ai_live ids outside the legacy id range (it had passed earlier only by id-overlap luck).

**How to apply:** whenever a migration repoints/supersedes a constraint from an earlier migration, edit the EARLIER migration to guard its add with `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '<new constraint name>')` (keeping the duplicate_object handler for fresh envs). Fresh DBs still take the legacy path first, then get repointed.
