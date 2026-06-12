---
name: community/dm storage matches schema
description: where the community + direct-message data layer lives and why its typecheck is clean
---

The community and direct-message data layer is fully consistent and typechecks clean.

- Schema: `lib/db/src/schema/community.ts` (posts/comments/reactions/categories/badges/notifications — reactions carry `targetType`/`targetId`/`type` plus legacy `postId`/`commentId`) and `lib/db/src/schema/dm.ts` (`dmThreadsTable`, `dmMessagesTable`).
- Storage: `artifacts/api-server/src/storage/community.ts` + `dm.ts` import from `@workspace/db` (which `export * from "./schema"`).
- Migrations: `lib/db/drizzle/0037_dm_tables.sql`, `0037_community_status_media_urls.sql` (adds posts/comments `status` + posts `media_urls`), `0038_community_reactions_target_type.sql` (adds reaction `target_type`/`target_id`/`type` + backfill).

**Why:** a task can be filed against an older snapshot claiming the storage references nonexistent tables/columns (`dmThreadsTable`, `status`, `targetId`, etc.); by now those schema files + migrations exist and the storage typechecks with zero errors. Verify before assuming breakage.

**How to apply:** the lingering `api-server` typecheck failures are NOT in this data layer. They are (1) a codebase-wide Express `req.params` `string | string[]` issue hitting many route files (`routes/community.ts`, `vault.ts`, `openai/chat.ts`, `referral-redirect.ts`) and (2) drifted/leftover test helpers (e.g. `dm-permissions.test.ts` annotates `ReturnType<typeof buildTestAppWithRouters>` without importing it). Don't conflate these with data-layer breakage.
