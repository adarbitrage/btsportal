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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "categories"] });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: string }) => updatePost(postId, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
    },
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
    },
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: number; body: string }) => updateComment(commentId, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
    },
  });
}

export function useToggleReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: toggleReaction,
    onMutate: async (variables) => {
      if (variables.targetType === "post") {
        await queryClient.cancelQueries({ queryKey: ["community", "posts"] });
        const allPostQueries = queryClient.getQueriesData<{ pages: { posts: CommunityPost[] }[] }>({
          queryKey: ["community", "posts"],
        });
        allPostQueries.forEach(([queryKey, data]) => {
          if (data?.pages) {
            const updated = {
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
            };
            queryClient.setQueryData(queryKey, updated);
          }
        });
      }
      if (variables.targetType === "comment") {
        const commentQueries = queryClient.getQueriesData<CommunityComment[]>({
          queryKey: ["community", "comments"],
        });
        commentQueries.forEach(([queryKey, data]) => {
          if (Array.isArray(data)) {
            const updated = data.map((comment: CommunityComment) =>
              comment.id === variables.targetId
                ? {
                    ...comment,
                    hasReacted: !comment.hasReacted,
                    reactionCount: comment.hasReacted ? comment.reactionCount - 1 : comment.reactionCount + 1,
                  }
                : comment
            );
            queryClient.setQueryData(queryKey, updated);
          }
        });

        const allPostQueries = queryClient.getQueriesData<{ pages: { posts: CommunityPost[] }[] }>({
          queryKey: ["community", "posts"],
        });
        allPostQueries.forEach(([queryKey, data]) => {
          if (data?.pages) {
            const updated = {
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
            };
            queryClient.setQueryData(queryKey, updated);
          }
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
      queryClient.invalidateQueries({ queryKey: ["community", "comments"] });
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
  });
}
