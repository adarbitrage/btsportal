---
name: Turnstile site key config
description: Why Turnstile 3589/110200 errors are Cloudflare/secret-side, the build-time inlining + republish requirement, and the global-secret dev/prod sharing.
---

# Cloudflare Turnstile site key / domain config

Turnstile error **3589** (invalid site key / hostname-not-allowed) and **110200**
("unknown domain / domain not allowed") are **not code bugs** — they are fixed in the
Cloudflare Turnstile dashboard or by correcting the `VITE_TURNSTILE_SITE_KEY` value.
There is no code change that fixes a bad key or a missing allowed-hostname.

Key facts (not derivable from the codebase):

- `VITE_TURNSTILE_SITE_KEY` is a **build-time inlined Vite var** — its value is baked
  into the portal client bundle at build time. Updating the secret + restarting dev
  workflows fixes **dev** immediately, but **production only picks up the new key on a
  republish** (rebuild). A secret change alone never updates the live bundle.
- The secret is **global (not env-scoped)**, so dev and prod share ONE site key.
- The production Cloudflare widget ("BTS Member Portal") allows only
  `portal.buildtestscale.com`. Because the key is global, the same widget is used in
  dev, where the Replit `*.replit.dev` domain is NOT allowed → Turnstile fails with
  110200 in dev and the task-757 fallback banner ("security challenge could not load")
  shows. **This is expected, not a regression.** To make Turnstile actually render in
  dev, add the Replit dev domain to the same widget's allowed-hostnames (free slots).
- Site keys are **public** (embedded in client code) and safe to share/paste; the
  Turnstile **secret key** (`TURNSTILE_SECRET_KEY`) is the sensitive one.

**Why:** A 3589/110200 report sends you chasing a code bug; the real fix is dashboard +
secret + republish. The agent (task agent) cannot republish or write prod — the user
must publish from the main project for the new key to go live.
