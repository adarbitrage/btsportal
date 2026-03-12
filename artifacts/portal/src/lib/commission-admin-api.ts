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
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export interface Commission {
  id: number;
  orderId: string;
  customerEmail: string;
  saleAmount: number;
  commissionRate: string;
  commissionAmount: number;
  status: string;
  tier: string;
  fraudFlag: string | null;
  affiliateName: string;
  affiliateEmail: string;
  productName: string;
  createdAt: string;
  approvedAt: string | null;
  paidAt: string | null;
}

export interface CommissionPayout {
  id: number;
  affiliateId: number;
  affiliateName: string;
  affiliateEmail: string;
  amount: number;
  commissionCount: number;
  status: string;
  paypalEmail: string | null;
  paypalTransactionId: string | null;
  notes: string | null;
  generatedAt: string;
  paidAt: string | null;
}

export interface Affiliate {
  id: number;
  userId: number;
  name: string;
  email: string;
  affiliateCode: string;
  tier: string;
  status: string;
  totalEarnings: number;
  totalPaid: number;
  pendingBalance: number;
  approvedBalance: number;
  lifetimeClicks: number;
  lifetimeConversions: number;
  fraudFlag: boolean;
  fraudReason: string | null;
  paypalEmail: string | null;
  taxFormSubmitted: boolean;
  createdAt: string;
}

export interface CommissionRate {
  id: number;
  tier: string;
  productId: number;
  productName: string;
  productSlug: string;
  ratePercent: string;
  flatBonus: number;
  createdAt: string;
}

export interface AffiliateResource {
  id: number;
  type: string;
  title: string;
  description: string | null;
  content: string | null;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  productSlug: string | null;
  sortOrder: number;
  status: string;
  createdAt: string;
}

export interface FraudAlerts {
  flaggedCommissions: Array<{
    id: number;
    orderId: string;
    customerEmail: string;
    commissionAmount: number;
    fraudFlag: string;
    status: string;
    affiliateName: string;
    affiliateEmail: string;
    productName: string;
    createdAt: string;
  }>;
  flaggedAffiliates: Array<{
    id: number;
    name: string;
    email: string;
    affiliateCode: string;
    fraudFlag: boolean;
    fraudReason: string | null;
    lifetimeClicks: number;
    lifetimeConversions: number;
  }>;
  highClickLowConversion: Array<{
    id: number;
    name: string;
    email: string;
    affiliateCode: string;
    lifetimeClicks: number;
    lifetimeConversions: number;
    tier: string;
    conversionRate: string;
    reason: string;
  }>;
}

export const commissionAdminApi = {
  getCommissions: (params: { page?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.status) qs.set("status", params.status);
    return adminFetch<{ commissions: Commission[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/admin/commissions?${qs.toString()}`);
  },

  approveCommission: (id: number) =>
    adminFetch<{ commission: Commission }>(`/admin/commissions/${id}/approve`, { method: "POST" }),

  rejectCommission: (id: number, reason: string) =>
    adminFetch<{ commission: Commission }>(`/admin/commissions/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  reverseCommission: (id: number, reason: string) =>
    adminFetch<{ commission: Commission }>(`/admin/commissions/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),

  runApproval: () =>
    adminFetch<{ approved: number; cutoffDate: string }>("/admin/commissions/run-approval", { method: "POST" }),

  generatePayouts: () =>
    adminFetch<{ payoutsGenerated: number; payouts: any[]; threshold: number }>("/admin/commissions/generate-payouts", { method: "POST" }),

  getPayouts: () =>
    adminFetch<{ payouts: CommissionPayout[] }>("/admin/commissions/payouts"),

  markPayoutPaid: (id: number, paypalTransactionId: string, notes?: string) =>
    adminFetch<{ payout: CommissionPayout }>(`/admin/commissions/payouts/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify({ paypalTransactionId, notes }),
    }),

  getAffiliates: () =>
    adminFetch<{ affiliates: Affiliate[] }>("/admin/affiliates"),

  updateAffiliate: (id: number, data: { status?: string; tier?: string; fraudFlag?: boolean; fraudReason?: string }) =>
    adminFetch<{ affiliate: Affiliate }>(`/admin/affiliates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getRates: () =>
    adminFetch<{ rates: CommissionRate[] }>("/admin/commissions/rates"),

  createRate: (data: { tier: string; productId: number; ratePercent: number; flatBonus?: number }) =>
    adminFetch<{ rate: CommissionRate }>("/admin/commissions/rates", { method: "POST", body: JSON.stringify(data) }),

  updateRate: (id: number, data: { ratePercent?: number; flatBonus?: number }) =>
    adminFetch<{ rate: CommissionRate }>(`/admin/commissions/rates/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteRate: (id: number) =>
    adminFetch<{ deleted: boolean }>(`/admin/commissions/rates/${id}`, { method: "DELETE" }),

  getResources: () =>
    adminFetch<{ resources: AffiliateResource[] }>("/admin/commissions/resources"),

  createResource: (data: Partial<AffiliateResource>) =>
    adminFetch<{ resource: AffiliateResource }>("/admin/commissions/resources", { method: "POST", body: JSON.stringify(data) }),

  updateResource: (id: number, data: Partial<AffiliateResource>) =>
    adminFetch<{ resource: AffiliateResource }>(`/admin/commissions/resources/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  deleteResource: (id: number) =>
    adminFetch<{ deleted: boolean }>(`/admin/commissions/resources/${id}`, { method: "DELETE" }),

  getFraudAlerts: () =>
    adminFetch<FraudAlerts>("/admin/commissions/fraud-alerts"),

  exportCsv: async () => {
    const allCommissions: Commission[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const data = await commissionAdminApi.getCommissions({ page });
      allCommissions.push(...data.commissions);
      totalPages = data.pagination.totalPages;
      page++;
    } while (page <= totalPages);

    const escapeCsvField = (val: string | number) => {
      const str = String(val);
      if (/[,"\n\r]/.test(str) || /^[=+\-@\t\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = allCommissions.map(c => [
      c.id, escapeCsvField(c.affiliateName), escapeCsvField(c.customerEmail),
      escapeCsvField(c.productName), (c.saleAmount / 100).toFixed(2),
      (c.commissionAmount / 100).toFixed(2), c.status, c.createdAt
    ].join(","));
    const csv = ["ID,Affiliate,Customer,Product,Sale,Commission,Status,Date", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commissions-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
