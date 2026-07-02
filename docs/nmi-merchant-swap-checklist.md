# NMI Merchant-Account Swap Checklist

Operational runbook for pointing the BTS Member Portal at a **new NMI merchant
account** (e.g. switching processors or opening a fresh gateway account before
launch).

> **Why there is no purge script.** An earlier version of this task shipped a
> `pre-merchant-swap-purge.ts` that deleted native-NMI billing rows. It has been
> **removed on purpose**: there are **zero native-NMI billing rows** in the
> database (all historical grants are externally-sourced ThriveCart imports, and
> no charge has ever been taken through the native NMI checkout). There is
> nothing to purge, so a destructive script is pure risk with no upside. Swapping
> merchant accounts is a **credential-rotation + redeploy** operation, not a
> data operation.

---

## What actually needs to change

The entire NMI gateway integration authenticates with **exactly two secrets**,
both read only in `artifacts/api-server/src/lib/payments/nmi-gateway.ts`:

| Secret | Used for | Read by |
| --- | --- | --- |
| `BTS_NMI_SECURITY_KEY` | Every `transact.php` / `query.php` API call (charges, refunds, voids, lookups) | `getSecurityKey()` |
| `BTS_NMI_TOKENIZATION_KEY` | Collect.js client-side card tokenization | `getTokenizationKey()` |

There are **no other NMI credentials** anywhere in the codebase (no per-request
API key, no stored merchant id, no webhook secret). Rotating these two values is
the complete swap.

---

## Before you swap: re-verify there is nothing to purge

The "no purge script" decision rests on a **precondition that must be re-checked
immediately before *every* swap**, never assumed: that there are still **zero
native-NMI billing rows**. Run these three counts against the live database right
before rotating any secret — **all three must return 0**:

```sql
-- Vaulted NMI card tokens: a non-zero count means a member entered a card via
-- native Collect.js checkout — the strongest signal of real native NMI use.
SELECT count(*) AS vaulted_cards FROM payment_methods;

-- Real native-NMI charges: orders that actually hit the NMI gateway. External
-- ThriveCart imports have no gateway transaction id, so they are excluded.
SELECT count(*) AS native_charges
FROM bts_orders
WHERE gateway_transaction_id IS NOT NULL;

-- Native-NMI recurring subscriptions.
SELECT count(*) AS native_subscriptions FROM subscriptions;
```

If **any** count is non-zero, **STOP** — the zero-row assumption no longer holds
and this runbook no longer applies. Do **not** proceed and do **not** revive a
blanket purge script: escalate and treat data handling as a separate,
explicitly-scoped decision (see *Residual risk & notes*). Continue to the steps
below only when all three counts are 0.

---

## Steps

1. **Obtain the new account's credentials** from the new NMI merchant account:
   its **Security Key** and its **Public Tokenization Key** (Collect.js key).

2. **Rotate the two secrets** to the new account's values (via the environment /
   secrets manager — never commit them, never hand-edit them into code):
   - `BTS_NMI_SECURITY_KEY` → new account's Security Key
   - `BTS_NMI_TOKENIZATION_KEY` → new account's Tokenization Key

   Rotate **only** these two. Do not touch any other secret.

3. **Redeploy / restart the API server.** This is **required**, not optional:
   - `BTS_NMI_SECURITY_KEY` is read from `process.env` at call time, but the
     server process only picks up new secret values on a fresh start — a running
     process keeps the old environment.
   - `BTS_NMI_TOKENIZATION_KEY` is served to the browser to initialize
     Collect.js; clients will keep using the old key until the server restarts
     and re-serves the new one.

   For the deployed (production) app this means a **Publish/redeploy**; for a
   running dev workflow, **restart the workflow**.

4. **Verify with a live low-value test charge** against the new account:
   - Run one real checkout for a small amount and confirm the transaction
     appears in the **new** NMI merchant dashboard (not the old one).
   - Confirm card tokenization succeeds in the browser (Collect.js loads with no
     console error — that proves the new tokenization key is live).
   - Refund the test charge from the admin panel and confirm the refund also
     lands in the new account (proves the security key rotation took for
     `transact.php` writes too).

---

## Residual risk & notes

- **In-flight tokens.** Any card token minted by the *old* tokenization key is
  scoped to the *old* merchant account and will not charge against the new one.
  After the swap, members re-enter card details on their next payment (there is
  no vaulted-token migration between NMI accounts — do not attempt one).
- **No data cleanup is part of this swap.** Orders, subscriptions, and
  idempotency rows are account-agnostic bookkeeping and are left untouched. If a
  future swap ever happens *after* real native-NMI charges exist, treat data
  handling as a separate, explicitly-scoped decision — do **not** revive a
  blanket purge script.
- **Rollback.** To revert, rotate the two secrets back to the old account's
  values and redeploy/restart again. No data changes to undo.
