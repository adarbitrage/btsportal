import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Star,
  Plus,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { customFetch } from "@workspace/api-client-react";
import { TICKETDESK_URL } from "@/config/support";
import {
  getGetCurrentMemberQueryKey,
  getGetMemberEntitlementsQueryKey,
  getGetMemberProductsQueryKey,
} from "@workspace/api-client-react";
import { initCollectJs, formatCentsAsDollars, type CollectJsHandle } from "@/lib/collect-js";
import { usePaymentMethods, type SavedCard } from "@/hooks/use-payment-methods";

interface CheckoutProduct {
  id: number;
  name: string;
  slug: string;
  priceCents: number | null;
  isNativeNmi: boolean;
  billingType: string | null;
  entitlementKeys: string[];
}

interface CheckoutResponse {
  orderNumber: string;
  status: string;
  grantedEntitlements?: string[];
  grantPending?: boolean;
  reconciling?: boolean;
}

type CheckoutState =
  | { phase: "loading" }
  | { phase: "unavailable"; reason: string }
  | { phase: "already_owned" }
  | { phase: "ready" }
  | { phase: "submitting" }
  | { phase: "in_progress" }
  | { phase: "declined"; message: string }
  | { phase: "success"; orderNumber: string; grantedEntitlements?: string[]; finalizing: boolean }
  | { phase: "unconfirmed" };

type PaymentSource = "saved" | "new";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const FIELD_IDS = {
  ccnumber: "collect-ccnumber",
  ccexp: "collect-ccexp",
  cvv: "collect-cvv",
};

function cardBrandLabel(brand: string): string {
  const map: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
    dinersclub: "Diners Club",
    jcb: "JCB",
    unionpay: "UnionPay",
  };
  return map[brand?.toLowerCase()] ?? brand ?? "Card";
}

