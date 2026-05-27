import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { format } from "date-fns";
import type { StrikeUser } from "@/lib/admin-api";

interface StrikeRowProps {
  user: StrikeUser;
}

export function StrikeRow({ user }: StrikeRowProps) {
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-sm text-foreground">{user.name}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </td>
      <td className="px-4 py-3">
        <Badge
          className={
            user.strikeCount >= 3
              ? "bg-red-100 text-red-700 border-red-200"
              : user.strikeCount === 2
              ? "bg-amber-100 text-amber-700 border-amber-200"
              : "bg-yellow-50 text-yellow-700 border-yellow-200"
          }
          variant="outline"
        >
          {user.strikeCount} {user.strikeCount === 1 ? "strike" : "strikes"}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {user.isBanned ? (
          <Badge className="bg-red-100 text-red-700 border-red-200" variant="outline">
            Banned
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">No</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {format(new Date(user.lastStrikeAt), "MMM d, yyyy")}
      </td>
      <td className="px-4 py-3">
        <Link href={`/admin/moderation/strikes/${user.userId}`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            View
          </Button>
        </Link>
      </td>
    </tr>
  );
}
