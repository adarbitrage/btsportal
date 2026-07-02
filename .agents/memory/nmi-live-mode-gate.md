---
name: NMI_LIVE_MODE fail-closed money gate
description: How the NMI gateway refuses to move money outside production, and what test setup it requires.
---

The NMI gateway's single shared `nmiPost()` helper (the only function that
POSTs to `transact.php`) checks `process.env.NMI_LIVE_MODE === "true"` before
doing anything else, and throws `"NMI live mode not enabled — refusing to move
money"` otherwise. This is the one and only seam — no per-caller checks, no
bypass parameter, no test-only escape hatch.

**Why:** `BTS_NMI_SECURITY_KEY` is a global secret shared by dev and prod, and
the gateway always posts to the real `secure.nmi.com` endpoint (no sandbox
mode exists). Without this gate, a charge triggered from the dev preview could
move real money. Fail-closed was chosen deliberately over any
simulate/no-op behavior.

**How to apply:**
- Read-only calls (`queryTransaction`, `queryTransactionsByDateRange` — both
  hit `query.php`) are intentionally ungated and work with the flag unset.
- Every money-moving path (`chargeWithToken`, `chargeWithVault`, `refund`,
  `voidTransaction`, `createVaultFromToken`, `deleteVaultCustomer`) flows
  through `nmiPost()`, so they all inherit the gate automatically — including
  indirect callers like `charge-service.ts` → `checkout-core.ts` →
  `ad-spend-funding-service.ts`/`renewal-charger.ts`/`ops-refund-service.ts`.
  Any new money-moving NMI feature must route through `nmiPost()` too, never
  post to `transact.php` directly.
- Production has `NMI_LIVE_MODE=true` set as a **production-scoped** env var
  (not shared/global) so development never has it. This only takes effect on
  production's next publish — if this gate ships to prod before the flag is
  set (or is set but not yet published), all live charges are refused until
  the flag is live.
- Any test that exercises the real (unmocked) gateway — not one that
  `vi.mock`s `nmi-gateway.js` entirely — must set
  `process.env.NMI_LIVE_MODE = "true"` in its setup alongside
  `BTS_NMI_SECURITY_KEY`, or calls will throw the refusal error instead of
  reaching the mocked `fetch`.
