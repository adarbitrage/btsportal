import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommunityMembers } from "@/hooks/use-community";
import { MemberCard } from "@/components/community/MemberCard";
import { Search, Users, ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function MemberDirectory() {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [badge, setBadge] = useState("");
  const [sort, setSort] = useState("most_active");

  const {
    data: membersData,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCommunityMembers({ search: search || undefined, tier: tier || undefined, badge: badge || undefined, sort });

  const allMembers = membersData?.pages.flatMap((p) => p.members) ?? [];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/community">
              <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground">
                <ArrowLeft className="w-4 h-4" />
                Community
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-1">Members</h1>
              <p className="text-muted-foreground">Browse and discover community members.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="pl-9"
            />
          </div>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="px-3 py-2 border rounded-md bg-white text-sm min-w-[140px]"
          >
            <option value="">All Tiers</option>
            <option value="lifetime">Lifetime</option>
            <option value="1year">1-Year</option>
            <option value="6month">6-Month</option>
            <option value="3month">3-Month</option>
            <option value="launchpad">LaunchPad</option>
            <option value="frontend">Front-End</option>
            <option value="free">Free</option>
          </select>
          <select
            value={badge}
            onChange={(e) => setBadge(e.target.value)}
            className="px-3 py-2 border rounded-md bg-white text-sm min-w-[140px]"
          >
            <option value="">All Badges</option>
            <option value="first_post">First Post</option>
            <option value="helpful">Helpful</option>
            <option value="prolific">Prolific</option>
            <option value="conversation_starter">Conversation Starter</option>
            <option value="top_contributor">Top Contributor</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-3 py-2 border rounded-md bg-white text-sm min-w-[140px]"
          >
            <option value="most_active">Most Active</option>
            <option value="newest">Newest</option>
            <option value="alphabetical">A–Z</option>
          </select>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-5 flex flex-col items-center">
                <Skeleton className="w-16 h-16 rounded-full mb-3" />
                <Skeleton className="h-4 w-24 mb-1.5" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : allMembers.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-border">
            <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="font-semibold text-lg text-foreground mb-1">No members found</h3>
            <p className="text-muted-foreground text-sm">
              {search ? "Try a different search term." : "No community members yet."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {allMembers.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </div>
        )}

        {hasNextPage && (
          <div className="flex justify-center pt-2 pb-4">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="gap-2"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more members"
              )}
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
