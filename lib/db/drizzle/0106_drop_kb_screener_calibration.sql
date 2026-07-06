-- Task #1707: refine the coaching value screener into a recall-biased de-noiser.
-- Calibration (the few-shot exemplar loop) is removed ENTIRELY, so its table and
-- the per-screening calibration-version cache stamp go away. Written idempotently
-- (IF EXISTS) so applying it post-merge is safe and a re-run is a no-op. Runs
-- after 0105 (which created these), keeping the migrate-DB in sync with the
-- schema (which no longer declares them) so the drift gate stays green.
ALTER TABLE kb_call_screenings DROP COLUMN IF EXISTS calibration_version;
DROP TABLE IF EXISTS kb_calibration_examples CASCADE;
