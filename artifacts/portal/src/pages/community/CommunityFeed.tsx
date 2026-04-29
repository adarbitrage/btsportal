import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCommunityCategories, useCommunityPosts } from "@/hooks/use-community";
import { PostCard } from "@/components/community/PostCard";
import { NewPostModal } from "@/components/community/NewPostModal";
import { PlusCircle, Users, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function CommunityFeed() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [showNewPost, setShowNewPost] = useState(false);
  const { data: categories, isLoading: categoriesLoading } = useCommunityCategories();
  const {
    data: postsData,
    isLoading: postsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCommunityPosts(activeCategory);

  const allPosts = postsData?.pages.flatMap((p) => p.posts) ?? [];
  const pinnedPosts = allPosts.filter((p) => p.isPinned);
  const regularPosts = allPosts.filter((p) => !p.isPinned);

  const selectedCategory = categories?.find((c) => c.slug === activeCategory);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">Community</h1>
            <p className="text-muted-foreground">
              Connect, share, and grow with fellow members.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/community/members">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Users className="w-4 h-4" />
                Members
              </Button>
            </Link>
            <Button onClick={() => setShowNewPost(true)} className="gap-1.5 shadow-md">
              <PlusCircle className="w-4 h-4" />
              New Post
            </Button>
          </div>
        </div>

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
              Be the first to start a conversation!
            </p>
            <Button onClick={() => setShowNewPost(true)} className="gap-1.5">
              <PlusCircle className="w-4 h-4" />
              Create Post
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
      </div>

      <NewPostModal
        open={showNewPost}
        onOpenChange={setShowNewPost}
        defaultCategoryId={selectedCategory?.id}
      />
    </AppLayout>
  );
}
