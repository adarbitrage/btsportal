import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommunityMember } from "@/hooks/use-community";
import { TierBadge, EngagementBadge } from "@/components/community/TierBadge";
import { PostCard } from "@/components/community/PostCard";
import { FileText, MessageSquare, Flame, CalendarDays, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format } from "date-fns";

export default function MemberProfile() {
  const params = useParams<{ userId: string }>();
  const userId = Number(params.userId);
  const { data: member, isLoading, error } = useCommunityMember(userId);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="bg-white rounded-xl border border-border p-8">
            <div className="flex items-center gap-6">
              <Skeleton className="w-20 h-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !member) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto">
          <div className="text-center p-12 bg-white rounded-xl border border-border">
            <h2 className="text-xl font-semibold text-foreground">Member not found</h2>
            <p className="text-muted-foreground mt-2">This profile could not be loaded.</p>
            <Link href="/community/members">
              <Button variant="outline" className="mt-4 gap-1.5">
                <ArrowLeft className="w-4 h-4" />
                Back to Members
              </Button>
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const initials = member.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "??";

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <Link href="/community/members">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back to Members
          </Button>
        </Link>

        <Card className="border-border/50">
          <CardContent className="p-8">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt={member.name}
                  className="w-20 h-20 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-2xl shrink-0">
                  {initials}
                </div>
              )}
              <div className="text-center sm:text-left">
                <h1 className="text-2xl font-bold text-foreground">{member.name}</h1>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap justify-center sm:justify-start">
                  <TierBadge slug={member.highestProductSlug} />
                  {member.badges?.map((b) => (
                    <EngagementBadge key={b} badge={b} />
                  ))}
                </div>
                {member.bio && (
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-md">
                    {member.bio}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 justify-center sm:justify-start">
                  <CalendarDays className="w-3 h-3" />
                  Joined {format(new Date(member.joinedAt), "MMMM yyyy")}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">{member.postCount}</p>
              <p className="text-xs text-muted-foreground">Posts</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <MessageSquare className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">{member.commentCount}</p>
              <p className="text-xs text-muted-foreground">Comments</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Flame className="w-4 h-4 text-orange-500" />
              </div>
              <p className="text-2xl font-bold text-foreground">{member.reactionsReceived}</p>
              <p className="text-xs text-muted-foreground">Reactions</p>
            </CardContent>
          </Card>
        </div>

        {member.recentPosts && member.recentPosts.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Recent Posts</h2>
            <div className="space-y-4">
              {member.recentPosts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          </div>
        )}

        {(!member.recentPosts || member.recentPosts.length === 0) && (
          <div className="text-center py-8 bg-white rounded-xl border border-border">
            <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No posts yet</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
