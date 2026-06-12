import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

interface ReactionButtonProps {
  hasReacted: boolean;
  reactionCount: number;
  onToggle: () => void;
  disabled?: boolean;
  size?: "sm" | "md";
  testId?: string;
}

export function ReactionButton({ hasReacted, reactionCount, onToggle, disabled, size = "md", testId }: ReactionButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      data-testid={testId}
      data-reacted={hasReacted ? "true" : "false"}
      className={cn(
        "flex items-center gap-1.5 font-medium transition-all select-none",
        size === "sm" ? "text-xs" : "text-sm",
        hasReacted
          ? "text-orange-500 hover:text-orange-600"
          : "text-muted-foreground hover:text-orange-500",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <Flame
        className={cn(
          "transition-transform",
          size === "sm" ? "w-3 h-3" : "w-4 h-4",
          hasReacted && "scale-110"
        )}
      />
      {reactionCount > 0 && <span data-testid={testId ? `${testId}-count` : undefined}>{reactionCount}</span>}
    </button>
  );
}
