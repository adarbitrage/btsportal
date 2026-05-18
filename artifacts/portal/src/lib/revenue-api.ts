import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function adminFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text);
}

export interface RevenueKPIs {
  mrr: number;
  mrrChange: number;
  newRevenue: number;
  newRevenueChange: number;
  expansion: number;
  expansionChange: number;
  churned: number;
  churnedChange: number;
  arr: number;
  arrChange: number;
  avgLtv: number;
  avgLtvChange: number;
  cac: number;
  cacChange: number;
  ltvCacRatio: number;
  ltvCacRatioChange: number;
}

export interface RevenueTrend {
  month: string;
  mrr: number;
  newRevenue: number;
  expansion: number;
  churned: number;
}

export interface RevenueByProduct {
  product: string;
  revenue: number;
  members: number;
}

export interface CohortRow {
  cohort: string;
  size: number;
  months: (number | null)[];
}

export interface HealthDistribution {
  critical: number;
  atRisk: number;
  watch: number;
  healthy: number;
}

export interface AtRiskMember {
  id: number;
  name: string;
  email: string;
  healthScore: number;
  trend: "declining" | "stable" | "improving";
  daysInactive: number;
  currentProduct: string;
  expirationDate: string;
  churnProbability: number;
  lastActiveDate: string;
}

export interface UpgradeCandidate {
  id: number;
  name: string;
  email: string;
  currentProduct: string;
  upgradeProbability: number;
  trainingProgress: number;
  lastActiveDate: string;
  suggestedUpgrade: string;
  monthsActive: number;
}

export interface UpgradeFunnelMetrics {
  stage: string;
  count: number;
  conversionRate: number;
}

export interface FunnelData {
  funnelName: string;
  purchases: number;
  revenue: number;
  refundRate: number;
  upgradeRate: number;
  avgLtv: number;
}

export interface LtvSegment {
  segment: string;
  avgLtv: number;
  memberCount: number;
}

export interface LtvDistributionBucket {
  range: string;
  count: number;
}

export interface ForecastPoint {
  month: string;
  projected: number;
  lower: number;
  upper: number;
  actual?: number;
}

export interface ForecastAssumptions {
  churnRate: number;
  growthRate: number;
  avgRevenuePerMember: number;
}

export interface UpgradePromptVariantStat {
  variant: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface UpgradePromptTierStat {
  sourceTier: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface UpgradePromptComboStat {
  keys: string[];
  impressions: number;
  clicks: number;
  ctr: number;
}

export type UpgradePromptTrendGranularity = "day" | "week" | "month";

export interface UpgradePromptTrendBucket {
  bucket: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface UpgradePromptAnalyticsResponse {
  range: { from: string; to: string };
  granularity: UpgradePromptTrendGranularity;
  totals: { impressions: number; clicks: number; ctr: number };
  byVariant: UpgradePromptVariantStat[];
  byTier: UpgradePromptTierStat[];
  trend: UpgradePromptTrendBucket[];
  topFeatureCombos: UpgradePromptComboStat[];
}

export function useUpgradePromptAnalytics(
  from: string,
  to: string,
  filters: { variant?: string; sourceTier?: string } = {},
) {
  const { variant = "", sourceTier = "" } = filters;
  return useQuery({
    queryKey: ["/api/admin/analytics/upgrade-prompts", from, to, variant, sourceTier],
    queryFn: () => {
      const params = new URLSearchParams({ from, to });
      if (variant) params.set("variant", variant);
      if (sourceTier) params.set("sourceTier", sourceTier);
      return adminFetch<UpgradePromptAnalyticsResponse>(
        `/admin/analytics/upgrade-prompts?${params.toString()}`,
      );
    },
  });
}

export function useRevenueDashboard(period: string) {
  return useQuery({
    queryKey: ["/api/admin/revenue/dashboard", period],
    queryFn: () =>
      adminFetch<{
        kpis: RevenueKPIs;
        trend: RevenueTrend[];
        byProduct: RevenueByProduct[];
      }>(`/admin/revenue/dashboard?period=${period}`),
  });
}

export function useCohortAnalysis(metric: string, dimension: string) {
  return useQuery({
    queryKey: ["/api/admin/revenue/cohorts", metric, dimension],
    queryFn: () =>
      adminFetch<{ cohorts: CohortRow[] }>(
        `/admin/revenue/cohorts?metric=${metric}&dimension=${dimension}`
      ),
  });
}

export function useAtRiskMembers() {
  return useQuery({
    queryKey: ["/api/admin/revenue/at-risk"],
    queryFn: () =>
      adminFetch<{
        distribution: HealthDistribution;
        members: AtRiskMember[];
      }>("/admin/revenue/at-risk"),
  });
}

export function useUpgradeOpportunities() {
  return useQuery({
    queryKey: ["/api/admin/revenue/upgrade-opportunities"],
    queryFn: () =>
      adminFetch<{
        candidates: UpgradeCandidate[];
        funnelMetrics: UpgradeFunnelMetrics[];
      }>("/admin/revenue/upgrade-opportunities"),
  });
}

export function useFunnelPerformance() {
  return useQuery({
    queryKey: ["/api/admin/revenue/funnels"],
    queryFn: () =>
      adminFetch<{ funnels: FunnelData[] }>("/admin/revenue/funnels"),
  });
}

export function useLtvAnalysis() {
  return useQuery({
    queryKey: ["/api/admin/revenue/ltv"],
    queryFn: () =>
      adminFetch<{
        overallAvgLtv: number;
        byProduct: LtvSegment[];
        byExperience: LtvSegment[];
        distribution: LtvDistributionBucket[];
      }>("/admin/revenue/ltv"),
  });
}

export function useRevenueForecast() {
  return useQuery({
    queryKey: ["/api/admin/revenue/forecast"],
    queryFn: () =>
      adminFetch<{
        forecast: ForecastPoint[];
        assumptions: ForecastAssumptions;
      }>("/admin/revenue/forecast"),
  });
}

export function useSubmitManualData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { month: string; adSpend: number; otherMetrics?: Record<string, number> }) =>
      adminFetch("/admin/revenue/manual-data", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/revenue"] });
    },
  });
}

export function useSendRetentionEmail() {
  return useMutation({
    mutationFn: (memberId: number) =>
      adminFetch(`/admin/revenue/at-risk/${memberId}/retention-email`, {
        method: "POST",
      }),
  });
}

export function useCreateGhlTask() {
  return useMutation({
    mutationFn: (memberId: number) =>
      adminFetch(`/admin/revenue/at-risk/${memberId}/ghl-task`, {
        method: "POST",
      }),
  });
}
