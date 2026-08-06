import { Link } from "wouter";
import { format } from "date-fns";
import { Sparkles, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useGetMemberProducts,
  type OwnedProduct,
} from "@workspace/api-client-react";

function StatusBadge({ status }: { status: string }) {
  const variant: "default" | "secondary" | "destructive" | "outline" =
    status === "active"
      ? "default"
      : status === "expired" || status === "revoked"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} data-testid={`my-product-status-${status}`}>
      {status}
    </Badge>
  );
}

/**
 * Body of the "My Products" collapsible card on the Account page (Task #2026).
 * Extracted from the retired standalone /account/products page — the old URL
 * now redirects to /account?card=my-products.
 */
export function MyProductsCardContent() {
  const { data, isLoading, isError } = useGetMemberProducts();
  const products: OwnedProduct[] = data ?? [];

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-10 text-muted-foreground"
        data-testid="my-products-loading"
      >
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading your products…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="border border-border/60 bg-secondary/40 rounded-xl p-6 text-sm text-muted-foreground text-center"
        data-testid="my-products-error"
      >
        We couldn't load your products right now. Please refresh and try again.
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div
        className="py-8 text-center text-muted-foreground text-sm"
        data-testid="my-products-empty"
      >
        You don't have any products yet. Talk to your coach to get started.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="my-products-list">
      {products.map((p) => {
        const grantedByYse = p.externalSource === "yse";
        return (
          <Card
            key={p.id}
            data-testid={`my-product-card-${p.id}`}
            data-external-source={p.externalSource ?? undefined}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {p.productName}
                  </h3>
                  <p className="text-xs text-muted-foreground capitalize">
                    {p.productType}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {grantedByYse && (
                  <Badge
                    variant="secondary"
                    className="gap-1"
                    data-testid={`my-product-${p.id}-yse-badge`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    Granted via YSE
                  </Badge>
                )}
                {p.externalSource && !grantedByYse && (
                  <Badge
                    variant="outline"
                    className="gap-1"
                    data-testid={`my-product-${p.id}-source-badge`}
                  >
                    <Sparkles className="w-3 h-3" />
                    Granted via {p.externalSource}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">
                Purchased{" "}
                <span className="text-foreground">
                  {format(new Date(p.purchasedAt), "MMM d, yyyy")}
                </span>
              </p>
              {p.expiresAt && (
                <p className="text-muted-foreground">
                  Expires{" "}
                  <span className="text-foreground">
                    {format(new Date(p.expiresAt), "MMM d, yyyy")}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
