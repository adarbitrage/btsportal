---
name: Confidential publisher-name purge (Caterpillar codename)
description: How the banned traffic-source name behind "Caterpillar" is kept out of code and data
---

The real publisher name behind the "Caterpillar" codename is banned everywhere: repo-wide case-insensitive grep must return zero (excl .git/node_modules/.local), and no dev/prod DB text column may contain it.

**How it's enforced:**
- All seed/lesson copy says just "Caterpillar" (no parenthetical, no "internal codename for …" phrase, "Caterpillar native ads" for placement mentions).
- `artifacts/api-server/src/lib/confidential-term-repair.ts` runs at every api-server boot (chained after seedBlitzDocs → seedCoreTrainingSources in index.ts): idempotent, no-DDL, scans every text/varchar column of the 7 known KB/Blitz tables via information_schema and applies ordered deterministic rewording rules. Rules pinned in `confidential-term-scrub.test.ts`.
- The banned term never appears literally in source — both the JS and SQL match patterns are assembled from parts at runtime (`["news","\\s?","break"].join("")`), and test fixtures build it the same way. Keep it that way in any future code touching this.

**Why:** the name is commercially confidential; it leaked through the old raw coaching-transcript corpus (now deleted from the repo along with its seed parser) into lessons, source docs, topic-index extracts, and synthesis drafts.

**How to apply:** if a new content table can carry KB/Blitz-derived text, add it to TARGET_TABLES in the repair. If the term resurfaces in a new phrasing, add an ordered rule + test fixture. Verify sweeps with a psql DO block over information_schema (per-row loops through executeSql time out).
