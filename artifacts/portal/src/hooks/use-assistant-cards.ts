import { useQuery } from "@tanstack/react-query";
import { fetchAssistantCards } from "@/lib/assistant-cards-api";

export function useAssistantCards() {
  return useQuery({
    queryKey: ["assistant", "cards"],
    queryFn: fetchAssistantCards,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
