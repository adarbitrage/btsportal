-- 0045_drop_legacy_one_on_one_coaching.sql
-- Task: remove the legacy entitlement-based 1-on-1 coaching system.
--
-- Drops the tables that backed the deleted slot-engine / one-on-one booking
-- flow. The pack-purchase 1-on-1 system (session_packs, session_pack_*,
-- coaching_credit_ledger) and GROUP calls (coaching_calls) are unaffected,
-- as are the `coaches` and `coaching_calls` tables which we keep.
--
-- Idempotent: IF EXISTS + CASCADE so it re-runs cleanly and clears foreign
-- keys (coaching_action_items / coaching_ratings reference coaching_sessions).
-- Drop dependents first, then the parent.
DROP TABLE IF EXISTS coaching_action_items CASCADE;
DROP TABLE IF EXISTS coaching_ratings CASCADE;
DROP TABLE IF EXISTS coaching_sessions CASCADE;
DROP TABLE IF EXISTS coach_availability_overrides CASCADE;
DROP TABLE IF EXISTS coach_availability CASCADE;
