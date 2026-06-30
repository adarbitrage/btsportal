-- NMI Tier 6.1: subscriptions table + subscription_id on bts_orders
--
-- 1. Create the subscriptions table (idempotent: CREATE TABLE IF NOT EXISTS).
-- 2. Add the nullable subscription_id FK column to bts_orders (idempotent: ADD COLUMN IF NOT EXISTS).
--
-- The subscriptions table holds one row per recurring subscription. The
-- payment_method_id FK uses ON DELETE RESTRICT (the billing router enforces a
-- friendly 409 before any vault call, but the DB constraint is the safety net).
-- next_charge_at is indexed so the Tier-6.2 rebiller can query due subscriptions
-- efficiently without a full-table scan.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  product_id            INTEGER NOT NULL REFERENCES products(id),
  payment_method_id     INTEGER NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'active',
  interval              TEXT NOT NULL,
  amount_cents          INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  current_period_start  TIMESTAMP WITH TIME ZONE NOT NULL,
  current_period_end    TIMESTAMP WITH TIME ZONE NOT NULL,
  next_charge_at        TIMESTAMP WITH TIME ZONE,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  last_charge_attempt_at TIMESTAMP WITH TIME ZONE,
  last_failure_reason   TEXT,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT false,
  canceled_at           TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'canceled', 'unpaid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_interval_check
    CHECK (interval IN ('monthly', 'yearly'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx     ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx      ON subscriptions (status);
CREATE INDEX IF NOT EXISTS subscriptions_next_charge_at_idx ON subscriptions (next_charge_at);

-- Additive nullable FK column on bts_orders linking an order to its subscription.
-- Nullable so existing one-time orders are unaffected.
ALTER TABLE bts_orders
  ADD COLUMN IF NOT EXISTS subscription_id INTEGER REFERENCES subscriptions(id);
