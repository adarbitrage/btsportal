import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCommunityCategories, useCommunityPosts } from "@/hooks/use-community";
import { PostCard } from "@/components/community/PostCard";
import { PostComposer } from "@/components/community/post-composer";
import { CommunityApiError } from "@/lib/community-api";
import { Users, Loader2, Lock } from "lucide-react";
import { Link } from "wouter";

function PaywallCard() {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="py-16 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-8 h-8 text-primary/60" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Community Access Required</h2>
        <p className="text-muted-foreground text-sm max-w-sm mb-6">
          Community access requires 3-Month Mentorship or higher. Upgrade your plan to join the conversation.
        </p>
        <Link href="/plans">
          <Button className="shadow-sm">View Plans & Upgrade</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function CommunityFeed() {
  const [activeCategory, setActiveCategory] = useState("all");
  const { data: categories, isLoading: categoriesLoading } = useCommunityCategories();
  const {
    data: postsData,
    isLoading: postsLoading,
    error: postsError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCommunityPosts(activeCategory);

  const is403 = postsError instanceof CommunityApiError && postsError.status === 403;

  const allPosts = postsData?.pages.flatMap((p) => p.posts) ?? [];
  const pinnedPosts = allPosts.filter((p) => p.isPinned);
  const regularPosts = allPosts.filter((p) => !p.isPinned);

  const selectedCategory = categories?.find((c) => c.slug === activeCategory);

  return (
    <AppLayout>
      <div className="space-y-5 max-w-3xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold text-foreground">Community</h1>
            </div>
            <p className="text-muted-foreground">
              Connect, share, and grow with fellow members.
            </p>
          </div>
          <Link href="/community/members">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Users className="w-4 h-4" />
              Members
            </Button>
          </Link>
        </div>

        {is403 ? (
          <PaywallCard />
        ) : (
          <>
            <PostComposer defaultCategoryId={selectedCategory?.id} />

            <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
              <button
                onClick={() => setActiveCategory("all")}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                  activeCategory === "all"
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                All
              </button>
              {categoriesLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="w-20 h-8 rounded-full" />
                  ))
                : categories?.map((cat) => (
                    <button
                      key={cat.slug}
                      onClick={() => setActiveCategory(cat.slug)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5",
                        activeCategory === cat.slug
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      {cat.name}
                      <span className={cn(
                        "text-[10px] px-1.5 py-0 rounded-full",
                        activeCategory === cat.slug ? "bg-white/20" : "bg-secondary"
                      )}>
                        {cat.postCount}
                      </span>
                    </button>
                  ))}
            </div>

            {postsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-border p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-full" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : allPosts.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-border">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-primary/60" />
                </div>
                <h3 className="font-semibold text-lg text-foreground mb-1">No posts yet</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Be the first to post — start a conversation!
                </p>
                <Button
                  onClick={() => {
                    const composerEl = document.querySelector<HTMLElement>("[data-composer-prompt]");
                    composerEl?.click();
                  }}
                  className="gap-1.5"
                >
                  Be the first to post
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {pinnedPosts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
                {regularPosts.map((post) => (
                  <PostCard key={post.id} post={post} />
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
                    "Load more posts"
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
