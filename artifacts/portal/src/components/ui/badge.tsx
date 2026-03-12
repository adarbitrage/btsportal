import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "bronze" | "silver" | "gold" | "diamond" | "success" | "warning" | "frontend" | "launchpad" | "3month" | "6month" | "1year" | "lifetime" | "locked" | "free";
}

const productLabels: Record<string, string> = {
  frontend: "Front-End",
  launchpad: "LaunchPad",
  "3month": "3-Month",
  "6month": "6-Month",
  "1year": "1-Year",
  lifetime: "Lifetime",
  free: "Free",
};

function Badge({ className, variant = "default", children, ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    outline: "text-foreground border-border",
    bronze: "border-transparent bg-[#92400e] text-white",
    silver: "border-transparent bg-[#6b7280] text-white",
    gold: "border-transparent bg-[#b45309] text-white",
    diamond: "border-transparent bg-[#0891b2] text-white",
    frontend: "border-transparent bg-[#6b7280] text-white",
    launchpad: "border-transparent bg-[#92400e] text-white",
    "3month": "border-transparent bg-[#b45309] text-white",
    "6month": "border-transparent bg-[#d97706] text-white",
    "1year": "border-transparent bg-[#0891b2] text-white",
    lifetime: "border-transparent bg-gradient-to-r from-[#7c3aed] to-[#6d28d9] text-white",
    locked: "border-transparent bg-gray-200 text-gray-500",
    free: "border-transparent bg-gray-100 text-gray-600",
    success: "border-transparent bg-green-100 text-green-800",
    warning: "border-transparent bg-yellow-100 text-yellow-800",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 uppercase tracking-wider",
        variants[variant] ?? variants.default,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Badge, productLabels };
