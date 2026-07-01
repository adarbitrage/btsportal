-- Ad-spend funding ledger (Task #1536).
-- Creates the append-only ad_spend_transactions table used by the funding
-- flow (positive amount_cents = credit) and a future draw-down service
-- (negative = debit). Balance = SUM(amount_cents) per user.
-- Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ad_spend_transactions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  nmi_transaction_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_transactions_user
  ON ad_spend_transactions(user_id);

-- Null-tolerant unique index: at most one credit row per NMI transaction id.
-- Spend debit rows leave nmi_transaction_id null and are excluded from the
-- constraint, so they can coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_nmi_tx_id
  ON ad_spend_transactions(nmi_transaction_id)
  WHERE nmi_transaction_id IS NOT NULL;
