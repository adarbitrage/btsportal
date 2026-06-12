import { useParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCommunityPost, useToggleReaction, useUpdatePost, useDeletePost } from "@/hooks/use-community";
import { useAuth } from "@/lib/auth";
import { TierBadge } from "@/components/community/TierBadge";
import { AuthorAvatar, ProfilePopover } from "@/components/community/ProfilePopover";
import { CommentThread } from "@/components/community/CommentThread";
import { ReactionButton } from "@/components/community/reaction-button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Pin, MoreHorizontal, Pencil, Trash2, MessageSquare } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";

const EDIT_WINDOW_MS = 30 * 60 * 1000;

export default function PostDetail() {
  const params = useParams<{ postId: string }>();
  const postId = Number(params.postId);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { data: post, isLoading, error } = useCommunityPost(postId);
  const toggleReaction = useToggleReaction();
  const updatePost = useUpdatePost();
  const deletePost = useDeletePost();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <Skeleton className="h-9 w-32" />
          <div className="bg-white rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="bg-white rounded-xl border border-border p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !post) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto">
          <div className="text-center p-12 bg-white rounded-xl border border-border">
            <h2 className="text-xl font-semibold text-foreground">Post not found</h2>
            <p className="text-muted-foreground mt-2">This post could not be loaded.</p>
            <Link href="/community">
              <Button variant="outline" className="mt-4 gap-1.5">
                <ArrowLeft className="w-4 h-4" />
                Back to Community
              </Button>
            </Link>
          </div>
        </div>
      </AppLayout>
    );
  }

  const author = post.author ?? { id: 0, name: "Unknown", avatarUrl: null, highestProductSlug: null };
  const isOwnPost = author.id === user?.id;
  const canEdit = isOwnPost && Date.now() - new Date(post.createdAt).getTime() < EDIT_WINDOW_MS;

  const handleSaveEdit = () => {
    updatePost.mutate(
      { postId: post.id, body: editBody },
      { onSuccess: () => setEditing(false) }
    );
  };

  const handleDelete = () => {
    deletePost.mutate(post.id, {
      onSuccess: () => navigate("/community"),
    });
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-5">
        <Link href="/community">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Community
          </Button>
        </Link>

        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-start gap-3">
                <ProfilePopover author={author}>
                  <button className="shrink-0">
                    <AuthorAvatar author={author} size="md" />
                  </button>
                </ProfilePopover>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <ProfilePopover author={author}>
                      <button className="text-sm font-semibold text-foreground hover:text-primary cursor-pointer">
                        {author.name}
                      </button>
                    </ProfilePopover>
                    <TierBadge slug={author.highestProductSlug} />
                    {post.isPinned && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5 text-primary border-primary/30">
                        <Pin className="w-2.5 h-2.5" />Pinned
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                      {post.categoryName}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                    </span>
                    {post.isEdited && <span className="text-[10px] text-muted-foreground italic">(edited)</span>}
                  </div>
                </div>
              </div>

              {isOwnPost && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit && (
                      <DropdownMenuItem onClick={() => { setEditing(true); setEditBody(post.body); }}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                      <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {editing ? (
              <div className="space-y-3">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="min-h-[150px]"
                  maxLength={5000}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={updatePost.isPending}>
                    {updatePost.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none text-foreground/90 [&_p]:leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
              </div>
            )}

            {post.imageUrl && !editing && (
              <div className="mt-4">
                <img
                  src={post.imageUrl}
                  alt="Post attachment"
                  className="rounded-lg max-h-[500px] object-cover w-full"
                  loading="lazy"
                />
              </div>
            )}

            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-border/30">
              <ReactionButton
                hasReacted={post.hasReacted}
                reactionCount={post.reactionCount}
                onToggle={() => toggleReaction.mutate({ targetType: "post", targetId: post.id })}
                disabled={toggleReaction.isPending}
                testId={`button-react-post-${post.id}`}
              />
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MessageSquare className="w-4 h-4" />
                {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">
              {post.commentCount > 0 ? `${post.commentCount} ${post.commentCount === 1 ? "Comment" : "Comments"}` : "Comments"}
            </h2>
            <CommentThread post={post} showAll />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
