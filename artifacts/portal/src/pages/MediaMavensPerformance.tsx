import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  useAffiliateConversions,
  useAffiliatePayouts,
  type ConversionFilters,
  type ConversionStatusFilter,
} from "@/hooks/use-affiliate-performance";

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

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "disapproved", label: "Disapproved" },
] as const;

const VALID_STATUS_VALUES: ConversionStatusFilter[] = [
  "pending",
  "approved",
  "disapproved",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseStatusParam(value: string | null): ConversionStatusFilter | "all" {
  if (value && (VALID_STATUS_VALUES as string[]).includes(value)) {
    return value as ConversionStatusFilter;
  }
  return "all";
}

function parseDateParam(value: string | null): string {
  return value && DATE_PATTERN.test(value) ? value : "";
}

function ConversionsTab() {
  const [location, navigate] = useLocation();
  const searchString = useSearch();

  const [page, setPage] = useState(() => {
    const raw = parseInt(new URLSearchParams(searchString).get("page") ?? "1", 10);
    return Number.isFinite(raw) && raw >= 1 ? raw : 1;
  });
  const [status, setStatus] = useState<ConversionStatusFilter | "all">(() =>
    parseStatusParam(new URLSearchParams(searchString).get("status")),
  );
  const [fromDate, setFromDate] = useState(() =>
    parseDateParam(new URLSearchParams(searchString).get("from_date")),
  );
  const [toDate, setToDate] = useState(() =>
    parseDateParam(new URLSearchParams(searchString).get("to_date")),
  );

  const filters: ConversionFilters = {
    status: status === "all" ? undefined : status,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  };

  const { data, isLoading, isError } = useAffiliateConversions(page, filters);

  // Mirror the active page + filters into the URL so the view survives refresh,
  // bookmarking, tab switches, and Back navigation. Replace (not push) so
  // adjusting filters doesn't flood the history stack.
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (status !== "all") params.set("status", status);
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);
    const nextQuery = params.toString();
    if (nextQuery === searchString) return;
    navigate(`${location}${nextQuery ? `?${nextQuery}` : ""}`, { replace: true });
  }, [page, status, fromDate, toDate, searchString, location, navigate]);

  const hasActiveFilters = status !== "all" || fromDate !== "" || toDate !== "";

  const clearFilters = () => {
    setStatus("all");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="conversion-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as ConversionStatusFilter | "all");
              setPage(1);
            }}
          >
            <SelectTrigger id="conversion-status" className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conversion-from">From</Label>
          <Input
            id="conversion-from"
            type="date"
            className="w-[170px]"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="conversion-to">To</Label>
          <Input
            id="conversion-to"
            type="date"
            className="w-[170px]"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

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
