import { useRef, useCallback, useEffect, useState } from "react";
import { useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { QueueItemCard } from "@/components/admin/moderation/queue-item-card";
import {
  useAdminModerationQueue,
  useApproveQueueItem,
  useRejectQueueItem,
  type ModerationStatus,
  type ModerationQueueItem,
} from "@/hooks/useAdminModeration";

type Tab = ModerationStatus;

const TABS: { value: Tab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex gap-1 border-b">
      {TABS.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`px-4 py-2 text-sm font-medium transition-colors rounded-t-lg ${
            active === t.value
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardContent className="py-4 px-5">
            <div className="flex items-start gap-4">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="py-16 text-center text-muted-foreground">
        Queue is clear. Nothing to review.
      </CardContent>
    </Card>
  );
}

interface QueueListProps {
  status: Tab;
  optimisticIds: Set<number>;
  onRemoveOptimistic: (id: number) => void;
  onRestoreOptimistic: (id: number) => void;
  highlightItemId?: number;
}

function isTab(value: string | null): value is Tab {
  return value === "pending" || value === "approved" || value === "rejected";
}

function QueueList({ status, optimisticIds, onRemoveOptimistic, onRestoreOptimistic, highlightItemId }: QueueListProps) {
  const { toast } = useToast();
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useAdminModerationQueue(status);

  const approve = useApproveQueueItem();
  const reject = useRejectQueueItem();

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      });
      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  if (isLoading) return <QueueSkeleton />;

  const allItems: ModerationQueueItem[] = data?.pages.flatMap((p) => p.items) ?? [];
  const visibleItems = allItems.filter((item) => !optimisticIds.has(item.id));

  if (visibleItems.length === 0) return <EmptyState />;

  const handleApprove = (id: number) => {
    onRemoveOptimistic(id);
    approve.mutate(id, {
      onError: (err) => {
        onRestoreOptimistic(id);
        toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
      },
      onSuccess: () => {
        toast({ title: "Approved", description: "Content is now visible to everyone." });
      },
    });
  };

  const handleReject = (id: number) => {
    onRemoveOptimistic(id);
    reject.mutate(
      { id },
      {
        onError: (err) => {
          onRestoreOptimistic(id);
          toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
        },
        onSuccess: (result) => {
          const strikesMsg =
            result.strikeCount >= 3
              ? " User has been auto-suspended from posting."
              : ` Author now has ${result.strikeCount} strike${result.strikeCount === 1 ? "" : "s"}.`;
          toast({ title: "Rejected", description: `Strike added.${strikesMsg}` });
        },
      }
    );
  };

  return (
    <div className="space-y-3">
      {visibleItems.map((item) => (
        <div
          key={item.id}
          ref={(node) => {
            // Deep-link from /admin/moderation/queue?itemId=… (e.g. from the
            // AI Flagged dashboard): scroll the targeted item into view once
            // it lands in the rendered list, and ring it briefly so it's
            // obvious which row the admin came here to review.
            if (node && highlightItemId === item.id) {
              node.scrollIntoView({ block: "center", behavior: "smooth" });
            }
          }}
          className={
            highlightItemId === item.id
              ? "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow"
              : undefined
          }
          data-testid={`queue-item-${item.id}`}
        >
          <QueueItemCard
            item={item}
            showActions={status === "pending"}
            onApprove={handleApprove}
            onReject={handleReject}
            isApproving={approve.isPending}
            isRejecting={reject.isPending}
          />
        </div>
      ))}

      <div ref={sentinelRef} />

      {isFetchingNextPage && <QueueSkeleton />}
    </div>
  );
}

export default function ModerationQueue() {
  // Initialize the active tab and the deep-link target from the query string
  // (e.g. /admin/moderation/queue?status=approved&itemId=42 from the AI
  // Flagged dashboard "Review in queue" link). Keep the tab in local state
  // afterwards so manual tab clicks still work without churning the URL.
  const searchString = useSearch();
  const initialQuery = (() => {
    const params = new URLSearchParams(searchString);
    const s = params.get("status");
    const idRaw = params.get("itemId");
    const idNum = idRaw ? parseInt(idRaw, 10) : NaN;
    return {
      status: isTab(s) ? s : ("pending" as Tab),
      itemId: Number.isFinite(idNum) ? idNum : undefined,
    };
  })();

  const [tab, setTab] = useState<Tab>(initialQuery.status);
  const [highlightItemId, setHighlightItemId] = useState<number | undefined>(initialQuery.itemId);
  const [optimisticIds, setOptimisticIds] = useState<Set<number>>(new Set());

  // Clear the highlight once the admin switches tabs themselves; the
  // deep-link only meaningfully applies to the tab the link pointed at.
  useEffect(() => {
    if (highlightItemId !== undefined && tab !== initialQuery.status) {
      setHighlightItemId(undefined);
    }
  }, [tab, highlightItemId, initialQuery.status]);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setOptimisticIds(new Set());
  };

  const handleRemoveOptimistic = (id: number) => {
    setOptimisticIds((prev) => new Set([...prev, id]));
  };

  const handleRestoreOptimistic = (id: number) => {
    setOptimisticIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Moderation Queue</h1>
          <p className="text-muted-foreground mt-1">
            Review flagged posts and comments before they appear in the community.
          </p>
        </div>

        <TabBar active={tab} onChange={handleTabChange} />

        <QueueList
          key={tab}
          status={tab}
          optimisticIds={optimisticIds}
          onRemoveOptimistic={handleRemoveOptimistic}
          onRestoreOptimistic={handleRestoreOptimistic}
          highlightItemId={tab === initialQuery.status ? highlightItemId : undefined}
        />
      </div>
    </AppLayout>
  );
}
