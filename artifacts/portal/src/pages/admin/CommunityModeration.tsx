import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pin, Star, Trash2, ChevronLeft, ChevronRight, MessageCircle, Flame, CheckCircle, XCircle, Clock } from "lucide-react";
import { adminApi, type AdminPost, type AdminComment } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type Tab = "pending" | "posts" | "comments";

export default function CommunityModeration() {
  const [tab, setTab] = useState<Tab>("pending");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const limit = 20;
  const { toast } = useToast();

  const loadPendingCount = async () => {
    try {
      const data = await adminApi.getPendingCount();
      setPendingCount(data.count);
    } catch {
    }
  };

  const loadPosts = async (p = page, statusFilter?: string) => {
    try {
      setLoading(true);
      const data = await adminApi.getPosts(p, limit, statusFilter);
      setPosts(data.posts);
      setTotal(data.total);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async (p = page) => {
    try {
      setLoading(true);
      const data = await adminApi.getComments(p, limit);
      setComments(data.comments);
      setTotal(data.total);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPendingCount();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    if (tab === "pending") loadPosts(page, "pending");
    else if (tab === "posts") loadPosts(page);
    else loadComments(page);
  }, [page, tab]);

  const handleApprove = async (post: AdminPost) => {
    try {
      await adminApi.approvePost(post.id);
      toast({ title: "Post approved", description: "The post is now live on the forum." });
      loadPosts(page, "pending");
      loadPendingCount();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReject = async (post: AdminPost) => {
    if (!confirm("Reject this post? It will be removed and the author will not see it on the forum.")) return;
    try {
      await adminApi.rejectPost(post.id);
      toast({ title: "Post rejected", description: "The post has been removed." });
      loadPosts(page, "pending");
      loadPendingCount();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handlePin = async (post: AdminPost) => {
    try {
      await adminApi.togglePin(post.id);
      toast({ title: post.isPinned ? "Post unpinned" : "Post pinned" });
      loadPosts(page, tab === "pending" ? "pending" : undefined);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleFeature = async (post: AdminPost) => {
    try {
      await adminApi.toggleFeature(post.id);
      toast({ title: post.isFeatured ? "Post unfeatured" : "Post featured" });
      loadPosts(page, tab === "pending" ? "pending" : undefined);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeletePost = async (post: AdminPost) => {
    if (!confirm("Delete this post? This will soft-delete it with admin attribution.")) return;
    try {
      await adminApi.deletePost(post.id);
      toast({ title: "Post deleted" });
      if (tab === "pending") {
        loadPosts(page, "pending");
        loadPendingCount();
      } else {
        loadPosts(page);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteComment = async (comment: AdminComment) => {
    if (!confirm("Delete this comment? This will soft-delete it with admin attribution.")) return;
    try {
      await adminApi.deleteComment(comment.id);
      toast({ title: "Comment deleted" });
      loadComments(page);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const totalPages = Math.ceil(total / limit);

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
      tab === t
        ? "bg-primary/10 text-primary border-b-2 border-primary"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content Moderation</h1>
          <p className="text-muted-foreground mt-1">
            Approve, reject, pin, feature, or remove community posts and comments
          </p>
        </div>

        <div className="flex gap-2 border-b pb-2">
          <button onClick={() => setTab("pending")} className={tabClass("pending")}>
            <Clock className="w-3.5 h-3.5" />
            Pending
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 min-w-[1.25rem] h-5 flex items-center justify-center">
                {pendingCount}
              </Badge>
            )}
          </button>
          <button onClick={() => setTab("posts")} className={tabClass("posts")}>
            Posts
          </button>
          <button onClick={() => setTab("comments")} className={tabClass("comments")}>
            Comments
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : tab === "pending" ? (
          posts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-60" />
                No posts awaiting approval.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <Card key={post.id} className="border-amber-200 bg-amber-50/30">
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge className="bg-amber-100 text-amber-800 text-xs">
                            <Clock className="w-3 h-3 mr-1" /> Pending approval
                          </Badge>
                          <span className="font-medium text-sm">{post.authorName}</span>
                          <span className="text-xs text-muted-foreground">{post.authorEmail}</span>
                          <Badge variant="outline" className="text-xs">{post.categoryName}</Badge>
                        </div>
                        {post.title && (
                          <p className="text-sm font-semibold text-foreground mb-0.5">{post.title}</p>
                        )}
                        <p className="text-sm text-foreground line-clamp-3">{post.content}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{format(new Date(post.createdAt), "MMM d, yyyy h:mm a")}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handleApprove(post)}
                          className="bg-green-600 hover:bg-green-700 text-white gap-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReject(post)}
                          className="text-destructive border-destructive/30 hover:bg-destructive/5 gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : tab === "posts" ? (
          posts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No posts found.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <Card key={post.id} className={post.isDeleted ? "opacity-50" : ""}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{post.authorName}</span>
                          <span className="text-xs text-muted-foreground">{post.authorEmail}</span>
                          <Badge variant="outline" className="text-xs">{post.categoryName}</Badge>
                          {post.isPinned && (
                            <Badge className="bg-blue-100 text-blue-700 text-xs">
                              <Pin className="w-3 h-3 mr-1" /> Pinned
                            </Badge>
                          )}
                          {post.isFeatured && (
                            <Badge className="bg-amber-100 text-amber-700 text-xs">
                              <Star className="w-3 h-3 mr-1" /> Featured
                            </Badge>
                          )}
                          {post.isDeleted && (
                            <Badge variant="destructive" className="text-xs">
                              Deleted {post.deletedBy && `by ${post.deletedBy}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground line-clamp-3">{post.content}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{format(new Date(post.createdAt), "MMM d, yyyy h:mm a")}</span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3 h-3" /> {post.commentCount}
                          </span>
                          <span className="flex items-center gap-1">
                            <Flame className="w-3 h-3" /> {post.reactionCount}
                          </span>
                        </div>
                      </div>
                      {!post.isDeleted && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant={post.isPinned ? "default" : "outline"}
                            size="sm"
                            onClick={() => handlePin(post)}
                            title={post.isPinned ? "Unpin" : "Pin"}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant={post.isFeatured ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleFeature(post)}
                            title={post.isFeatured ? "Unfeature" : "Feature"}
                          >
                            <Star className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeletePost(post)}
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : (
          comments.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No comments found.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <Card key={comment.id} className={comment.isDeleted ? "opacity-50" : ""}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{comment.authorName}</span>
                          <span className="text-xs text-muted-foreground">{comment.authorEmail}</span>
                          <Badge variant="outline" className="text-xs">Post #{comment.postId}</Badge>
                          {comment.isDeleted && (
                            <Badge variant="destructive" className="text-xs">
                              Deleted {comment.deletedBy && `by ${comment.deletedBy}`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground line-clamp-3">{comment.content}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}</span>
                          <span className="flex items-center gap-1">
                            <Flame className="w-3 h-3" /> {comment.reactionCount}
                          </span>
                        </div>
                      </div>
                      {!comment.isDeleted && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteComment(comment)}
                          title="Delete"
                          className="shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
