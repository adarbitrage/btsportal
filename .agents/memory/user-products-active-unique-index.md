---
name: user_products active-grant unique index
description: Partial unique index on user_products(active) — prod deploy preflight + idempotency gotchas that code alone won't tell you.
---

# user_products: one ACTIVE grant per (user, product)

A partial unique index `user_products_user_product_active_uidx` enforces at most
one `status='active'` row per `(user_id, product_id)`. Declared in
`lib/db/src/schema/user-products.ts` (`uniqueIndex(...).where(sql\`"status" = 'active'\`)`)
with companion `lib/db/drizzle/0061_user_products_active_unique_index.sql`, so
`drizzle-kit push` carries it to prod. `status` is plain text (no CHECK/enum);
terminal values (expired/revoked/superseded) are excluded by the predicate.

## Dedupe rule (keep consistent)
When collapsing duplicate active grants, KEEP the newest per pair
(`purchased_at DESC, id DESC`) and set the rest to `status='superseded'`
(non-destructive UPDATE — never DELETE).
**Why:** members keep their most recent grant; older rows survive as history and
are excluded from the index. Used as the one-time data fix on dev.

## Prod deploy preflight (critical, not in code)
Publishing this index to prod will FAIL if prod still has duplicate active rows.
Before/at publish: run the same non-destructive supersede UPDATE on prod first.
**Never accept a publish/drizzle prompt offering to DELETE DATA to satisfy the
constraint** — stop and dedupe manually instead.
**How to apply:** check `SELECT user_id, product_id FROM user_products WHERE
status='active' GROUP BY 1,2 HAVING count(*)>1` on prod before the push.

## Grant-path idempotency gap (open follow-up)
With the index live, concurrent grant inserts (external-grant API / webhook
receivers) for the same active pair now raise `23505 unique_violation` where they
previously silently created a duplicate. Insert paths should treat that as
idempotent success (ON CONFLICT / catch 23505), not a hard error.

## Junk products 523/524
`admin-ext-orders-5c5d8bb1-prod[-b]`, type=backend, `entitlement_keys=[]` → grant
nothing (inert). Left AS-IS by user decision: deleting would cascade to 10 active
user_products rows incl. a real user's, for zero benefit. `products` has no
is_active/grantable/archived flag, so there's no in-place "mark non-grantable".
