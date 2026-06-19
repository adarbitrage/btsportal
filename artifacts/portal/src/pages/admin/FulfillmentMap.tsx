import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Package,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react";
import {
  adminPanelApi,
  type FulfillmentCatalogResponse,
  type FulfillmentMappingRow,
  type FulfillmentProduct,
} from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { format } from "date-fns";

// The Machine owns the offer-catalog JSON shape, so we normalise defensively:
// accept a few plausible field aliases and skip anything we can't read rather
// than crashing the page on an unexpected payload.
type NormalizedSlot = { machineKey: string; label: string };
type NormalizedOffer = {
  id: string;
  name: string;
  price: string | null;
  slots: NormalizedSlot[];
};

function asNonEmptyString(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function normalizeCatalog(catalog: unknown): NormalizedOffer[] {
  if (!catalog || typeof catalog !== "object") return [];
  const root = catalog as Record<string, unknown>;
  const rawOffers = Array.isArray(root.frontEndOffers)
    ? root.frontEndOffers
    : Array.isArray(root.offers)
      ? root.offers
      : [];
  const offers: NormalizedOffer[] = [];
  for (const raw of rawOffers) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const id =
      asNonEmptyString(o.id) ??
      asNonEmptyString(o.slug) ??
      asNonEmptyString(o.key);
    if (!id) continue;
    const name = asNonEmptyString(o.name) ?? asNonEmptyString(o.title) ?? id;
    const price =
      asNonEmptyString(o.priceDisplay) ??
      asNonEmptyString(o.price) ??
      asNonEmptyString(o.frontEndPrice) ??
      asNonEmptyString(o.frontendPrice);
    const rawSlots = Array.isArray(o.slots)
      ? o.slots
      : Array.isArray(o.aovSlots)
        ? o.aovSlots
        : Array.isArray(o.items)
          ? o.items
          : [];
    const slots: NormalizedSlot[] = [];
    for (const rs of rawSlots) {
      if (!rs || typeof rs !== "object") continue;
      const s = rs as Record<string, unknown>;
      const machineKey =
        asNonEmptyString(s.machineKey) ??
        asNonEmptyString(s.key) ??
        asNonEmptyString(s.productKey);
      if (!machineKey) continue;
      const role =
        asNonEmptyString(s.role) ??
        asNonEmptyString(s.type) ??
        asNonEmptyString(s.slot);
      const label =
        asNonEmptyString(s.label) ??
        asNonEmptyString(s.name) ??
        role ??
        machineKey;
      slots.push({ machineKey, label });
    }
    offers.push({ id, name, price, slots });
  }
  return offers;
}

type PendingChange = {
  offerName: string;
  slotLabel: string;
  machineKey: string;
  newSlug: string;
  product: FulfillmentProduct;
  existing: FulfillmentMappingRow | null;
};

