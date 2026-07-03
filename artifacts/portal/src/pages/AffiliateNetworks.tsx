import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Network } from "lucide-react";
import { useListAffiliateNetworks } from "@workspace/api-client-react";
import { NetworkCard } from "@/components/NetworkCard";

function NetworkCardSkeleton() {
  return (
    <Card className="border-2 border-border overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <Skeleton className="w-24 h-16" />
          </div>
          <div className="flex-1 p-5 flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AffiliateNetworks() {
  const { data: networks, isLoading, isError } = useListAffiliateNetworks();

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Network className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Affiliate Networks</h1>
          </div>
          <p className="text-muted-foreground">
            An affiliate network is where you'll find the product you promote and get
            your unique tracking link — think of it like choosing which store you're
            going to sell products for. These are the networks supported inside the
            Build Test Scale™ system.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm text-emerald-900">
            <strong>How to choose:</strong> If you're brand new, start with{" "}
            <strong>Media Mavens</strong>. It's our own in-house network, built
            specifically for this system, and gives you several advantages out of the
            gate. If you want to explore other options, <strong>ClickBank</strong> is the
            next easiest entry point — a large public marketplace with instant signup.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5">
          {isLoading && (
            <>
              <NetworkCardSkeleton />
              <NetworkCardSkeleton />
            </>
          )}
          {isError && (
            <div className="text-center py-12 text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Failed to load affiliate networks. Please try refreshing the page.</p>
            </div>
          )}
          {!isLoading && !isError && networks && networks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No affiliate networks available at this time.</p>
            </div>
          )}
          {networks?.map((n) => (
            <NetworkCard key={n.slug} network={n} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
