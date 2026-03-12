import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, Search, RefreshCw, Upload } from "lucide-react";
import { fetchGhlContacts, syncMember, bulkSync } from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function GhlContacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ghl-contacts", search, filter, page],
    queryFn: () => fetchGhlContacts({
      search: search || undefined,
      filter: filter !== "all" ? filter : undefined,
      page,
      limit: 25,
    }),
  });

  const syncMutation = useMutation({
    mutationFn: syncMember,
    onSuccess: () => {
      toast({ title: "Sync job created" });
      queryClient.invalidateQueries({ queryKey: ["ghl-contacts"] });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: bulkSync,
    onSuccess: (data: any) => {
      toast({ title: "Bulk sync started", description: `${data.jobCount} jobs created` });
      setShowBulkDialog(false);
      queryClient.invalidateQueries({ queryKey: ["ghl-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["ghl-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk sync failed", description: err.message, variant: "destructive" });
    },
  });

  const contacts = data?.contacts || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">GHL Contact Mapping</h1>
            <p className="text-muted-foreground mt-1">View portal members and their GHL contact sync status.</p>
          </div>
          <Button onClick={() => setShowBulkDialog(true)} variant="outline">
            <Upload className="w-4 h-4 mr-2" />
            Bulk Re-Sync All
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Contact Mapping
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-2">
                {[
                  { value: "all", label: "All" },
                  { value: "synced", label: "Synced" },
                  { value: "not_synced", label: "Not Synced" },
                ].map(opt => (
                  <Button
                    key={opt.value}
                    variant={filter === opt.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setFilter(opt.value); setPage(1); }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : !contacts.length ? (
              <div className="text-center py-8 text-muted-foreground">No contacts found.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>GHL Contact ID</TableHead>
                        <TableHead>Last Sync</TableHead>
                        <TableHead>Member Since</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.map((contact: any) => (
                        <TableRow key={contact.id}>
                          <TableCell className="font-medium">{contact.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{contact.email}</TableCell>
                          <TableCell>
                            {contact.ghlContactId ? (
                              <code className="text-xs bg-secondary px-2 py-1 rounded">{contact.ghlContactId}</code>
                            ) : (
                              <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50">
                                Not synced
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {contact.lastSyncDate
                              ? format(new Date(contact.lastSyncDate), "MMM d, h:mm a")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {contact.memberSince
                              ? format(new Date(contact.memberSince), "MMM d, yyyy")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={syncMutation.isPending}
                              onClick={() => syncMutation.mutate(contact.id)}
                            >
                              <RefreshCw className="w-3.5 h-3.5 mr-1" />
                              Sync Now
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Showing {contacts.length} of {pagination.total} members
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground flex items-center px-2">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Re-Sync All Members</DialogTitle>
            <DialogDescription>
              This will create sync jobs for every member in the portal. This is useful for initial setup or after changing GHL configuration. This may take some time depending on the number of members.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkMutation.mutate()}
              disabled={bulkMutation.isPending}
            >
              {bulkMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Start Bulk Sync
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
