import { db, revenueMetricsCacheTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

export interface ForecastPeriod {
  period: string;
  conservative: number;
  base: number;
  optimistic: number;
}

export interface RevenueForecast {
  periods: ForecastPeriod[];
  assumptions: {
    historicalGrowthRate: number;
    churnRate: number;
    upgradeRate: number;
    conservativeMultiplier: number;
    optimisticMultiplier: number;
  };
}

function formatPeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function getHistoricalMetric(metricKey: string, months: number): Promise<number[]> {
  const values: number[] = [];
  const now = new Date();

  for (let i = months; i >= 1; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = formatPeriod(date);

    const [row] = await db
      .select({ value: revenueMetricsCacheTable.value })
      .from(revenueMetricsCacheTable)
      .where(
        and(
          eq(revenueMetricsCacheTable.metricKey, metricKey),
          eq(revenueMetricsCacheTable.period, period)
        )
      )
      .limit(1);

    if (row) {
      values.push(parseFloat(row.value));
    }
  }

  return values;
}

function calculateGrowthRate(values: number[]): number {
  if (values.length < 2) return 0.05;

  const rates: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      rates.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }

  if (rates.length === 0) return 0.05;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

export async function computeRevenueForecast(forecastMonths: number = 6): Promise<RevenueForecast> {
  const historicalMrr = await getHistoricalMetric("mrr", 6);
  const historicalChurn = await getHistoricalMetric("churnRate", 6);
  const historicalUpgrade = await getHistoricalMetric("upgradeRate", 6);

  const growthRate = calculateGrowthRate(historicalMrr);
  const avgChurnRate = historicalChurn.length > 0
    ? historicalChurn.reduce((a, b) => a + b, 0) / historicalChurn.length
    : 0.05;
  const avgUpgradeRate = historicalUpgrade.length > 0
    ? historicalUpgrade.reduce((a, b) => a + b, 0) / historicalUpgrade.length
    : 0.03;

  const currentMrr = historicalMrr.length > 0 ? historicalMrr[historicalMrr.length - 1] : 0;

  const conservativeMultiplier = 0.7;
  const optimisticMultiplier = 1.3;

  const periods: ForecastPeriod[] = [];
  let baseMrr = currentMrr;
  let conservativeMrr = currentMrr;
  let optimisticMrr = currentMrr;

  const now = new Date();

  for (let i = 1; i <= forecastMonths; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const period = formatPeriod(futureDate);

    const baseGrowth = growthRate;
    const conservativeGrowth = growthRate * conservativeMultiplier;
    const optimisticGrowth = growthRate * optimisticMultiplier;

    baseMrr = baseMrr * (1 + baseGrowth - avgChurnRate + avgUpgradeRate * 0.5);
    conservativeMrr = conservativeMrr * (1 + conservativeGrowth - avgChurnRate * 1.2 + avgUpgradeRate * 0.3);
    optimisticMrr = optimisticMrr * (1 + optimisticGrowth - avgChurnRate * 0.8 + avgUpgradeRate * 0.7);

    baseMrr = Math.max(0, baseMrr);
    conservativeMrr = Math.max(0, conservativeMrr);
    optimisticMrr = Math.max(0, optimisticMrr);

    periods.push({
      period,
      conservative: Math.round(conservativeMrr),
      base: Math.round(baseMrr),
      optimistic: Math.round(optimisticMrr),
    });
  }

  return {
    periods,
    assumptions: {
      historicalGrowthRate: parseFloat(growthRate.toFixed(4)),
      churnRate: parseFloat(avgChurnRate.toFixed(4)),
      upgradeRate: parseFloat(avgUpgradeRate.toFixed(4)),
      conservativeMultiplier,
      optimisticMultiplier,
    },
  };
}
