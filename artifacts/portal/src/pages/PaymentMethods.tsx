import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import {
  CreditCard,
  Plus,
  Trash2,
  Star,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { customFetch } from "@workspace/api-client-react";
import { initCollectJs, type CollectJsHandle, type CollectJsTokenResult } from "@/lib/collect-js";
import {
  usePaymentMethods,
  useAddPaymentMethod,
  useSetDefaultPaymentMethod,
  useRemovePaymentMethod,
  type SavedCard,
  type AddPaymentMethodInput,
} from "@/hooks/use-payment-methods";
import { useQuery } from "@tanstack/react-query";

const FIELD_IDS = {
  ccnumber: "pm-collect-ccnumber",
  ccexp: "pm-collect-ccexp",
  cvv: "pm-collect-cvv",
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

function CardRow({
  card,
  onSetDefault,
  onRemove,
  settingDefaultId,
  removingId,
  removeError,
}: {
  card: SavedCard;
  onSetDefault: (id: number) => void;
  onRemove: (id: number) => void;
  settingDefaultId: number | null;
  removingId: number | null;
  removeError: { id: number; message: string } | null;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isBusy = settingDefaultId === card.id || removingId === card.id;

  return (
    <div className="flex flex-col gap-2 border border-border/60 rounded-lg p-4">
      <div className="flex items-center gap-3">
        <CreditCard className="w-5 h-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {cardBrandLabel(card.brand)} •••• {card.last4}
          </p>
          <p className="text-xs text-muted-foreground">
            Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
          </p>
        </div>
        {card.isDefault && (
          <span className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
            <Star className="w-3 h-3" />
            Default
          </span>
        )}
      </div>

      {removeError?.id === card.id && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {removeError.message}
        </p>
      )}

      <div className="flex gap-2 mt-1">
        {!card.isDefault && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 px-2"
            disabled={isBusy}
            onClick={() => onSetDefault(card.id)}
          >
            {settingDefaultId === card.id ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Star className="w-3 h-3 mr-1" />
            )}
            Set as default
          </Button>
        )}

        {!confirmRemove ? (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 px-2 text-destructive hover:text-destructive hover:border-destructive/40"
            disabled={isBusy}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Remove
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Remove this card?</span>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs h-7 px-2"
              disabled={isBusy}
              onClick={() => {
                setConfirmRemove(false);
                onRemove(card.id);
              }}
            >
              {removingId === card.id ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}
              Yes, remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              disabled={isBusy}
              onClick={() => setConfirmRemove(false)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentMethods() {
  const { data: cards, isLoading, isError } = usePaymentMethods();
  const addMutation = useAddPaymentMethod();
  const setDefaultMutation = useSetDefaultPaymentMethod();
  const removeMutation = useRemovePaymentMethod();

  const tokenKeyQuery = useQuery<{ tokenizationKey: string }, Error>({
    queryKey: ["/api/billing/tokenization-key"],
    queryFn: () => customFetch<{ tokenizationKey: string }>("/api/billing/tokenization-key"),
    retry: false,
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [collectJsReady, setCollectJsReady] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<{ id: number; message: string } | null>(null);
  const [setAsDefault, setSetAsDefault] = useState(false);

  const collectJsHandleRef = useRef<CollectJsHandle | null>(null);

  useEffect(() => {
    if (!showAddForm || !tokenKeyQuery.data?.tokenizationKey) return;

    let cancelled = false;
    setCollectJsReady(false);
    setAddError(null);

    initCollectJs(tokenKeyQuery.data.tokenizationKey, {
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
          setAddError("Failed to load the secure card form. Check your network and try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showAddForm, tokenKeyQuery.data?.tokenizationKey]);

  const handleAddCard = useCallback(async () => {
    if (!collectJsHandleRef.current) return;
    setAddError(null);

    let tokenResult: CollectJsTokenResult;
    try {
      tokenResult = await collectJsHandleRef.current.tokenize();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Card tokenization failed. Please try again.";
      setAddError(msg);
      collectJsHandleRef.current = null;
      setCollectJsReady(false);
      if (tokenKeyQuery.data?.tokenizationKey) {
        initCollectJs(tokenKeyQuery.data.tokenizationKey, {
          ccnumber: `#${FIELD_IDS.ccnumber}`,
          ccexp: `#${FIELD_IDS.ccexp}`,
          cvv: `#${FIELD_IDS.cvv}`,
        })
          .then((handle) => {
            collectJsHandleRef.current = handle;
            setCollectJsReady(true);
          })
          .catch(() => {});
      }
      return;
    }

    const payload: AddPaymentMethodInput = {
      paymentToken: tokenResult.token,
      last4: tokenResult.last4,
      brand: tokenResult.brand,
      expMonth: tokenResult.expMonth,
      expYear: tokenResult.expYear,
      setDefault: setAsDefault || !cards?.length,
    };

    addMutation.mutate(
      payload,
      {
        onSuccess: () => {
          setShowAddForm(false);
          setAddSuccess(true);
          setAddError(null);
          setSetAsDefault(false);
          collectJsHandleRef.current = null;
          setTimeout(() => setAddSuccess(false), 4000);
        },
        onError: (err: Error) => {
          setAddError(err.message);
          collectJsHandleRef.current = null;
          setCollectJsReady(false);
          if (tokenKeyQuery.data?.tokenizationKey) {
            initCollectJs(tokenKeyQuery.data.tokenizationKey, {
              ccnumber: `#${FIELD_IDS.ccnumber}`,
              ccexp: `#${FIELD_IDS.ccexp}`,
              cvv: `#${FIELD_IDS.cvv}`,
            })
              .then((handle) => {
                collectJsHandleRef.current = handle;
                setCollectJsReady(true);
              })
              .catch(() => {});
          }
        },
      },
    );
  }, [addMutation, cards?.length, setAsDefault, tokenKeyQuery.data?.tokenizationKey]);

  const handleSetDefault = (id: number) => {
    setSettingDefaultId(id);
    setDefaultMutation.mutate(
      { id },
      {
        onSettled: () => setSettingDefaultId(null),
      },
    );
  };

  const handleRemove = (id: number) => {
    setRemovingId(id);
    setRemoveError(null);
    removeMutation.mutate(
      { id },
      {
        onSuccess: () => setRemovingId(null),
        onError: (err: Error) => {
          setRemovingId(null);
          setRemoveError({ id, message: err.message });
        },
      },
    );
  };

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <Link href="/account">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to account
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-foreground">Payment Methods</h1>
          <p className="text-muted-foreground mt-1">
            Manage your saved cards for faster checkout.
          </p>
        </div>

        {addSuccess && (
          <div
            className="rounded-lg border border-primary/40 bg-primary/5 p-3 flex items-center gap-2 text-sm text-foreground"
            role="status"
          >
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            Card saved successfully.
          </div>
        )}

        <Card>
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">Saved cards</span>
              {!showAddForm && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setAddError(null);
                    setShowAddForm(true);
                  }}
                  disabled={tokenKeyQuery.isError}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add card
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {isLoading && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading saved cards…
              </div>
            )}

            {isError && (
              <div className="text-sm text-muted-foreground text-center py-6">
                <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-2" />
                Couldn't load your saved cards. Please refresh the page.
              </div>
            )}

            {!isLoading && !isError && (!cards || cards.length === 0) && !showAddForm && (
              <div className="text-center py-8 space-y-2">
                <CreditCard className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No saved cards yet.</p>
                <p className="text-xs text-muted-foreground">
                  Add a card to speed up checkout next time.
                </p>
              </div>
            )}

            {!isLoading &&
              !isError &&
              cards?.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  onSetDefault={handleSetDefault}
                  onRemove={handleRemove}
                  settingDefaultId={settingDefaultId}
                  removingId={removingId}
                  removeError={removeError}
                />
              ))}

            {showAddForm && (
              <div className="border border-border/60 rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Add a new card</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 w-6 p-0"
                    onClick={() => {
                      setShowAddForm(false);
                      setAddError(null);
                      setCollectJsReady(false);
                      collectJsHandleRef.current = null;
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Card details are entered directly into NMI's secure hosted fields — they never
                  touch BTS's servers.
                </p>

                {addError && (
                  <div
                    className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground flex items-start gap-2"
                    role="alert"
                  >
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <span>{addError}</span>
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

                {cards && cards.length > 0 && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={setAsDefault}
                      onChange={(e) => setSetAsDefault(e.target.checked)}
                      className="rounded"
                    />
                    Set as my default card
                  </label>
                )}

                <Button
                  className="w-full"
                  disabled={!collectJsReady || addMutation.isPending}
                  onClick={handleAddCard}
                >
                  {addMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving card…
                    </>
                  ) : !collectJsReady ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading secure form…
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 mr-2" />
                      Save card
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
