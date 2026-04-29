-- Adds the `checkout_url` column to `products` so the /plans page can wire each
-- tier's "Upgrade" button to a real hosted checkout (ThriveCart, Stripe, etc.)
-- instead of the previous "Talk to us" mailto link.
--
-- The new column is nullable: products that aren't directly purchasable from
-- the portal (frontend offers, internal placeholders, anything we haven't wired
-- a cart for yet) leave this blank, and the API refuses to start a checkout
-- for them. The portal disables the upgrade button on those tiers so members
-- never see a dead "Upgrade" button.
--
-- Idempotent so it is safe to re-run against a database that already has the
-- column from `drizzle-kit push`.
ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "checkout_url" text;
