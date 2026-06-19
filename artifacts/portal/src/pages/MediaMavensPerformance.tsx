import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useAffiliateConversions, useAffiliatePayouts } from "@/hooks/use-affiliate-performance";

function formatCurrency(value: string | number | undefined | null): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(value: string | undefined | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  const variant =
    status === "approved" || status === "paid"
      ? "default"
      : status === "pending"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{label}</Badge>;
}

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function ConversionsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useAffiliateConversions(page);

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Program</TableHead>
              <TableHead className="text-right">Sale Amount</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableSkeleton cols={5} />}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  Failed to load conversions. Please try refreshing.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  No conversions yet.
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{formatDate(c.created_at)}</TableCell>
                  <TableCell>{c.program?.title ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(c.amount)}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(c.commission?.amount ?? c.commission_amount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {(page > 1 || data?.hasNextPage) && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-4 py-2 text-sm text-muted-foreground">Page {page}</span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage((p) => p + 1)}
                aria-disabled={!data?.hasNextPage}
                className={!data?.hasNextPage ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

function PayoutsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useAffiliatePayouts(page);

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableSkeleton cols={4} />}
            {isError && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  Failed to load payouts. Please try refreshing.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  No payouts yet.
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              !isError &&
              data?.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDate(p.created_at)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.amount)}</TableCell>
                  <TableCell>{p.payment_method ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {(page > 1 || data?.hasNextPage) && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-4 py-2 text-sm text-muted-foreground">Page {page}</span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage((p) => p + 1)}
                aria-disabled={!data?.hasNextPage}
                className={!data?.hasNextPage ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

export default function MediaMavensPerformance() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-5xl">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2 text-muted-foreground">
            <Link href="/affiliate-networks">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Affiliate Networks
            </Link>
          </Button>

          <div className="flex items-center gap-2 mb-2">
            <BarChart2 className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Media Mavens Performance</h1>
          </div>
          <p className="text-muted-foreground">
            View your conversions and payouts from your Media Mavens affiliate account.
          </p>
        </div>

        <Tabs defaultValue="conversions">
          <TabsList>
            <TabsTrigger value="conversions">Conversions</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
          </TabsList>

          <TabsContent value="conversions" className="mt-6">
            <ConversionsTab />
          </TabsContent>

          <TabsContent value="payouts" className="mt-6">
            <PayoutsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
