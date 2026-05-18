-- Track the surface that opened a support ticket so support can filter /
-- prioritise tickets created from in-app entry points (e.g. the
-- cancelled-email banner on the member account page) and jump back to the
-- originating record. `source` is free-form text (no enum) so new entry
-- points can be added without another migration; `source_reference_id` is
-- an untyped int because the upstream table varies by `source` value.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source" text;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "source_reference_id" integer;
