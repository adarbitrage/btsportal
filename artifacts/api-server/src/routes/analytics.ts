import { Router, type IRouter } from "express";
import { db, upgradePromptEventsTable } from "@workspace/db";

const router: IRouter = Router();

const VALID_EVENT_TYPES = new Set(["impression", "cta_click"]);
const VALID_VARIANTS = new Set(["dashboard", "sidebar"]);
const MAX_FEATURE_KEYS = 32;
const MAX_FEATURE_KEY_LENGTH = 64;
const MAX_TIER_LENGTH = 64;

function sanitizeFeatureKeys(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  if (input.length > MAX_FEATURE_KEYS) return null;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") return null;
    if (v.length === 0 || v.length > MAX_FEATURE_KEY_LENGTH) return null;
    out.push(v);
  }
  return out;
}

router.post("/analytics/events", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { eventType, variant, sourceTier, lockedFeatureKeys } = req.body ?? {};

  if (typeof eventType !== "string" || !VALID_EVENT_TYPES.has(eventType)) {
    res.status(400).json({ error: "Invalid eventType" });
    return;
  }
  if (typeof variant !== "string" || !VALID_VARIANTS.has(variant)) {
    res.status(400).json({ error: "Invalid variant" });
    return;
  }
  if (typeof sourceTier !== "string" || sourceTier.length === 0 || sourceTier.length > MAX_TIER_LENGTH) {
    res.status(400).json({ error: "Invalid sourceTier" });
    return;
  }
  const featureKeys = sanitizeFeatureKeys(lockedFeatureKeys);
  if (featureKeys === null) {
    res.status(400).json({ error: "Invalid lockedFeatureKeys" });
    return;
  }

  await db.insert(upgradePromptEventsTable).values({
    userId: req.userId,
    eventType,
    variant,
    sourceTier,
    lockedFeatureKeys: featureKeys,
  });

  res.status(204).end();
});

export default router;
