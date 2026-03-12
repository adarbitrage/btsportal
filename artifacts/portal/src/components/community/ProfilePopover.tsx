import { useState, useCallback } from "react";
import { Link } from "wouter";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TierBadge, EngagementBadge } from "./TierBadge";
import { useMemberPreview } from "@/hooks/use-community";
import { MessageSquare, Flame, FileText } from "lucide-react";
import type { CommunityAuthor } from "@/lib/community-api";

function AuthorAvatar({ author, size = "sm" }: { author: CommunityAuthor; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-16 h-16 text-xl" };
  const initials = author.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "??";

  if (author.avatarUrl) {
    return <img src={author.avatarUrl} alt={author.name} className={`${sizeClasses[size]} rounded-full object-cover`} />;
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0`}>
      {initials}
    </div>
  );
}

export function ProfilePopover({ author, children }: { author: CommunityAuthor; children: React.ReactNode }) {
  const [shouldFetch, setShouldFetch] = useState(false);
  const { data: member, isLoading } = useMemberPreview(shouldFetch ? author.id : 0);

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) setShouldFetch(true);
  }, []);

  return (
    <HoverCard openDelay={300} closeDelay={100} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-72 p-4" align="start">
        {isLoading ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        ) : member ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AuthorAvatar author={author} size="md" />
              <div>
                <Link href={`/community/members/${author.id}`}>
                  <span className="font-semibold text-sm text-foreground hover:text-primary cursor-pointer">
                    {author.name}
                  </span>
                </Link>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <TierBadge slug={author.highestProductSlug} />
                  {author.badges?.slice(0, 2).map((b) => (
                    <EngagementBadge key={b} badge={b} />
                  ))}
                </div>
              </div>
            </div>
            {member.bio && <p className="text-xs text-muted-foreground leading-relaxed">{member.bio}</p>}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{member.postCount} posts</span>
              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{member.commentCount} comments</span>
              <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{member.reactionsReceived} 🔥</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Could not load profile</p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

export { AuthorAvatar };
