import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  fetchCategories,
  fetchPosts,
  fetchPost,
  createPost,
  updatePost,
  deletePost,
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  fetchPostComments,
  fetchMembers,
  fetchMember,
  fetchNotifications,
  markAllNotificationsRead,
  fetchMemberPreview,
  type CommunityPost,
  type CommunityComment,
} from "@/lib/community-api";
import { toast } from "@/hooks/use-toast";

function notifyMutationError(title: string) {
  return (error: unknown) => {
    const description =
      error instanceof Error && error.message
        ? error.message
        : "Something went wrong. Please try again.";
    toast({ variant: "destructive", title, description });
  };
}

export function useCommunityCategories() {
  return useQuery({
    queryKey: ["community", "categories"],
    queryFn: fetchCategories,
  });
}

export function useCommunityPosts(categorySlug?: string) {
  return useInfiniteQuery({
    queryKey: ["community", "posts", categorySlug],
    queryFn: ({ pageParam }) => fetchPosts({ categorySlug, cursor: pageParam as string | undefined, limit: 10 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCommunityPost(postId: number) {
  return useQuery({
    queryKey: ["community", "post", postId],
    queryFn: () => fetchPost(postId),
    enabled: postId > 0,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPost,
    onSuccess: (newPost, variables) => {
      type PageData = { posts: CommunityPost[]; nextCursor: string | null; totalCount: number };
      type InfiniteData = { pages: PageData[]; pageParams: (string | undefined)[] };

      const categories = queryClient.getQueryData<import("@/lib/community-api").CommunityCategory[]>(["community", "categories"]);
      const categorySlug = categories?.find((c) => c.id === variables.categoryId)?.slug;

      const allPostQueries = queryClient.getQueriesData<InfiniteData>({
        queryKey: ["community", "posts"],
      });

      allPostQueries.forEach(([queryKey, data]) => {
        if (!data) return;
        const keyCategory = (queryKey as unknown[])[2] as string | undefined;
        const isAll = !keyCategory || keyCategory === "all";
        const matchesCategory = categorySlug && keyCategory === categorySlug;
        if (isAll || matchesCategory) {
          queryClient.setQueryData<InfiniteData>(queryKey, {
            ...data,
            pages: data.pages.map((page, i) =>
              i === 0
                ? { ...page, posts: [newPost, ...page.posts], totalCount: (page.totalCount ?? 0) + 1 }
                : page
            ),
          });
        }
      });

      queryClient.invalidateQueries({ queryKey: ["community", "categories"] });
    },
    onError: notifyMutationError("Failed to post"),
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: string }) => updatePost(postId, { body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "post", variables.postId] });
    },
    onError: notifyMutationError("Failed to update post"),
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePost,
    onSuccess: (_data, postId) => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "post", postId] });
    },
    onError: notifyMutationError("Failed to delete post"),
  });
}

export function usePostComments(postId: number) {
  return useQuery({
    queryKey: ["community", "comments", postId],
    queryFn: () => fetchPostComments(postId),
    enabled: postId > 0,
  });
}

export function useCreateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createComment,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments", variables.postId] });
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "post", variables.postId] });
    },
    onError: notifyMutationError("Failed to add comment"),
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: number; body: string }) => updateComment(commentId, { body }),
    onSuccess: (updatedComment) => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "post", updatedComment.postId] });
    },
    onError: notifyMutationError("Failed to update comment"),
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "post"] });
    },
    onError: notifyMutationError("Failed to delete comment"),
  });
}

export function useToggleReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: toggleReaction,
    onMutate: async (variables) => {
      const snapshots: Array<[readonly unknown[], unknown]> = [];

      if (variables.targetType === "post") {
        await queryClient.cancelQueries({ queryKey: ["community", "posts"] });
        await queryClient.cancelQueries({ queryKey: ["community", "post", variables.targetId] });

        const allPostQueries = queryClient.getQueriesData<{ pages: { posts: CommunityPost[] }[] }>({
          queryKey: ["community", "posts"],
        });
        allPostQueries.forEach(([queryKey, data]) => {
          snapshots.push([queryKey, data]);
          if (data?.pages) {
            queryClient.setQueryData(queryKey, {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                posts: page.posts.map((post: CommunityPost) =>
                  post.id === variables.targetId
                    ? {
                        ...post,
                        hasReacted: !post.hasReacted,
                        reactionCount: post.hasReacted ? post.reactionCount - 1 : post.reactionCount + 1,
                      }
                    : post
                ),
              })),
            });
          }
        });

        const singlePostKey = ["community", "post", variables.targetId];
        const singlePost = queryClient.getQueryData<CommunityPost>(singlePostKey);
        if (singlePost) {
          snapshots.push([singlePostKey, singlePost]);
          queryClient.setQueryData(singlePostKey, {
            ...singlePost,
            hasReacted: !singlePost.hasReacted,
            reactionCount: singlePost.hasReacted ? singlePost.reactionCount - 1 : singlePost.reactionCount + 1,
          });
        }
      }

      if (variables.targetType === "comment") {
        const commentQueries = queryClient.getQueriesData<CommunityComment[]>({
          queryKey: ["community", "comments"],
        });
        commentQueries.forEach(([queryKey, data]) => {
          snapshots.push([queryKey, data]);
          if (Array.isArray(data)) {
            queryClient.setQueryData(queryKey, data.map((comment: CommunityComment) =>
              comment.id === variables.targetId
                ? {
                    ...comment,
                    hasReacted: !comment.hasReacted,
                    reactionCount: comment.hasReacted ? comment.reactionCount - 1 : comment.reactionCount + 1,
                  }
                : comment
            ));
          }
        });

        const allPostQueries = queryClient.getQueriesData<{ pages: { posts: CommunityPost[] }[] }>({
          queryKey: ["community", "posts"],
        });
        allPostQueries.forEach(([queryKey, data]) => {
          snapshots.push([queryKey, data]);
          if (data?.pages) {
            queryClient.setQueryData(queryKey, {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                posts: page.posts.map((post: CommunityPost) => ({
                  ...post,
                  comments: post.comments?.map((comment: CommunityComment) =>
                    comment.id === variables.targetId
                      ? {
                          ...comment,
                          hasReacted: !comment.hasReacted,
                          reactionCount: comment.hasReacted ? comment.reactionCount - 1 : comment.reactionCount + 1,
                        }
                      : comment
                  ),
                })),
              })),
            });
          }
        });
      }

      return { snapshots };
    },
    onError: (err, _variables, context) => {
      context?.snapshots.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      notifyMutationError("Failed to update reaction")(err);
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
      if (variables?.targetType === "post") {
        queryClient.invalidateQueries({ queryKey: ["community", "post", variables.targetId] });
      }
    },
  });
}

export function useCommunityMembers(params: {
  search?: string;
  tier?: string;
  badge?: string;
  sort?: string;
}) {
  return useInfiniteQuery({
    queryKey: ["community", "members", params],
    queryFn: ({ pageParam }) =>
      fetchMembers({ ...params, cursor: pageParam as string | undefined, limit: 12 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useCommunityMember(userId: number) {
  return useQuery({
    queryKey: ["community", "member", userId],
    queryFn: () => fetchMember(userId),
    enabled: userId > 0,
  });
}

export function useMemberPreview(userId: number) {
  return useQuery({
    queryKey: ["community", "member-preview", userId],
    queryFn: () => fetchMemberPreview(userId),
    enabled: userId > 0,
  });
}

export function useCommunityNotifications() {
  return useQuery({
    queryKey: ["community", "notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 60000,
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "notifications"] });
    },
    onError: notifyMutationError("Failed to mark notifications read"),
  });
}
