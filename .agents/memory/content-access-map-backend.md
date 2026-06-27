---
name: Content Access Map backend
description: Data layer, resolver, registry, and API for the admin-editable page-level access control system.
---

# Content Access Map backend

## Key files
- Schema: `lib/db/src/schema/content-access-map.ts` (contentAccessMapTable)
- Companion SQL: `lib/db/drizzle/0073_content_access_map.sql`
- Registry: `lib/content-access-registry/src/index.ts` (@workspace/content-access-registry)
- Resolver: `artifacts/api-server/src/lib/content-access-resolver.ts`
- Routes: `artifacts/api-server/src/routes/content-access.ts`

## Semantics (critical — prevents lock-out bugs)
- No row for a pageKey → page is OPEN (any authenticated member).
- Row with ≥1 productSlug → GATED (member must own ≥1 slug in the list).
- Empty productSlugs array on upsert → DELETE the row (page reverts to open).
  Empty arrays are NEVER persisted.
- Admin/coach role → bypass → all registry pages regardless of map.
- With table empty, every member gets every page (safe launch default).

**Why:** prevents an admin accidentally walling off a page from all members by unchecking all boxes; "open" is always "no row" not "empty array row".

## Registry package
- `@workspace/content-access-registry` — side-effect-free (no DB/network).
- Safe to import in both api-server (Node) and portal (browser/Vite).
- 13 GATEABLE_PAGES with stable pageKey values — never rename after deploy.
- 11 MAPPABLE_PRODUCT_SLUGS (6 front-ends + 5 mentorship ladder).

## Routes
- `GET /api/content-access/me` → `{ accessiblePageKeys: string[] }` (authenticate middleware).
- `GET /api/admin/content-access/catalog` → pages + products + mappings (members:view).
- `POST /api/admin/content-access` — upsert by pageKey.
- `PATCH /api/admin/content-access/:id` — update by id.
- `DELETE /api/admin/content-access/:id` — remove (reverts to open).

## post-merge.sh
Step 13 applies `0073_content_access_map.sql` before the drift gate.
