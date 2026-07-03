-- Task #1642 (TB1): per-(member, effect) idempotency ledger for one-time
-- onboarding side effects (creation-time nurture_frontend_to_upgrade
-- enrollment, completion-time onboarding sequence cancellation).
-- New, additive, empty table. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS onboarding_effects (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  effect text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_effects_user_effect_uidx
  ON onboarding_effects (user_id, effect);
