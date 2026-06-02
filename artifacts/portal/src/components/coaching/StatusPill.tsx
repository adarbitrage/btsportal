import { type MenteeStatus } from "@workspace/api-client-react";

interface StatusPillProps {
  status: MenteeStatus;
  className?: string;
}

const STATUS_CONFIG: Record<MenteeStatus, { label: string; classes: string }> = {
  active:    { label: "Active",    classes: "bg-green-100 text-green-800 border-green-200" },
  stuck:     { label: "Stuck",     classes: "bg-amber-100 text-amber-800 border-amber-200" },
  dormant:   { label: "Dormant",   classes: "bg-gray-100 text-gray-600 border-gray-200" },
  new:       { label: "New",       classes: "bg-blue-100 text-blue-800 border-blue-200" },
  completed: { label: "Completed", classes: "bg-purple-100 text-purple-800 border-purple-200" },
};

export function StatusPill({ status, className = "" }: StatusPillProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.dormant;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  );
}
