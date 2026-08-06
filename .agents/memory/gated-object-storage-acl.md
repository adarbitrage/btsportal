---
name: Gated features must ACL-stamp private storage objects
description: Generic /api/storage/objects/* serves any authenticated member; entitlement-gated assets need an object ACL policy or the gate is bypassable.
---

The generic private-object route (`GET /api/storage/objects/*`) historically served ANY authenticated member (coach photos, ticket attachments rely on this). It now enforces the object ACL policy **when one exists** and still allows policy-less legacy objects.

**Rule:** any feature whose content is entitlement/ownership-gated must, at registration time, stamp its originals AND derived assets (thumbnails etc.) with `trySetObjectEntityAclPolicy(path, { owner: String(adminUserId), visibility: "private" })`. Members then only get bytes through the feature's gated proxy route; the generic route returns 403.

**Why:** Swipe Resource Bank Phase 1 was rejected in review because registered items validated the objectPath but never applied an ACL — a non-owner could fetch the raw object via `/api/storage/objects/<path>` with just an auth cookie.

**How to apply:** new gated upload flows: (1) set the ACL at registration, (2) never return raw `/objects/...` paths to members, (3) add an integration test asserting non-owners get 403 on the generic storage route for a registered object (see swipe-bank-gating.test.ts "generic storage route cannot bypass" block). Do NOT make the generic route fail-closed for policy-less objects — that breaks coach photos and ticket attachments.
