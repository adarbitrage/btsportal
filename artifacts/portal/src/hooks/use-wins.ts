import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import {
  fetchMilestones,
  fetchWins,
  fetchWin,
  fetchMyWins,
  fetchWinStreak,
  fetchWinsSummary,
  createWin,
  updateWin,
  deleteWin,
  submitTestimonial,
  toggleWinReaction,
  uploadProofImage,
} from "@/lib/wins-api";

export function useWinMilestones() {
  return useQuery({
    queryKey: ["wins", "milestones"],
    queryFn: fetchMilestones,
  });
}

export function useWins(category?: string) {
  return useInfiniteQuery({
    queryKey: ["wins", "list", category],
    queryFn: ({ pageParam }) =>
      fetchWins({ category, cursor: pageParam as string | undefined, limit: 12 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useFeaturedWins() {
  return useQuery({
    queryKey: ["wins", "featured"],
    queryFn: () => fetchWins({ featured: true, limit: 5 }),
  });
}

export function useWin(winId: number) {
  return useQuery({
    queryKey: ["wins", "detail", winId],
    queryFn: () => fetchWin(winId),
    enabled: winId > 0,
  });
}

export function useMyWins() {
  return useQuery({
    queryKey: ["wins", "mine"],
    queryFn: fetchMyWins,
  });
}

export function useWinStreak() {
  return useQuery({
    queryKey: ["wins", "streak"],
    queryFn: fetchWinStreak,
  });
}

export function useWinsSummary() {
  return useQuery({
    queryKey: ["wins", "summary"],
    queryFn: fetchWinsSummary,
  });
}

export function useCreateWin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wins"] });
    },
  });
}

export function useUpdateWin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ winId, data }: { winId: number; data: Parameters<typeof updateWin>[1] }) =>
      updateWin(winId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wins"] });
    },
  });
}

export function useDeleteWin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteWin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wins"] });
    },
  });
}

export function useSubmitTestimonial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ winId, data }: { winId: number; data: Parameters<typeof submitTestimonial>[1] }) =>
      submitTestimonial(winId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wins"] });
    },
  });
}

export function useToggleWinReaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: toggleWinReaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wins"] });
    },
  });
}

export function useUploadProofImage() {
  return useMutation({
    mutationFn: uploadProofImage,
  });
}
