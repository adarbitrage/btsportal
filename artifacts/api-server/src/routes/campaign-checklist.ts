import { Router, type IRouter } from "express";
import { db, campaignChecklistProgressTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CAMPAIGN_ROADMAP,
  type CampaignNetwork,
} from "@workspace/campaign-roadmap";

const router: IRouter = Router();

const VALID_NETWORKS: readonly CampaignNetwork[] = ["media-mavens", "clickbank"];

// Valid checklist keys, derived from the shared roadmap skeleton:
//  - a step's `id` for steps WITHOUT substeps (single checkbox), and
//  - every `substepId` for steps WITH substeps.
// Never display text or array indexes.
const VALID_KEYS = new Set<string>();
// substepId -> network branch tag (undefined = shared/both networks).
const SUBSTEP_NETWORK = new Map<string, CampaignNetwork | undefined>();
for (const step of CAMPAIGN_ROADMAP) {
  if (step.substeps.length === 0) {
    VALID_KEYS.add(step.id);
  } else {
    for (const sub of step.substeps) {
      VALID_KEYS.add(sub.substepId);
      SUBSTEP_NETWORK.set(sub.substepId, sub.network);
    }
  }
}

/**
 * Drop checked ids that belong to a branch the member is NOT on: substeps
 * tagged with the other network, or any branch substep when no network is
 * chosen. Shared (untagged) checkmarks always persist.
 */
function filterForNetwork(checkedIds: string[], network: CampaignNetwork | null): string[] {
  return checkedIds.filter((id) => {
    const branch = SUBSTEP_NETWORK.get(id);
    if (branch === undefined) return true; // shared substep or step-level key
    return network !== null && branch === network;
  });
}

router.get("/campaign-checklist", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const [row] = await db
    .select()
    .from(campaignChecklistProgressTable)
    .where(eq(campaignChecklistProgressTable.userId, userId));
  res.json({
    network: (row?.network as CampaignNetwork | null) ?? null,
    checkedIds: row?.checkedIds ?? [],
  });
});

router.put("/campaign-checklist", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { network, checkedIds } = req.body ?? {};

  if (network !== null && network !== undefined && !VALID_NETWORKS.includes(network)) {
    res.status(400).json({ error: "Invalid network" });
    return;
  }
  if (!Array.isArray(checkedIds) || checkedIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "checkedIds must be an array of strings" });
    return;
  }
  const invalid = checkedIds.filter((id: string) => !VALID_KEYS.has(id));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown checklist ids: ${invalid.join(", ")}` });
    return;
  }

  const normalizedNetwork: CampaignNetwork | null = network ?? null;
  const filtered = filterForNetwork(Array.from(new Set<string>(checkedIds)), normalizedNetwork);

  const [row] = await db
    .insert(campaignChecklistProgressTable)
    .values({ userId, network: normalizedNetwork, checkedIds: filtered })
    .onConflictDoUpdate({
      target: campaignChecklistProgressTable.userId,
      set: { network: normalizedNetwork, checkedIds: filtered, updatedAt: new Date() },
    })
    .returning();

  res.json({
    network: (row.network as CampaignNetwork | null) ?? null,
    checkedIds: row.checkedIds ?? [],
  });
});

export default router;
