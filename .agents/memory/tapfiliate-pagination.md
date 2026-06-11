---
name: Tapfiliate list pagination
description: Tapfiliate 1.6 list endpoints paginate (~25/page) and must be looped via ?page=N
---

Tapfiliate API 1.6 list endpoints (e.g. `/programs/`) return a **paginated** plain
JSON array, ~25 items per page, advanced via `?page=N` (1-indexed). There is no
working `per_page`. An empty array signals the end.

**Why:** A single unpaginated `GET /programs/` only returned the first 25 programs,
so programs on page 2+ (e.g. "Heat Haven") silently went missing from the Media
Mavens admin dropdown. Looked like a fetch bug; was really missing pagination.

**How to apply:** Any "list everything" call to Tapfiliate must loop pages,
accumulate, de-dupe by `id`, and stop on an empty page (or when no new ids appear,
to guard against an API that ignores `page`). Keep a sane max-page cap.

Base URL is `https://api.tapfiliate.com/1.6` (NOT `tapfiliate.com/api/1.6`, which
404s with HTML). Single `TAPFILIATE_BASE` constant in `artifacts/api-server/src/lib/tapfiliate.ts`.
