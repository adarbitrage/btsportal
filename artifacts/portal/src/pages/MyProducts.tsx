import { Link } from "wouter";
import { format } from "date-fns";
import { ArrowLeft, Package, Sparkles, Loader2, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export default function MyProducts() {
  const { data, isLoading, isError } = useGetMemberProducts();
  const products: OwnedProduct[] = data ?? [];

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="my-products-page">
        <div>
          <Link href="/dashboard">
            <Button
              variant="ghost"
              size="sm"
              className="mb-4 -ml-2"
              data-testid="my-products-back-button"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to dashboard
            </Button>
          </Link>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-6 h-6 text-primary" />
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              My products
            </h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Everything you currently have access to, including products granted
            through partner integrations like YSE.
          </p>
        </div>

        {isLoading ? (
          <div
            className="flex items-center justify-center py-16 text-muted-foreground"
            data-testid="my-products-loading"
          >
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading your products…
          </div>
        ) : isError ? (
          <div
            className="border border-border/60 bg-secondary/40 rounded-xl p-6 text-sm text-muted-foreground text-center"
            data-testid="my-products-error"
          >
            We couldn't load your products right now. Please refresh and try
            again.
          </div>
        ) : products.length === 0 ? (
          <Card data-testid="my-products-empty">
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              You don't have any products yet.{" "}
              <Link href="/plans" className="text-primary font-medium hover:underline">
                Browse plans
              </Link>{" "}
              to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        )}
      </div>
    </AppLayout>
  );
}