export default function Checkout() {
  const params = useParams<{ productId: string }>();
  const productId = parseInt(params.productId ?? "", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [state, setState] = useState<CheckoutState>({ phase: "loading" });
  const [collectJsReady, setCollectJsReady] = useState(false);
  const collectJsHandleRef = useRef<CollectJsHandle | null>(null);
  const idempotencyKeyRef = useRef<string>(generateUUID());

  const [paymentSource, setPaymentSource] = useState<PaymentSource>("new");
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const paymentSourceInitializedRef = useRef(false);

  const validProductId = Number.isInteger(productId) && productId > 0;

  const productQuery = useQuery<CheckoutProduct, Error>({
    queryKey: [`/api/billing/product/${productId}`],
    queryFn: () => customFetch<CheckoutProduct>(`/api/billing/product/${productId}`),
    enabled: validProductId,
    retry: false,
  });

  const tokenKeyQuery = useQuery<{ tokenizationKey: string }, Error>({
    queryKey: ["/api/billing/tokenization-key"],
    queryFn: () => customFetch<{ tokenizationKey: string }>("/api/billing/tokenization-key"),
    enabled: validProductId,
    retry: false,
  });

  const memberQuery = useQuery({
    queryKey: getGetCurrentMemberQueryKey(),
    queryFn: () => customFetch<{ entitlements?: string[] }>("/api/members/me"),
    retry: false,
  });

  const savedCardsQuery = usePaymentMethods();
  const savedCards: SavedCard[] = savedCardsQuery.data ?? [];
  const hasSavedCards = savedCards.length > 0;

  const checkoutMutation = useMutation<
    CheckoutResponse,
    unknown,
    | { productId: number; paymentToken: string; idempotencyKey: string }
    | { productId: number; paymentMethodId: number; idempotencyKey: string }
  >({
    mutationFn: (body) =>
      customFetch<CheckoutResponse>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  });

  const product = productQuery.data;
  const tokenizationKey = tokenKeyQuery.data?.tokenizationKey;
  const memberEntitlements = new Set<string>(memberQuery.data?.entitlements ?? []);

  const productOwnedCheck = useCallback((): boolean => {
    if (!product?.entitlementKeys?.length) return false;
    return product.entitlementKeys.some((k) => memberEntitlements.has(k));
  }, [product, memberEntitlements]);

  useEffect(() => {
    if (!validProductId) {
      setState({ phase: "unavailable", reason: "Invalid product link." });
      return;
    }

    if (productQuery.isError) {
      const err = productQuery.error as { status?: number; data?: { error?: string } };
      const msg =
        (typeof err?.data?.error === "string" && err.data.error) ||
        "This product is not available for checkout.";
      setState({ phase: "unavailable", reason: msg });
      return;
    }

    // Tokenization key is only required for the new-card path. If the key
    // fetch fails but the user has saved cards they can still pay — defer the
    // unavailable state until we know whether the member has saved cards.
    const savedCardsResolved = !savedCardsQuery.isLoading;
    const hasSavedCardsNow = (savedCardsQuery.data ?? []).length > 0;
    if (tokenKeyQuery.isError && savedCardsResolved && !hasSavedCardsNow) {
      setState({
        phase: "unavailable",
        reason: "Checkout is currently unavailable. Please try again later or contact support.",
      });
      return;
    }

    if (
      productQuery.isLoading ||
      tokenKeyQuery.isLoading ||
      memberQuery.isLoading ||
      savedCardsQuery.isLoading
    ) {
      setState({ phase: "loading" });
      return;
    }

    if (!product) return;
    if (!tokenizationKey && !hasSavedCardsNow) return;

    if (productOwnedCheck()) {
      setState({ phase: "already_owned" });
      return;
    }

    setState({ phase: "ready" });
  }, [
    validProductId,
    productQuery.isError,
    productQuery.isLoading,
    productQuery.error,
    tokenKeyQuery.isError,
    tokenKeyQuery.isLoading,
    memberQuery.isLoading,
    savedCardsQuery.isLoading,
    savedCardsQuery.data,
    product,
    tokenizationKey,
    productOwnedCheck,
  ]);

  useEffect(() => {
    if (paymentSourceInitializedRef.current) return;
    if (savedCardsQuery.isLoading) return;
    paymentSourceInitializedRef.current = true;
    if (!hasSavedCards) return;
    const defaultCard = savedCards.find((c) => c.isDefault) ?? savedCards[0];
    if (defaultCard) {
      setSelectedCardId(defaultCard.id);
    }
    setPaymentSource("saved");
  }, [hasSavedCards, savedCards, savedCardsQuery.isLoading]);

  const collectJsInitKey = `${state.phase}-${paymentSource}-${tokenizationKey}-${savedCardsQuery.isLoading}`;
  useEffect(() => {
    if ((state.phase !== "ready" && state.phase !== "declined") || !tokenizationKey) return;
    if (paymentSource === "saved") return;
    if (savedCardsQuery.isLoading) return;

    let cancelled = false;

    setCollectJsReady(false);
    collectJsHandleRef.current = null;

    initCollectJs(tokenizationKey, {
      ccnumber: `#${FIELD_IDS.ccnumber}`,
      ccexp: `#${FIELD_IDS.ccexp}`,
      cvv: `#${FIELD_IDS.cvv}`,
    })
      .then((handle) => {
        if (!cancelled) {
          collectJsHandleRef.current = handle;
          setCollectJsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            phase: "unavailable",
            reason: "Failed to load the secure card form. Check your network and try again.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectJsInitKey]);

  const handleSubmit = useCallback(async () => {
    if (state.phase !== "ready" && state.phase !== "declined") return;
    if (!product) return;

    setState({ phase: "submitting" });

    const currentKey = idempotencyKeyRef.current;

    try {
      let body:
        | { productId: number; paymentToken: string; idempotencyKey: string }
        | { productId: number; paymentMethodId: number; idempotencyKey: string };

      if (paymentSource === "saved" && selectedCardId !== null) {
        body = { productId: product.id, paymentMethodId: selectedCardId, idempotencyKey: currentKey };
      } else {
        if (!collectJsHandleRef.current) {
          setState({ phase: "declined", message: "Card form not ready. Please try again." });
          return;
        }
        let tokenResult: { token: string };
        try {
          tokenResult = await collectJsHandleRef.current.tokenize();
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : "Card tokenization failed. Please try again.";
          setState({ phase: "declined", message: msg });
          return;
        }
        body = { productId: product.id, paymentToken: tokenResult.token, idempotencyKey: currentKey };
      }

      const result = await checkoutMutation.mutateAsync(body);

      idempotencyKeyRef.current = generateUUID();

      queryClient.invalidateQueries({ queryKey: getGetCurrentMemberQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMemberEntitlementsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetMemberProductsQueryKey() });

      const isReconciling = result.reconciling === true || result.grantPending === true;

      setState({
        phase: "success",
        orderNumber: result.orderNumber,
        grantedEntitlements: result.grantedEntitlements,
        finalizing: isReconciling,
      });
    } catch (err: unknown) {
      const apiError = err as {
        status?: number;
        data?: { error?: string | { code?: string; message?: string } };
      };
      const status = apiError?.status;

      if (status === 402) {
        const rawError = apiError?.data?.error;
        const declineMsg =
          typeof rawError === "string"
            ? rawError
            : "Your card was declined. Please check your card details and try again.";
        idempotencyKeyRef.current = generateUUID();
        setState({ phase: "declined", message: declineMsg });
        return;
      }

      if (status === 409) {
        const rawError = apiError?.data?.error;
        const code =
          typeof rawError === "object" && rawError !== null ? rawError.code : undefined;
        if (code === "IDEMPOTENCY_IN_PROGRESS") {
          setState({ phase: "in_progress" });
          return;
        }
        const msg =
          typeof rawError === "object" && rawError !== null
            ? (rawError.message ?? "A conflict occurred. Please try again.")
            : "A conflict occurred. Please try again.";
        setState({ phase: "declined", message: msg });
        return;
      }

      if (status === 400) {
        const rawError = apiError?.data?.error;
        const msg =
          typeof rawError === "string"
            ? rawError
            : typeof rawError === "object" && rawError !== null
              ? (rawError.message ?? "Invalid request.")
              : "Invalid request.";
        setState({ phase: "unavailable", reason: msg });
        return;
      }

      setState({ phase: "unconfirmed" });
    }
  }, [state.phase, product, paymentSource, selectedCardId, checkoutMutation, queryClient]);


  if (!validProductId) {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto py-12 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-4" />
          <p className="text-foreground font-medium">Invalid checkout link.</p>
          <Link href="/plans">
            <Button variant="outline" className="mt-4">
              View upgrade plans
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const isActiveCheckout =
    state.phase === "ready" || state.phase === "submitting" || state.phase === "declined";

  const canSubmit =
    state.phase !== "submitting" &&
    (paymentSource === "saved" ? selectedCardId !== null : collectJsReady);

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <Link href="/plans">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to plans
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Complete your purchase</h1>
          {product && (
            <p className="text-muted-foreground mt-1">
              {product.name}
              {product.priceCents != null && (
                <span className="ml-2 font-semibold text-foreground">
                  — {formatCentsAsDollars(product.priceCents)}
                </span>
              )}
            </p>
          )}
        </div>

        {state.phase === "loading" && (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

        {state.phase === "unavailable" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
              <p className="font-medium text-foreground">Checkout unavailable</p>
              <p className="text-sm text-muted-foreground">{state.reason}</p>
              <div className="flex justify-center gap-3 pt-2">
                <Link href="/plans">
                  <Button variant="outline" size="sm">
                    View plans
                  </Button>
                </Link>
                <a href={TICKETDESK_URL} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    Contact support
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {state.phase === "already_owned" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
              <p className="font-medium text-foreground">You already have access to this product</p>
              <p className="text-sm text-muted-foreground">
                This item is already part of your membership.
              </p>
              <Button variant="outline" size="sm" onClick={() => navigate("/")}>
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        )}

        {state.phase === "success" && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <CheckCircle2 className="w-10 h-10 text-primary mx-auto" />
              <div>
                <p className="font-semibold text-foreground text-lg">
                  {state.finalizing ? "Payment received!" : "Purchase complete!"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Order #{state.orderNumber}
                </p>
              </div>
              {state.finalizing ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
                  <Clock className="w-4 h-4 inline mr-1.5 text-primary" />
                  Finalizing your access — this can take a moment. Your new features will appear
                  shortly. Feel free to refresh if you don't see them yet.
                </div>
              ) : state.grantedEntitlements && state.grantedEntitlements.length > 0 ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground text-left">
                  <p className="font-medium mb-1">Access granted:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                    {state.grantedEntitlements.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Button onClick={() => navigate("/")} className="mt-2">
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        )}

        {state.phase === "in_progress" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="font-medium text-foreground">Payment is already processing</p>
              <p className="text-sm text-muted-foreground">
                This purchase is being processed. Please wait — do not submit again.
              </p>
            </CardContent>
          </Card>
        )}

        {state.phase === "unconfirmed" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="font-medium text-foreground">We couldn't confirm your payment</p>
              <p className="text-sm text-muted-foreground">
                Check your billing history before trying again. If you see a charge, contact
                support — do not submit a second time.
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <Link href="/account/products">
                  <Button variant="outline" size="sm">
                    View billing history
                  </Button>
                </Link>
                <a href={TICKETDESK_URL} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    Contact support
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {isActiveCheckout && (
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span className="font-semibold text-foreground">Secure payment</span>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              {state.phase === "declined" && (
                <div
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground flex items-start gap-2"
                  role="alert"
                >
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span>{state.message}</span>
                    {hasSavedCards && (
                      <p className="text-muted-foreground">
                        You can try a different card below.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {hasSavedCards && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentSource("saved")}
                      className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        paymentSource === "saved"
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                      disabled={state.phase === "submitting"}
                    >
                      <CreditCard className="w-4 h-4 shrink-0" />
                      Pay with saved card
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentSource("new")}
                      className={`flex-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                        paymentSource === "new"
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                      disabled={state.phase === "submitting"}
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      Use a new card
                    </button>
                  </div>

                  {paymentSource === "saved" && (
                    <div className="space-y-2">
                      {savedCards.map((card) => (
                        <label
                          key={card.id}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                            selectedCardId === card.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/30"
                          }`}
                        >
                          <input
                            type="radio"
                            name="saved-card"
                            value={card.id}
                            checked={selectedCardId === card.id}
                            onChange={() => setSelectedCardId(card.id)}
                            className="shrink-0"
                            disabled={state.phase === "submitting"}
                          />
                          <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="flex-1 text-sm text-foreground">
                            {cardBrandLabel(card.brand)} •••• {card.last4}
                            <span className="text-muted-foreground ml-2 text-xs">
                              exp {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                            </span>
                          </span>
                          {card.isDefault && (
                            <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                              <Star className="w-3 h-3" />
                              Default
                            </span>
                          )}
                        </label>
                      ))}
                      <Link href="/payment-methods">
                        <span className="text-xs text-primary hover:underline cursor-pointer">
                          Manage saved cards
                        </span>
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {(!hasSavedCards || paymentSource === "new") && (
                <>
                  {tokenKeyQuery.isError && (
                    <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2.5">
                      New card entry is temporarily unavailable. Please use a saved card or try again
                      later.
                    </p>
                  )}
                  {!hasSavedCards && (
                    <p className="text-xs text-muted-foreground">
                      Your card details are entered directly into NMI's secure hosted fields — they
                      never touch BTS's servers.
                    </p>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Card number
                      </label>
                      <div
                        id={FIELD_IDS.ccnumber}
                        className="h-10 rounded-md border border-input bg-background px-3 flex items-center text-sm"
                        style={{ minHeight: "40px" }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          Expiry
                        </label>
                        <div
                          id={FIELD_IDS.ccexp}
                          className="h-10 rounded-md border border-input bg-background px-3 flex items-center text-sm"
                          style={{ minHeight: "40px" }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                          CVV
                        </label>
                        <div
                          id={FIELD_IDS.cvv}
                          className="h-10 rounded-md border border-input bg-background px-3 flex items-center text-sm"
                          style={{ minHeight: "40px" }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="pt-1 space-y-2">
                {product?.priceCents != null && (
                  <div className="flex justify-between text-sm py-2 border-t border-border/40">
                    <span className="text-muted-foreground">{product.name}</span>
                    <span className="font-semibold text-foreground">
                      {formatCentsAsDollars(product.priceCents)}
                    </span>
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                  data-testid="checkout-submit"
                >
                  {state.phase === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing…
                    </>
                  ) : paymentSource === "new" && !collectJsReady ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading secure form…
                    </>
                  ) : state.phase === "declined" ? (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      Try again
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      {product?.priceCents != null
                        ? `Pay ${formatCentsAsDollars(product.priceCents)}`
                        : "Pay now"}
                    </>
                  )}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  By completing your purchase you agree to our terms of service.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
