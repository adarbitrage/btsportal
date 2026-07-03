---
name: Entitlement key exhaustive metadata map
description: Adding a new entitlement key requires a matching seed metadata row or typecheck fails
---

The seed script's entitlement metadata map is typed as an exhaustive Record over the entitlement-key registry (the
single source of truth) — a key present in the registry but missing a metadata row is a compile error, not a
runtime surprise.

**Why:** this is intentional — it guarantees the seeded entitlement catalog can never silently omit a key. But
it's easy to add a new entitlement key to the registry, wire it into a product's entitlement list, and forget the
metadata row entirely, since nothing about adding the key itself fails until the project is typechecked.

**How to apply:** whenever a new entitlement key is added, add its metadata row in the same change, then run a
full typecheck to confirm — the test suite alone won't reliably catch this in every path.
