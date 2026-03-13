import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationOptions } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function commissionFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export interface CommissionSummary {
  tierLabel: string;
  tierSlug: string;
  earningsThisMonth: number;
  earningsThisMonthChange: number;
  pendingAmount: number;
  availableForPayout: number;
  totalEarnedAllTime: number;
  totalReferrals: number;
  totalClicksThisMonth: number;
}

export interface AffiliateProfile {
  id: number;
  userId: number;
  affiliateCode: string;
  customCode: string | null;
  paypalEmail: string | null;
  payoutMethod: string;
  payoutThreshold: number;
  taxFormSubmitted: boolean;
  taxFormType: string | null;
  isActive: boolean;
}

export interface ReferralLink {
  id: number;
  productId: number;
  productName: string;
  productSlug: string;
  linkUrl: string;
  clickCount: number;
  salesCount: number;
  revenue: number;
  conversionRate: number;
  isAccessible: boolean;
  isActive: boolean;
}

export interface CommissionRecord {
  id: number;
  date: string;
  referredFirstName: string;
  referredLastInitial: string;
  productName: string;
  saleAmount: number;
  commissionAmount: number;
  status: "pending" | "approved" | "paid" | "rejected";
}

export interface EarningsData {
  period: string;
  pending: number;
  approved: number;
  paid: number;
}

export interface EarningsSummary {
  totalEarnings: number;
  totalCommissions: number;
  averageCommission: number;
  chart: EarningsData[];
  records: CommissionRecord[];
  totalRecords: number;
  page: number;
  pageSize: number;
}

export interface PayoutRecord {
  id: number;
  date: string;
  amount: number;
  commissionCount: number;
  method: string;
  status: "processing" | "completed" | "failed";
}

export interface PayoutInfo {
  currentMethod: string;
  nextPayoutDate: string | null;
  paypalEmail: string | null;
  payoutThreshold: number;
  taxFormSubmitted: boolean;
  taxFormType: string | null;
  history: PayoutRecord[];
}

export interface LeaderboardEntry {
  rank: number;
  firstName: string;
  lastInitial: string;
  referralCount: number;
  totalEarnings: number;
  isCurrentUser: boolean;
}

export interface CommissionRate {
  productId: number;
  productName: string;
  entry: number | null;
  mid: number | null;
  premium: number | null;
  top: number | null;
  rateType: "percentage" | "fixed";
}

export interface ResourceItem {
  id: number;
  title: string;
  type: "email_swipe" | "social_post" | "banner" | "guideline";
  content: string;
  imageUrl?: string;
  category: string;
}

export function useCommissionSummary(options?: Partial<UseQueryOptions<CommissionSummary>>) {
  return useQuery<CommissionSummary>({
    queryKey: ["commissions", "summary"],
    queryFn: () => commissionFetch<CommissionSummary>("/commissions/summary"),
    ...options,
  });
}

export function useAffiliateProfile(options?: Partial<UseQueryOptions<AffiliateProfile>>) {
  return useQuery<AffiliateProfile>({
    queryKey: ["commissions", "profile"],
    queryFn: async () => {
      const data = await commissionFetch<any>("/commissions/profile");
      return (data?.profile ?? data) as AffiliateProfile;
    },
    ...options,
  });
}

export function useReferralLinks(options?: Partial<UseQueryOptions<ReferralLink[]>>) {
  return useQuery<ReferralLink[]>({
    queryKey: ["commissions", "referral-links"],
    queryFn: async () => {
      const data = await commissionFetch<any>("/commissions/referral-links");
      return Array.isArray(data) ? data : (data?.links ?? []);
    },
    ...options,
  });
}

export function useEarnings(
  period: string = "this_month",
  page: number = 1,
  options?: Partial<UseQueryOptions<EarningsSummary>>
) {
  return useQuery<EarningsSummary>({
    queryKey: ["commissions", "earnings", period, page],
    queryFn: () =>
      commissionFetch<EarningsSummary>(
        `/commissions/earnings?period=${period}&page=${page}`
      ),
    ...options,
  });
}

export function usePayoutInfo(options?: Partial<UseQueryOptions<PayoutInfo>>) {
  return useQuery<PayoutInfo>({
    queryKey: ["commissions", "payouts"],
    queryFn: async () => {
      const data = await commissionFetch<any>("/commissions/payouts");
      const payouts = Array.isArray(data) ? data : (data?.payouts ?? []);
      return {
        currentMethod: data?.currentMethod ?? "paypal",
        nextPayoutDate: data?.nextPayoutDate ?? null,
        paypalEmail: data?.paypalEmail ?? payouts[0]?.paypalEmail ?? null,
        payoutThreshold: data?.payoutThreshold ?? 5000,
        taxFormSubmitted: data?.taxFormSubmitted ?? false,
        taxFormType: data?.taxFormType ?? null,
        history: payouts,
      } as PayoutInfo;
    },
    ...options,
  });
}

export function useLeaderboard(
  period: string = "this_month",
  options?: Partial<UseQueryOptions<LeaderboardEntry[]>>
) {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ["commissions", "leaderboard", period],
    queryFn: async () => {
      const data = await commissionFetch<any>(`/commissions/leaderboard?period=${period}`);
      return Array.isArray(data) ? data : (data?.leaderboard ?? []);
    },
    ...options,
  });
}

export function useCommissionRates(options?: Partial<UseQueryOptions<CommissionRate[]>>) {
  return useQuery<CommissionRate[]>({
    queryKey: ["commissions", "rates"],
    queryFn: async () => {
      const data = await commissionFetch<any>("/commissions/rates");
      return Array.isArray(data) ? data : (data?.rates ?? []);
    },
    ...options,
  });
}

export function useCommissionResources(options?: Partial<UseQueryOptions<ResourceItem[]>>) {
  return useQuery<ResourceItem[]>({
    queryKey: ["commissions", "resources"],
    queryFn: async () => {
      const data = await commissionFetch<any>("/commissions/resources");
      return Array.isArray(data) ? data : (data?.resources ?? []);
    },
    ...options,
  });
}

export function useUpdateVanityCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      commissionFetch<AffiliateProfile>("/commissions/profile/vanity-code", {
        method: "PUT",
        body: JSON.stringify({ code }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions", "profile"] });
      queryClient.invalidateQueries({ queryKey: ["commissions", "referral-links"] });
    },
  });
}

export function useCheckVanityCode() {
  return useMutation({
    mutationFn: (code: string) =>
      commissionFetch<{ available: boolean }>("/commissions/profile/check-vanity-code", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
  });
}

export function useUpdatePayoutSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      paypalEmail?: string;
      payoutThreshold?: number;
      taxFormType?: string;
    }) =>
      commissionFetch<AffiliateProfile>("/commissions/profile/payout-settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissions", "profile"] });
      queryClient.invalidateQueries({ queryKey: ["commissions", "payouts"] });
    },
  });
}
