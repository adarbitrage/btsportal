import { Router, type Request, type Response } from "express";
import { requirePermission } from "../middleware/rbac";
import {
  getRefundRateBaseline,
  validateBaselinePercent,
  setRefundRateBaseline,
  getPartneredCohortMonthlyTrend,
  getPartneredMemberIds,
} from "../lib/partnered-cohort-metrics";
import { getNmiRefundPollerStatus, pollNmiRefundEvents } from "../lib/nmi-refund-poller";

const router = Router();

router.get("/admin/refund-metrics/baseline", requirePermission("revenue:view"), async (_req: Request, res: Response) => {
  try {
    const baseline = await getRefundRateBaseline();
    res.json({ baseline });
  } catch (err) {
    console.error("[AdminRefundMetrics] Baseline fetch error:", err);
    res.status(500).json({ error: "Failed to load baseline" });
  }
});

router.put("/admin/refund-metrics/baseline", requirePermission("revenue:view"), async (req: Request, res: Response) => {
  const validated = validateBaselinePercent(req.body?.baselinePercent);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  try {
    const updatedByEmail = req.userEmail || (req.userId ? String(req.userId) : null);
    await setRefundRateBaseline(validated.value, updatedByEmail);
    const baseline = await getRefundRateBaseline();
    res.json({ baseline });
  } catch (err) {
    console.error("[AdminRefundMetrics] Baseline save error:", err);
    res.status(500).json({ error: "Failed to save baseline" });
  }
});

router.get("/admin/refund-metrics/trend", requirePermission("revenue:view"), async (req: Request, res: Response) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months as string) || 12));
    const [trend, baseline, cohortIds] = await Promise.all([
      getPartneredCohortMonthlyTrend(months),
      getRefundRateBaseline(),
      getPartneredMemberIds(),
    ]);
    res.json({
      trend,
      baseline,
      cohortSize: cohortIds.length,
      cohortAvailable: cohortIds.length > 0,
    });
  } catch (err) {
    console.error("[AdminRefundMetrics] Trend error:", err);
    res.status(500).json({ error: "Failed to compute cohort trend" });
  }
});

router.get("/admin/refund-metrics/poller-status", requirePermission("revenue:view"), async (_req: Request, res: Response) => {
  try {
    res.json(getNmiRefundPollerStatus());
  } catch (err) {
    console.error("[AdminRefundMetrics] Poller status error:", err);
    res.status(500).json({ error: "Failed to load poller status" });
  }
});

// Manual "poll now" for admins who don't want to wait for the daily cycle
// (e.g. right after issuing a direct NMI-dashboard refund, to confirm it
// gets picked up). Same read-only poll logic as the scheduled job.
router.post("/admin/refund-metrics/poll-now", requirePermission("revenue:view"), async (_req: Request, res: Response) => {
  try {
    const result = await pollNmiRefundEvents();
    res.json({ result });
  } catch (err) {
    console.error("[AdminRefundMetrics] Manual poll error:", err);
    res.status(500).json({ error: "Poll failed", message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
