-- One-shot cleanup: removes the MaxWeb and Affiliati affiliate networks.
-- Only Media Mavens and ClickBank remain supported across the portal.
--
-- Safe: no foreign keys reference affiliate_networks.
-- Re-runnable (idempotent) — deletes by slug if present.
--
-- Apply via the Replit Database pane (production environment).

BEGIN;

DELETE FROM affiliate_networks WHERE slug IN ('affiliati', 'maxweb');

-- Verification (run after the DELETE to sanity-check)
SELECT slug, name, display_order, is_active
FROM affiliate_networks
ORDER BY display_order;

COMMIT;
