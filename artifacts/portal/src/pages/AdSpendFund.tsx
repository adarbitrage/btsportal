import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Wallet,
  Plus,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { customFetch } from "@workspace/api-client-react";
import { supportLinkProps } from "@/config/support";
import { initCollectJs, type CollectJsHandle } from "@/lib/collect-js";
import { usePaymentMethods, type SavedCard } from "@/hooks/use-payment-methods";

const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10000;

const FIELD_IDS = {
  ccnumber: "adspend-ccnumber",
  ccexp: "adspend-ccexp",
  cvv: "adspend-cvv",
};

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

interface BalanceResponse {
  balanceCents: number;
  balanceDisplay: string;
}

type FundState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "submitting" }
  | { phase: "in_progress" }
  | { phase: "declined"; message: string }
  | { phase: "success"; orderNumber: string; creditedCents: number; reconciling?: boolean }
  | { phase: "error"; message: string };

type PaymentSource = "saved" | "new";

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

export default function AdSpendFund() {
  const queryClient = useQueryClient();

  const [state, setState] = useState<FundState>({ phase: "loading" });
  const [amountInput, setAmountInput] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const [collectJsReady, setCollectJsReady] = useState(false);
  const collectJsHandleRef = useRef<CollectJsHandle | null>(null);
  const idempotencyKeyRef = useRef<string>(generateUUID());

  const [paymentSource, setPaymentSource] = useState<PaymentSource>("new");
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const paymentSourceInitializedRef = useRef(false);

  const balanceQuery = useQuery<BalanceResponse>({
    queryKey: ["/api/ad-spend/balance"],
    queryFn: () => customFetch<BalanceResponse>("/api/ad-spend/balance"),
    refetchOnWindowFocus: false,
  });

  const tokenKeyQuery = useQuery<{ tokenizationKey: string }>({
    queryKey: ["/api/billing/tokenization-key"],
    queryFn: () => customFetch<{ tokenizationKey: string }>("/api/billing/tokenization-key"),
    retry: false,
  });

  const savedCardsQuery = usePaymentMethods();
  const savedCards: SavedCard[] = savedCardsQuery.data ?? [];
  const hasSavedCards = savedCards.length > 0;

  const tokenizationKey = tokenKeyQuery.data?.tokenizationKey;

  useEffect(() => {
    if (balanceQuery.isLoading || tokenKeyQuery.isLoading || savedCardsQuery.isLoading) {
      setState({ phase: "loading" });
      return;
    }
    if (tokenKeyQuery.isError && !hasSavedCards) {
      setState({ phase: "error", message: "Checkout is currently unavailable. Please try again later." });
      return;
    }
    setState({ phase: "ready" });
  }, [balanceQuery.isLoading, tokenKeyQuery.isLoading, tokenKeyQuery.isError, savedCardsQuery.isLoading, hasSavedCards]);

  useEffect(() => {
    if (paymentSourceInitializedRef.current) return;
    if (savedCardsQuery.isLoading) return;
    paymentSourceInitializedRef.current = true;
    if (!hasSavedCards) return;
    const defaultCard = savedCards.find((c) => c.isDefault) ?? savedCards[0];
    if (defaultCard) setSelectedCardId(defaultCard.id);
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
          setState({ phase: "error", message: "Failed to load the secure card form. Check your network and try again." });
        }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectJsInitKey]);

  const validateAmount = useCallback((raw: string): number | null => {
    const parsed = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isFinite(parsed) || parsed <= 0) {
      setAmountError("Please enter a valid dollar amount.");
      return null;
    }
    if (parsed < MIN_AMOUNT) {
      setAmountError(`Minimum deposit is $${MIN_AMOUNT.toLocaleString()}.`);
      return null;
    }
    if (parsed > MAX_AMOUNT) {
      setAmountError(`Maximum deposit is $${MAX_AMOUNT.toLocaleString()}.`);
      return null;
    }
    setAmountError(null);
    return Math.round(parsed * 100);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (state.phase !== "ready" && state.phase !== "declined") return;

    const amountCents = validateAmount(amountInput);
    if (amountCents === null) return;

    setState({ phase: "submitting" });
    const currentKey = idempotencyKeyRef.current;

    try {
      type FundBody =
        | { amountCents: number; idempotencyKey: string; paymentToken: string }
        | { amountCents: number; idempotencyKey: string; paymentMethodId: number };

      let body: FundBody;

      if (paymentSource === "saved" && selectedCardId !== null) {
        body = { amountCents, idempotencyKey: currentKey, paymentMethodId: selectedCardId };
      } else {
        if (!collectJsHandleRef.current) {
          setState({ phase: "declined", message: "Card form not ready. Please try again." });
          return;
        }
        let tokenResult: { token: string };
        try {
          tokenResult = await collectJsHandleRef.current.tokenize();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Card tokenization failed. Please try again.";
          setState({ phase: "declined", message: msg });
          return;
        }
        body = { amountCents, idempotencyKey: currentKey, paymentToken: tokenResult.token };
      }

      const result = await customFetch<{
        orderNumber: string;
        status: string;
        creditedCents?: number;
        reconciling?: boolean;
      }>("/api/ad-spend/fund", {
        method: "POST",
        body: JSON.stringify(body),
      });

      idempotencyKeyRef.current = generateUUID();
      queryClient.invalidateQueries({ queryKey: ["/api/ad-spend/balance"] });
      setAmountInput("");

      setState({
        phase: "success",
        orderNumber: result.orderNumber,
        creditedCents: result.creditedCents ?? amountCents,
        reconciling: result.reconciling === true,
      });
    } catch (err: unknown) {
      const apiError = err as {
        status?: number;
        data?: { error?: string | { code?: string; message?: string } };
      };
      const status = apiError?.status;

      if (status === 402) {
        const rawError = apiError?.data?.error;
        const msg = typeof rawError === "string"
          ? rawError
          : "Your card was declined. Please check your card details and try again.";
        idempotencyKeyRef.current = generateUUID();
        setState({ phase: "declined", message: msg });
        return;
      }

      if (status === 409) {
        const rawError = apiError?.data?.error;
        const code = typeof rawError === "object" && rawError !== null ? rawError.code : undefined;
        if (code === "IDEMPOTENCY_IN_PROGRESS") {
          setState({ phase: "in_progress" });
          return;
        }
        const msg = typeof rawError === "object" && rawError !== null
          ? (rawError.message ?? "A conflict occurred. Please try again.")
          : "A conflict occurred. Please try again.";
        setState({ phase: "declined", message: msg });
        return;
      }

      if (status === 400) {
        const rawError = apiError?.data?.error;
        const msg = typeof rawError === "string"
          ? rawError
          : typeof rawError === "object" && rawError !== null
            ? (rawError.message ?? "Invalid request.")
            : "Invalid request.";
        setState({ phase: "error", message: msg });
        return;
      }

      setState({ phase: "error", message: "An unexpected error occurred. Your card may not have been charged." });
    }
  }, [state.phase, amountInput, validateAmount, paymentSource, selectedCardId, queryClient]);

  const isSubmitting = state.phase === "submitting";
  const isActivePhase = state.phase === "ready" || state.phase === "declined";

  const canSubmit =
    !isSubmitting &&
    isActivePhase &&
    (paymentSource === "saved" ? selectedCardId !== null : collectJsReady) &&
    amountInput.length > 0 &&
    amountError === null;

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to dashboard
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Fund Ad Spend</h1>
          <p className="text-muted-foreground mt-1">
            Deposit funds into your ad-spend balance using your credit card.
          </p>
        </div>

        {/* Balance card */}
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <Wallet className="w-8 h-8 text-primary shrink-0" />
            <div>
              <p className="text-sm text-muted-foreground">Current Balance</p>
              {balanceQuery.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-1" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {balanceQuery.data?.balanceDisplay ?? "$0"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {state.phase === "loading" && (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}

        {state.phase === "error" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
              <p className="font-medium text-foreground">Funding unavailable</p>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <a {...supportLinkProps}>
                <Button variant="outline" size="sm">Contact support</Button>
              </a>
            </CardContent>
          </Card>
        )}

        {state.phase === "in_progress" && (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <Clock className="w-8 h-8 text-primary mx-auto" />
              <p className="font-medium text-foreground">Payment in progress</p>
              <p className="text-sm text-muted-foreground">
                Your payment is still being processed. Please wait a moment before trying again.
              </p>
              <Button variant="outline" size="sm" onClick={() => setState({ phase: "ready" })}>
                Try again
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
                  {state.reconciling ? "Payment received!" : "Deposit complete!"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Order #{state.orderNumber}
                </p>
              </div>
              {state.reconciling ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
                  <Clock className="w-4 h-4 inline mr-1.5 text-primary" />
                  Your balance is being updated — this can take a moment. Refresh to see the updated balance.
                </div>
              ) : (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4 inline mr-1.5 text-primary" />
                  {formatDollars(state.creditedCents)} has been added to your ad-spend balance.
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => setState({ phase: "ready" })}>
                Make another deposit
              </Button>
            </CardContent>
          </Card>
        )}

        {isActivePhase && (
          <Card>
            <CardHeader className="pb-2">
              <p className="font-semibold text-foreground">Deposit Amount</p>
              <p className="text-sm text-muted-foreground">
                Between ${MIN_AMOUNT.toLocaleString()} and ${MAX_AMOUNT.toLocaleString()} per deposit.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="deposit-amount">Amount ($)</Label>
                <Input
                  id="deposit-amount"
                  type="number"
                  min={MIN_AMOUNT}
                  max={MAX_AMOUNT}
                  step="1"
                  placeholder="e.g. 2500"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    if (amountError) validateAmount(e.target.value);
                  }}
                  onBlur={(e) => validateAmount(e.target.value)}
                  disabled={isSubmitting}
                />
                {amountError && (
                  <p className="text-sm text-destructive">{amountError}</p>
                )}
              </div>

              {state.phase === "declined" && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{state.message}</p>
                </div>
              )}

              {/* Saved card selector */}
              {hasSavedCards && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Payment method</p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant={paymentSource === "saved" ? "default" : "outline"}
                      onClick={() => setPaymentSource("saved")}
                      disabled={isSubmitting}
                    >
                      Saved card
                    </Button>
                    <Button
                      size="sm"
                      variant={paymentSource === "new" ? "default" : "outline"}
                      onClick={() => setPaymentSource("new")}
                      disabled={isSubmitting}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      New card
                    </Button>
                  </div>

                  {paymentSource === "saved" && (
                    <div className="space-y-1.5">
                      {savedCards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setSelectedCardId(card.id)}
                          disabled={isSubmitting}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                            selectedCardId === card.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="text-sm">
                            {cardBrandLabel(card.brand)} •••• {card.last4}
                          </span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {card.expMonth}/{card.expYear}
                          </span>
                          {card.isDefault && (
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Default</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Collect.js inline card fields */}
              {paymentSource === "new" && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Card details</p>
                  <div className="space-y-2">
                    <div
                      id={FIELD_IDS.ccnumber}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[38px]"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        id={FIELD_IDS.ccexp}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[38px]"
                      />
                      <div
                        id={FIELD_IDS.cvv}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[38px]"
                      />
                    </div>
                  </div>
                  {!collectJsReady && !tokenKeyQuery.isError && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading secure card form…
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" />
                Payments are processed securely through NMI. Card details are never stored on our servers.
              </div>

              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Deposit{amountInput ? ` $${parseFloat(amountInput.replace(/[^0-9.]/g, "") || "0").toLocaleString()}` : ""}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
