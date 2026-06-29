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
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { customFetch } from "@workspace/api-client-react";
import {
  getGetCurrentMemberQueryKey,
  getGetMemberEntitlementsQueryKey,
  getGetMemberProductsQueryKey,
} from "@workspace/api-client-react";
import { initCollectJs, formatCentsAsDollars, type CollectJsHandle } from "@/lib/collect-js";

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

export default function Checkout() {
  const params = useParams<{ productId: string }>();
  const productId = parseInt(params.productId ?? "", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [state, setState] = useState<CheckoutState>({ phase: "loading" });
  const [collectJsReady, setCollectJsReady] = useState(false);
  const collectJsHandleRef = useRef<CollectJsHandle | null>(null);
  const idempotencyKeyRef = useRef<string>(generateUUID());

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

  const checkoutMutation = useMutation<
    CheckoutResponse,
    unknown,
    { productId: number; paymentToken: string; idempotencyKey: string }
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

    if (tokenKeyQuery.isError) {
      setState({
        phase: "unavailable",
        reason: "Checkout is currently unavailable. Please try again later or contact support.",
      });
      return;
    }

    if (productQuery.isLoading || tokenKeyQuery.isLoading || memberQuery.isLoading) {
      setState({ phase: "loading" });
      return;
    }

    if (!product || !tokenizationKey) return;

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
    product,
    tokenizationKey,
    productOwnedCheck,
  ]);

  useEffect(() => {
    if (state.phase !== "ready" || !tokenizationKey) return;

    let cancelled = false;

    setCollectJsReady(false);
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
  }, [state.phase, tokenizationKey]);

  const handleSubmit = useCallback(async () => {
    if (state.phase !== "ready" && state.phase !== "declined") return;
    if (!product || !collectJsHandleRef.current) return;

    setState({ phase: "submitting" });

    let paymentToken: string;
    try {
      paymentToken = await collectJsHandleRef.current.tokenize();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Card tokenization failed. Please try again.";
      setState({ phase: "declined", message: msg });
      return;
    }

    const currentKey = idempotencyKeyRef.current;

    try {
      const result = await checkoutMutation.mutateAsync({
        productId: product.id,
        paymentToken,
        idempotencyKey: currentKey,
      });

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
        // 409 conflict (key used with different product) — no charge was
        // attempted; preserve the key so a retry can replay the original intent.
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
        // Validation error — no charge attempted, key is still valid.
        setState({ phase: "unavailable", reason: msg });
        return;
      }

      setState({ phase: "unconfirmed" });
    }
  }, [state.phase, product, checkoutMutation, queryClient]);


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
                <Link href="/support/contact">
                  <Button variant="outline" size="sm">
                    Contact support
                  </Button>
                </Link>
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
                <Link href="/support/contact">
                  <Button variant="outline" size="sm">
                    Contact support
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {(state.phase === "ready" ||
          state.phase === "submitting" ||
          state.phase === "declined") && (
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span className="font-semibold text-foreground">Secure card payment</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Your card details are entered directly into NMI's secure hosted fields — they
                never touch BTS's servers.
              </p>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              {state.phase === "declined" && (
                <div
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground flex items-start gap-2"
                  role="alert"
                >
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <span>{state.message}</span>
                </div>
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
                  disabled={state.phase === "submitting" || !collectJsReady}
                  onClick={handleSubmit}
                  data-testid="checkout-submit"
                >
                  {state.phase === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing…
                    </>
                  ) : !collectJsReady ? (
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
