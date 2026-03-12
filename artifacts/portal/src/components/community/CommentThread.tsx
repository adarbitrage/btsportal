import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useCreateComment, useUpdateComment, useDeleteComment, useToggleReaction, usePostComments } from "@/hooks/use-community";
import { TierBadge } from "./TierBadge";
import { AuthorAvatar, ProfilePopover } from "./ProfilePopover";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Pencil, Trash2, Flame, Reply, MessageSquare, Send } from "lucide-react";
import type { CommunityComment, CommunityPost } from "@/lib/community-api";

interface CommentThreadProps {
  post: CommunityPost;
}

export function CommentThread({ post }: CommentThreadProps) {
  const [showAll, setShowAll] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<{ commentId: number; name: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const { user } = useAuth();
  const { data: allComments } = usePostComments(showAll ? post.id : 0);
  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();
  const toggleReaction = useToggleReaction();

  const previewComments = post.comments?.slice(0, 3) ?? [];
  const displayComments = showAll && allComments ? allComments : previewComments;
  const hasMore = post.commentCount > 3 && !showAll;

  const handleSubmit = () => {
    const body = newComment.trim();
    if (!body) return;

    createComment.mutate(
      {
        postId: post.id,
        body,
        parentCommentId: replyTo?.commentId,
      },
      {
        onSuccess: () => {
          setNewComment("");
          setReplyTo(null);
        },
      }
    );
  };

  const handleEdit = (comment: CommunityComment) => {
    setEditingId(comment.id);
    setEditBody(comment.body);
  };

  const handleSaveEdit = (commentId: number) => {
    updateComment.mutate(
      { commentId, body: editBody },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditBody("");
        },
      }
    );
  };

  const canEditComment = (comment: CommunityComment) => {
    if (comment.author.id !== user?.id) return false;
    const createdAt = new Date(comment.createdAt).getTime();
    return Date.now() - createdAt < 5 * 60 * 1000;
  };

  const canDeleteComment = (comment: CommunityComment) => comment.author.id === user?.id;

  return (
    <div className="border-t border-border/50 pt-3">
      {displayComments.map((comment) => (
        <div key={comment.id} className="flex gap-2.5 mb-3 last:mb-0">
          <ProfilePopover author={comment.author}>
            <button className="shrink-0">
              <AuthorAvatar author={comment.author} size="sm" />
            </button>
          </ProfilePopover>
          <div className="flex-1 min-w-0">
            {comment.isDeleted ? (
              <p className="text-sm text-muted-foreground italic">[This comment has been removed]</p>
            ) : editingId === comment.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="text-sm min-h-[60px]"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => handleSaveEdit(comment.id)} disabled={updateComment.isPending}>Save</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ProfilePopover author={comment.author}>
                    <button className="text-xs font-semibold text-foreground hover:text-primary cursor-pointer">
                      {comment.author.name}
                    </button>
                  </ProfilePopover>
                  <TierBadge slug={comment.author.highestProductSlug} />
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                  </span>
                  {comment.isEdited && <span className="text-[10px] text-muted-foreground italic">(edited)</span>}
                </div>
                {comment.replyToName && (
                  <p className="text-[11px] text-primary/70 mb-0.5">Replying to @{comment.replyToName}</p>
                )}
                <p className="text-sm text-foreground/90 mt-0.5 break-words">{comment.body}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <button
                    onClick={() => toggleReaction.mutate({ targetType: "comment", targetId: comment.id })}
                    className={cn(
                      "flex items-center gap-1 text-xs transition-colors",
                      comment.hasReacted ? "text-orange-500" : "text-muted-foreground hover:text-orange-500"
                    )}
                  >
                    <Flame className="w-3 h-3" />
                    {comment.reactionCount > 0 && comment.reactionCount}
                  </button>
                  <button
                    onClick={() => setReplyTo({ commentId: comment.id, name: comment.author.name })}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Reply className="w-3 h-3" />
                    Reply
                  </button>
                  {(canEditComment(comment) || canDeleteComment(comment)) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {canEditComment(comment) && (
                          <DropdownMenuItem onClick={() => handleEdit(comment)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />Edit
                          </DropdownMenuItem>
                        )}
                        {canDeleteComment(comment) && (
                          <DropdownMenuItem
                            onClick={() => deleteComment.mutate(comment.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ))}

      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium mt-2 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          View all {post.commentCount} comments
        </button>
      )}

      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 relative">
          {replyTo && (
            <div className="flex items-center gap-1 mb-1.5">
              <span className="text-[11px] text-primary/70">Replying to @{replyTo.name}</span>
              <button
                onClick={() => setReplyTo(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="text-sm h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSubmit}
              disabled={!newComment.trim() || createComment.isPending}
              className="h-8 px-2"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
