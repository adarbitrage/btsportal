---
name: Directly editing kb_staging_docs draft content
description: Techniques + traps for a direct DB data-editing pass on kb_staging_docs draft bodies (no boot hook/migration/seed).
---

When asked to do a direct content-editing pass on Document Review drafts (kb_staging_docs rows) — edit rows in place, NOT via a boot/startup hook, migration, or seed script.

**Effective draft text** = `edited_content ?? content` (only ~1 row usually has edited_content non-null). If the target string lives in both columns for a row, clean both, else the override resurfaces the old text.

**Move exact text in/out of executeSql via base64**, never raw CSV. executeSql returns a CSV-ish `output` string, so multi-line/unicode content mangles.
- Read: `SELECT replace(encode(convert_to(col,'UTF8'),'base64'), chr(10), '')` (strip the wrap newlines), then `Buffer.from(v,'base64').toString('utf8')`.
- Write: `UPDATE ... SET col = convert_from(decode('<b64>','base64'),'UTF8')` — sidesteps all quote/escaping issues.

**Per-row executeSql loops over ~80+ rows TIME OUT at the 600s code_execution cap** (fetch+write = 2 calls/row). Batch the *fetch* into one query with `string_agg(id || ':' || replace(encode(...),chr(10),''), '|')` and parse in JS; the writes (one UPDATE/row) are the unavoidable cost, so keep the row set small per call or resume in chunks (re-query which rows still match).

**Attached prompt/instruction files can be CRLF.** A "verbatim" passage to inject will carry `\r\n`; KB doc bodies use `\n`. Normalize the injected text to LF — introducing `\r` corrupts consistency. A false "not verbatim" check is usually just this line-ending diff.

**Scaffolding removal must be exact-match.** Only the line exactly equal to `## Related topics` (+ its blank/`**label:**`/`- bullet` block) is scaffolding. Plain-text sections like "Related topics", "Related knowledge topics", "Related topics for deeper mastery" are legitimate content — do NOT remove them.

**Live-doc contradiction sweeps:** apply spec'd find-and-replace edits via a Node script in ONE transaction with exact single-match guards (throw on missing or ambiguous OLD text) and run the spec's forbidden-phrase verification BEFORE commit, rolling back on failure. Corpus-wide phrase verification can catch docs outside the spec's edit list (e.g. a doc echoing the old workflow) — fix those with minimal analogous edits and report them. ai_live_documents.search_vector is GENERATED from title+content, so content UPDATE alone refreshes retrieval.
