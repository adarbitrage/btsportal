import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShoppingBag,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type YseOrder = Awaited<
  ReturnType<typeof adminPanelApi.getYseOrders>
>["orders"][number];

export default function YseOrders() {
  const [orders, setOrders] = useState<YseOrder[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = async (page = 1) => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getYseOrders({
        page,
        search: search.trim() || undefined,
      });
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => load(1);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1
            className="text-2xl font-bold flex items-center gap-2"
            data-testid="heading-yse-orders"
          >
            <ShoppingBag className="w-6 h-6" /> YSE Order History
          </h1>
          <p className="text-muted-foreground mt-1">
            Grants provisioned through the YSE integration, most recent first.
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search by order ID or email..."
                  className="pl-10"
                  data-testid="input-yse-search"
                />
              </div>
              <Button onClick={handleSearch} data-testid="button-yse-search">
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading...
              </div>
            ) : orders.length === 0 ? (
              <div
                className="p-8 text-center text-muted-foreground"
                data-testid="text-yse-empty"
              >
                No YSE orders found
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-4 text-xs font-medium text-muted-foreground">
                      Order ID
                    </th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">
                      Customer
                    </th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">
                      Products
                    </th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">
                      Granted
                    </th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">
                      New user?
                    </th>
                    <th className="p-4 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.map((o) => (
                    <tr
                      key={`${o.externalSource}:${o.externalOrderId}:${o.userId}`}
                      className="hover:bg-muted/30 transition-colors"
                      data-testid={`row-yse-order-${o.externalOrderId}`}
                    >
                      <td className="p-4 text-sm font-mono">
                        {o.externalOrderId}
                      </td>
                      <td className="p-4 text-sm">
                        <div className="font-medium">
                          {o.userName || "—"}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {o.userEmail}
                        </div>
                      </td>
                      <td className="p-4 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {o.products.map((p) => (
                            <Badge
                              key={p.slug || p.name}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {p.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {o.grantedAt
                          ? format(new Date(o.grantedAt), "MMM d, yyyy h:mm a")
                          : "—"}
                      </td>
                      <td className="p-4">
                        {o.wasNewUser ? (
                          <Badge className="text-[10px]">New</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            Existing
                          </Badge>
                        )}
                      </td>
                      <td className="p-4">
                        <Link href={`/admin/members/${o.userId}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-member-${o.userId}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} (
              {pagination.total} total)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => load(pagination.page - 1)}
                data-testid="button-yse-prev"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => load(pagination.page + 1)}
                data-testid="button-yse-next"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
