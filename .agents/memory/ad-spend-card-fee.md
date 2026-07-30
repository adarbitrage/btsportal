---
name: Ad-spend 3% card fee split
description: How the ad-spend deposit fee is charged/credited and why replay amounts ride the idempotency extra
---

Card deposits on Fund Ad Spend: card charged entered × 1.03 (fee = Math.round(entered*0.03) cents), ledger credited exactly the entered amount. Min/max ($1k–$10k) validate the ENTERED amount, so the charged total may exceed $10k by design.

**Server-authoritative:** client sends only the entered amountCents; server (ad-spend-fee helper) computes the fee, charges NMI the total, and refuses to credit (→ reconciliation) if NMI confirms any other total. Portal mirrors the math display-only — keep the two helpers in lockstep.

**Replay authority:** checkout-core persists whatever `onOrderPaid` returns into the stored idempotency result and surfaces it as `extra` on `replay_paid`. The fee split (creditedCents/feeCents/chargedCents) is returned from `onOrderPaid` precisely so replays answer with the ORIGINAL amounts even if the client retries with a different amount. Any future money flow with a derived charge amount should use the same pattern rather than recomputing on replay.
