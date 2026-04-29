import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useToggleReaction, useUpdatePost, useDeletePost } from "@/hooks/use-community";
import { TierBadge } from "./TierBadge";
import { AuthorAvatar, ProfilePopover } from "./ProfilePopover";
import { CommentThread } from "./CommentThread";
import { formatDistanceToNow } from "date-fns";
import { Pin, MoreHorizontal, Pencil, Trash2, Flame, MessageSquare } from "lucide-react";
import type { CommunityPost } from "@/lib/community-api";

const TRUNCATE_LENGTH = 400;

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm">$1</code>')
    .replace(/\n/g, "<br />");
}

export function PostCard({ post }: { post: CommunityPost }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const body = post.body ?? "";
  const author = post.author ?? { id: 0, name: "Unknown", avatarUrl: null, highestProductSlug: null };
  const [editBody, setEditBody] = useState(body);
  const { user } = useAuth();
  const toggleReaction = useToggleReaction();
  const updatePost = useUpdatePost();
  const deletePost = useDeletePost();

  const isLong = body.length > TRUNCATE_LENGTH;
  const displayBody = expanded || !isLong ? body : body.slice(0, TRUNCATE_LENGTH) + "...";
  const isOwnPost = author.id === user?.id;
  const canEdit = isOwnPost && Date.now() - new Date(post.createdAt).getTime() < 15 * 60 * 1000;

  const handleSaveEdit = () => {
    updatePost.mutate(
      { postId: post.id, body: editBody },
      {
        onSuccess: () => setEditing(false),
      }
    );
  };

  if (post.isDeleted) {
    return (
      <Card className="border-border/50 bg-muted/30">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground italic">[This post has been removed]</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-border/50 hover:shadow-sm transition-shadow", post.isPinned && "border-primary/30 bg-primary/[0.02]")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
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
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">{post.categoryName}</Badge>
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
                  <DropdownMenuItem onClick={() => { setEditing(true); setEditBody(body); }}>
                    <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => deletePost.mutate(post.id)} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-3">
          {editing ? (
            <div className="space-y-3">
              <Textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="min-h-[100px]"
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
            <>
              <div
                className="text-sm text-foreground/90 leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(displayBody) }}
              />
              {isLong && !expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="text-sm text-primary hover:text-primary/80 font-medium mt-1 transition-colors"
                >
                  Read more
                </button>
              )}
            </>
          )}
        </div>

        {post.imageUrl && (
          <div className="mt-3">
            <img
              src={post.imageUrl}
              alt="Post attachment"
              className="rounded-lg max-h-96 object-cover w-full"
              loading="lazy"
            />
          </div>
        )}

        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/30">
          <button
            onClick={() => toggleReaction.mutate({ targetType: "post", targetId: post.id })}
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium transition-all",
              post.hasReacted
                ? "text-orange-500 hover:text-orange-600"
                : "text-muted-foreground hover:text-orange-500"
            )}
          >
            <Flame className={cn("w-4 h-4 transition-transform", post.hasReacted && "scale-110")} />
            {post.reactionCount > 0 && <span>{post.reactionCount}</span>}
            🔥
          </button>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MessageSquare className="w-4 h-4" />
            {post.commentCount}
          </span>
        </div>

        <div className="mt-3">
          <CommentThread post={post} />
        </div>
      </CardContent>
    </Card>
  );
}