export default function FulfillmentMap() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = hasPermission(user?.role, "members:edit");

  const [data, setData] = useState<FulfillmentCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await adminPanelApi.getFulfillmentCatalog();
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fulfillment map",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mappingByKey = useMemo(() => {
    const map = new Map<string, FulfillmentMappingRow>();
    for (const m of data?.mappings ?? []) map.set(m.machineKey, m);
    return map;
  }, [data]);

  const productBySlug = useMemo(() => {
    const map = new Map<string, FulfillmentProduct>();
    for (const p of data?.products ?? []) map.set(p.slug, p);
    return map;
  }, [data]);

  const offers = useMemo(
    () => (data ? normalizeCatalog(data.catalog) : []),
    [data],
  );

  // When the catalog is unreachable we still let admins maintain existing
  // mappings — render every stored mapping as a flat, editable list so the
  // page stays useful (no offer grouping is possible without the catalog).
  const fallbackSlots = useMemo<NormalizedSlot[]>(() => {
    if (!data) return [];
    return data.mappings.map((m) => ({
      machineKey: m.machineKey,
      label: m.machineKey,
    }));
  }, [data]);

  const onSelectLevel = (
    offerName: string,
    slot: NormalizedSlot,
    newSlug: string,
  ) => {
    const existing = mappingByKey.get(slot.machineKey) ?? null;
    if (existing && existing.portalSlug === newSlug) return; // no-op
    const product = productBySlug.get(newSlug);
    if (!product) return;
    setPending({
      offerName,
      slotLabel: slot.label,
      machineKey: slot.machineKey,
      newSlug,
      product,
      existing,
    });
  };

  const confirmChange = async () => {
    if (!pending) return;
    try {
      setSaving(true);
      if (pending.existing) {
        await adminPanelApi.updateMachineProductKeyMapping(pending.existing.id, {
          portalSlug: pending.newSlug,
        });
      } else {
        await adminPanelApi.createMachineProductKeyMapping({
          machineKey: pending.machineKey,
          portalSlug: pending.newSlug,
        });
      }
      toast({
        title: "Mapping updated",
        description: `${pending.machineKey} now grants “${pending.product.name}”.`,
      });
      setPending(null);
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save mapping",
        description:
          err instanceof Error ? err.message : "Unknown error saving mapping",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderSlotRow = (offerName: string, slot: NormalizedSlot) => {
    const mapping = mappingByKey.get(slot.machineKey) ?? null;
    const mappedProduct = mapping
      ? productBySlug.get(mapping.portalSlug)
      : undefined;
    const unmapped = !mapping;
    // A mapping whose slug isn't in the (entitlement-bearing) products list
    // either points at a deleted product or one with an empty entitlement set —
    // both mean the buyer is granted nothing.
    const grantsNothing = !!mapping && !mappedProduct;

    return (
      <div
        key={slot.machineKey}
        className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between"
        data-testid={`slot-row-${slot.machineKey}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{slot.label}</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {slot.machineKey}
            </code>
            {unmapped && (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Unmapped — grants nothing
              </Badge>
            )}
            {grantsNothing && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Maps to “{mapping?.portalSlug}” — no entitlements
              </Badge>
            )}
          </div>
          {mappedProduct && (
            <p className="mt-1 text-sm text-muted-foreground">
              Grants{" "}
              <span className="font-medium text-foreground">
                {mappedProduct.name}
              </span>{" "}
              →{" "}
              {mappedProduct.entitlementKeys.map((k) => (
                <code
                  key={k}
                  className="mr-1 rounded bg-muted px-1 py-0.5 text-xs"
                >
                  {k}
                </code>
              ))}
            </p>
          )}
        </div>
        <div className="w-full sm:w-72">
          <Select
            value={mapping?.portalSlug ?? undefined}
            onValueChange={(v) => onSelectLevel(offerName, slot, v)}
            disabled={!canEdit || (data?.products.length ?? 0) === 0}
          >
            <SelectTrigger
              data-testid={`slot-select-${slot.machineKey}`}
              aria-label={`Member level for ${slot.label}`}
            >
              <SelectValue placeholder="Choose a member level…" />
            </SelectTrigger>
            <SelectContent>
              {data?.products.map((p) => (
                <SelectItem key={p.slug} value={p.slug}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Package className="h-6 w-6" />
              Fulfillment Map
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Each card is a front-end offer pulled live from The Machine. For
              every slot, choose which member level a purchase grants. Changes
              affect future purchases only — existing members are not altered.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            data-testid="button-refresh"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {!canEdit && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            You have view-only access. Editing a mapping requires the
            members:edit permission.
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading fulfillment map…
          </div>
        )}

        {!loading && error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="error-banner"
          >
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            {!data.catalogAvailable && (
              <div
                className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
                data-testid="catalog-unavailable"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    Live offer catalog is unavailable
                  </p>
                  <p>
                    {data.catalogError ??
                      "The Machine offer catalog could not be reached."}{" "}
                    Showing existing mappings below as an editable list.
                  </p>
                </div>
              </div>
            )}

            {(data.products.length ?? 0) === 0 && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                No products with entitlements exist yet, so there are no member
                levels to map to. Add entitlements to products first.
              </div>
            )}

            {/* Offer cards (catalog available) */}
            {data.catalogAvailable && offers.length > 0 && (
              <div className="space-y-4">
                {offers.map((offer) => (
                  <Card key={offer.id} data-testid={`offer-card-${offer.id}`}>
                    <CardContent className="pt-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold">{offer.name}</h2>
                        {offer.price && (
                          <Badge variant="secondary">{offer.price}</Badge>
                        )}
                      </div>
                      <div className="mt-3">
                        {offer.slots.length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">
                            This offer has no slots in the catalog.
                          </p>
                        ) : (
                          offer.slots.map((slot) =>
                            renderSlotRow(offer.name, slot),
                          )
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Catalog available but parsed to zero offers */}
            {data.catalogAvailable && offers.length === 0 && (
              <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                The offer catalog loaded but contained no recognisable
                front-end offers.
              </div>
            )}

            {/* Fallback editable mapping list (catalog unavailable) */}
            {!data.catalogAvailable && (
              <Card data-testid="fallback-mappings">
                <CardContent className="pt-6">
                  <h2 className="text-lg font-semibold">Existing mappings</h2>
                  <div className="mt-3">
                    {fallbackSlots.length === 0 ? (
                      <p className="py-3 text-sm text-muted-foreground">
                        No mappings exist yet.
                      </p>
                    ) : (
                      fallbackSlots.map((slot) =>
                        renderSlotRow("Existing mapping", slot),
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Unknown keys seen in real orders */}
            <Card data-testid="unknown-keys">
              <CardContent className="pt-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  Unmapped keys seen in real orders
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Keys The Machine sent that had no mapping. Add a mapping above
                  (or to the matching offer slot) to fulfill them.
                </p>
                <div className="mt-3">
                  {data.unknownKeys.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">
                      None — every key The Machine has sent maps to a product.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.unknownKeys.map((k) => (
                        <div
                          key={k.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm"
                          data-testid={`unknown-key-${k.machineKey}`}
                        >
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {k.machineKey}
                          </code>
                          <span className="text-muted-foreground">
                            seen {k.occurrences}×
                            {k.lastSeenAt
                              ? ` · last ${format(new Date(k.lastSeenAt), "MMM d, yyyy")}`
                              : ""}
                            {k.lastExternalSource
                              ? ` · ${k.lastExternalSource}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm fulfillment change</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Purchases of{" "}
                  <span className="font-medium text-foreground">
                    {pending?.offerName} ▸ {pending?.slotLabel}
                  </span>{" "}
                  (<code className="text-xs">{pending?.machineKey}</code>) will
                  grant the{" "}
                  <span className="font-medium text-foreground">
                    {pending?.product.name}
                  </span>{" "}
                  level.
                </p>
                <div>
                  <p className="mb-1">This grants the entitlements:</p>
                  {pending && pending.product.entitlementKeys.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {pending.product.entitlementKeys.map((k) => (
                        <code
                          key={k}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs"
                        >
                          {k}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <span className="text-destructive">
                      No entitlements — this level grants nothing.
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">
                  This affects future purchases of this slot only. Existing
                  members are not changed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmChange();
              }}
              disabled={saving}
              data-testid="confirm-mapping"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Confirm change"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
