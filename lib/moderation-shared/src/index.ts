/**
 * Single source of truth for the moderation "pod is stale / silent" rule.
 *
 * This rule is consumed in two places that must never disagree:
 *   - the System Health dashboard card (`isPodStale` in `SystemHealth.tsx`),
 *     which paints a pod red, and
 *   - the on-call alerter (`evaluateModerationPodSilentAlert` in
 *     `failure-alerter.ts`), which pages on-call.
 *
 * If the dashboard and the page-on-call ever drifted apart, an admin could
 * see a red pod that never paged — or get paged for a pod the page shows as
 * healthy. Keeping the formula here, with a test pinning the 2x factor and
 * the `totalCount === 0` gate, makes that drift impossible: both sides import
 * the exact same code.
 */

/**
 * A pod is considered stale once its most recent report is older than this
 * many rolling windows. A pod that previously reported but has now gone
 * silent could have stopped running moderation entirely, letting flag-worthy
 * posts stay live unnoticed.
 */
export const STALE_WINDOW_MULTIPLIER = 2;

/** Minimal shape needed to judge a pod's staleness. */
export interface PodStalenessInput {
  totalCount: number;
  lastAt: string | null;
}

/**
 * Derive the staleness threshold (ms) from the rolling-window length (ms).
 * A non-positive or non-finite window yields 0, which `isPodStale` treats as
 * "never stale".
 */
export function staleThresholdMsForWindow(windowMs: number): number {
  const w = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0;
  return w * STALE_WINDOW_MULTIPLIER;
}

/**
 * A pod is "stale/silent" when it carries no in-window failures
 * (`totalCount === 0`) yet its most recent report (`lastAt`) is older than
 * the staleness threshold (2x the rolling window). Pods with in-window
 * failures are excluded because their `lastAt` would be recent.
 */
export function isPodStale(
  pod: PodStalenessInput,
  nowMs: number,
  staleThresholdMs: number,
): boolean {
  if (!(staleThresholdMs > 0) || !Number.isFinite(nowMs)) return false;
  if (pod.totalCount > 0 || !pod.lastAt) return false;
  const last = Date.parse(pod.lastAt);
  if (!Number.isFinite(last)) return false;
  return nowMs - last > staleThresholdMs;
}
