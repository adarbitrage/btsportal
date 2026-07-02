-- Partner dashboard (Task #1592): per-mentee notes authored by accountability
-- partners. Keyed to member_id (not to a partner_assignments row) so notes
-- survive reassignment.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, so
-- applying it on an already-migrated database (or a fresh one) is a safe
-- no-op.

CREATE TABLE IF NOT EXISTS partner_notes (
  id serial PRIMARY KEY,
  member_id integer NOT NULL REFERENCES users(id),
  author_partner_id integer NOT NULL REFERENCES partners(id),
  body text NOT NULL,
  is_concern boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_notes_member ON partner_notes (member_id, created_at);
