import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { TierBadge, EngagementBadge } from "./TierBadge";
import { FileText } from "lucide-react";
import type { CommunityMember } from "@/lib/community-api";

export function MemberCard({ member }: { member: CommunityMember }) {
  const initials = member.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "??";

  return (
    <Link href={`/community/members/${member.id}`}>
      <Card className="border-border/50 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer h-full">
        <CardContent className="p-5 flex flex-col items-center text-center">
          {member.avatarUrl ? (
            <img
              src={member.avatarUrl}
              alt={member.name}
              className="w-16 h-16 rounded-full object-cover mb-3"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xl mb-3">
              {initials}
            </div>
          )}
          <h3 className="font-semibold text-sm text-foreground truncate max-w-full">{member.name}</h3>
          <div className="flex items-center gap-1 mt-1.5 flex-wrap justify-center">
            <TierBadge slug={member.highestProductSlug} />
            {member.badges?.slice(0, 2).map((b) => (
              <EngagementBadge key={b} badge={b} />
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-3">
            <FileText className="w-3 h-3" />
            <span>{member.postCount} posts</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
