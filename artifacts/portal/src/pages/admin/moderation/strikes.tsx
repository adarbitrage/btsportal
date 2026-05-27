import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { useAdminStrikesList } from "@/lib/admin-api";
import { StrikeRow } from "@/components/admin/moderation/strike-row";

export default function StrikesList() {
  const { data, isLoading, error } = useAdminStrikesList();

  const users = data?.users ?? [];
  const bannedCount = users.filter((u) => u.isBanned).length;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Strike History</h1>
            <p className="text-muted-foreground mt-1">
              Members with active strikes — users with 3+ strikes are automatically banned from posting
            </p>
          </div>
          {bannedCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 mt-1" variant="outline">
              {bannedCount} banned
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">Loading...</div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              Failed to load strike data. Please refresh and try again.
            </CardContent>
          </Card>
        ) : users.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <ShieldAlert className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground text-sm">No members have strikes yet.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Strikes</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Banned?</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Strike</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <StrikeRow key={user.userId} user={user} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
