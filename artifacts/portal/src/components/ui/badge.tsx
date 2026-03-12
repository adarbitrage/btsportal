import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "bronze" | "silver" | "gold" | "diamond" | "success" | "warning";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    outline: "text-foreground border-border",
    bronze: "border-transparent bg-[var(--color-tier-bronze)] text-white",
    silver: "border-transparent bg-[var(--color-tier-silver)] text-white",
    gold: "border-transparent bg-[var(--color-tier-gold)] text-white",
    diamond: "border-transparent bg-[var(--color-tier-diamond)] text-white",
    success: "border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
    warning: "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 uppercase tracking-wider",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
