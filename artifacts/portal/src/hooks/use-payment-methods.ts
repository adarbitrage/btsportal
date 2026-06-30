import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";

export interface SavedCard {
  id: number;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

const PAYMENT_METHODS_KEY = ["/billing/payment-methods"];

async function fetchPaymentMethods(): Promise<SavedCard[]> {
  const res = await authFetch("/billing/payment-methods");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg =
      (typeof data?.error === "string" && data.error) ||
      data?.error?.message ||
      "Failed to load saved cards.";
    throw new Error(msg);
  }
  const data = await res.json();
  return (data as { paymentMethods: SavedCard[] }).paymentMethods ?? [];
}

export function usePaymentMethods() {
  return useQuery<SavedCard[], Error>({
    queryKey: PAYMENT_METHODS_KEY,
    queryFn: fetchPaymentMethods,
    retry: false,
  });
}

export interface AddPaymentMethodInput {
  paymentToken: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  setDefault?: boolean;
}

export function useAddPaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation<SavedCard, Error, AddPaymentMethodInput>({
    mutationFn: async ({ paymentToken, last4, brand, expMonth, expYear, setDefault }) => {
      const res = await authFetch("/billing/payment-methods", {
        method: "POST",
        body: JSON.stringify({ paymentToken, last4, brand, expMonth, expYear, setDefault }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const raw = data?.error;
        let msg: string;
        if (res.status === 402) {
          msg =
            (typeof raw === "string" && raw) ||
            "That card couldn't be saved, check the details.";
        } else if (res.status === 502) {
          msg = "Couldn't reach the card processor, try again.";
        } else {
          msg =
            (typeof raw === "string" && raw) ||
            (typeof raw === "object" && raw !== null
              ? ((raw as { message?: string }).message ?? "Failed to save card.")
              : "Failed to save card.");
        }
        throw new Error(msg);
      }
      return data as SavedCard;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_KEY });
    },
  });
}

export function useSetDefaultPaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: number }>({
    mutationFn: async ({ id }) => {
      const res = await authFetch(`/billing/payment-methods/${id}/default`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (typeof data?.error === "string" && data.error) ||
          data?.error?.message ||
          "Failed to set default card.";
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_KEY });
    },
  });
}

export function useRemovePaymentMethod() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: number }>({
    mutationFn: async ({ id }) => {
      const res = await authFetch(`/billing/payment-methods/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 502) {
          throw Object.assign(
            new Error("Couldn't remove that card right now. Please try again later."),
            { isGatewayError: true },
          );
        }
        const msg =
          (typeof data?.error === "string" && data.error) ||
          data?.error?.message ||
          "Failed to remove card.";
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAYMENT_METHODS_KEY });
    },
  });
}
