import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Send,
  FileText,
  Link2,
  FolderArchive,
} from "lucide-react";

/**
 * TEST-ONLY UI PREVIEW — Submission cards for Compliance & Concierge.
 *
 * This is a static design preview fed entirely by the hardcoded SAMPLE data
 * below. It is NOT connected to any backend, reads/writes no real ticket data,
 * and exists only so the design can be eyeballed and signed off before any
 * TicketDesk wiring lands. It is self-contained in this one file and trivially
 * removable — delete this file and the preview disappears.
 *
 * It covers all four required states:
 *   - Compliance — Current Submission card + Past Submission card
 *   - Concierge  — Current Submission card + Past Submission card
 * plus the "action needed" current-submission treatment and the reply/details
 * popup that opens from the Past cards.
 */

// ── Inline badges (mirrors the portal's success/warning Badge styling so the
// preview matches production without depending on the sandbox Badge variants) ──
function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "warning";
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-transparent bg-green-100 text-green-800"
      : "border-transparent bg-yellow-100 text-yellow-800";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

// ── Sample data (hardcoded — connected to nothing) ──

type Reply = { id: number; date: string; body: string; latest?: boolean };

const COMPLIANCE_REPLIES: Reply[] = [
  {
    id: 2,
    date: "Mar 12, 2026",
    body:
      "Approved ✅ — your revised hero image and headline clear our compliance review. You're good to run this creative on all approved traffic sources. Nice work tightening up the income claim.",
    latest: true,
  },
  {
    id: 1,
    date: "Mar 10, 2026",
    body:
      "Thanks for the submission. The headline \"Make $10k in your first week\" needs a softer, results-not-typical framing before we can approve. Please revise and resubmit the hero image.",
  },
];

const CONCIERGE_REPLIES: Reply[] = [
  {
    id: 2,
    date: "Mar 14, 2026",
    body:
      "All done! 🎉 We've delivered your 25 split-test variations and wired them into DIYTrax™. Everything is in the shared Drive folder under /VitalityBoost/Splits. Let us know if you'd like any tweaks.",
    latest: true,
  },
  {
    id: 1,
    date: "Mar 13, 2026",
    body:
      "Got your assets — thanks for sharing the Drive link. We've started building the variations and will have them back to you within 72 hours.",
  },
];

// ── Reply / details popup (shared shape for both Compliance & Concierge) ──
function RepliesDialog({
  open,
  onOpenChange,
  title,
  description,
  team,
  teamIcon,
  replies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  team: string;
  teamIcon: React.ReactNode;
  replies: Reply[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {replies.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-4 ${
                m.latest ? "border-primary/30 bg-primary/[0.03]" : "border-border bg-muted/20"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 text-xs">
                {teamIcon}
                <span className="font-medium text-foreground">{team}</span>
                {m.latest && replies.length > 1 && (
                  <span className="rounded bg-secondary px-1.5 py-0 text-[10px] text-secondary-foreground">
                    Latest
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">{m.date}</span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Compliance cards ──

function ComplianceCurrentCard({ actionNeeded }: { actionNeeded?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 sm:p-5">
        {actionNeeded && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Action needed — reply requested
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone="warning">Under review</StatusBadge>
              <span className="text-xs font-mono text-muted-foreground">BTS-001482</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">VitalityBoost — Jump Page Creative</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Submitted Mar 11, 2026</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip>
                <FileText className="mr-1 h-3 w-3" /> 4 files
              </Chip>
            </div>
          </div>
          <Button variant={actionNeeded ? "default" : "outline"} size="sm" className="shrink-0">
            {actionNeeded ? "View & Reply" : "View Submission"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompliancePastCard({ onView }: { onView: () => void }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone="success">
                <CheckCircle2 className="h-3 w-3" /> Complete
              </StatusBadge>
              <span className="text-xs font-mono text-muted-foreground">BTS-001451</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">SlimCore — Banner Set</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Submitted Mar 9, 2026</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip>
                <FileText className="mr-1 h-3 w-3" /> 6 files
              </Chip>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onView}>
            View Results
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Concierge cards ──

function ConciergeCurrentCard({ actionNeeded }: { actionNeeded?: boolean }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 sm:p-5">
        {actionNeeded && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Action needed — the team needs your input
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone="warning">In progress</StatusBadge>
              <span className="text-xs font-mono text-muted-foreground">BTS-001490</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">VitalityBoost</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Submitted Mar 13, 2026</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip>
                Create Split Tests With MetricMover™ (25 Variations)
              </Chip>
              <Chip>970x250</Chip>
              <Chip>300x250</Chip>
              <Chip>
                <Link2 className="mr-1 h-3 w-3" /> Drive link shared
              </Chip>
              <Chip>
                <FolderArchive className="mr-1 h-3 w-3" /> 1 zip
              </Chip>
            </div>
          </div>
          <Button variant={actionNeeded ? "default" : "outline"} size="sm" className="shrink-0">
            {actionNeeded ? "View & Reply" : "View Request"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConciergePastCard({ onView }: { onView: () => void }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge tone="success">
                <CheckCircle2 className="h-3 w-3" /> Complete
              </StatusBadge>
              <span className="text-xs font-mono text-muted-foreground">BTS-001460</span>
            </div>
            <h3 className="font-semibold text-foreground truncate">KetoLaunch</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Submitted Mar 8, 2026</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip>Create Advertorial Headlines (10 max)</Chip>
              <Chip>Set Up Initial DIYTrax™ Campaign</Chip>
              <Chip>
                <Link2 className="mr-1 h-3 w-3" /> Drive link shared
              </Chip>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onView}>
            View Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Preview surface ──
export default function SubmissionPreviewCards() {
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [conciergeOpen, setConciergeOpen] = useState(false);

  return (
    <div className="min-h-screen bg-muted/30 p-6 sm:p-10">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>UI preview — test only.</strong> Hardcoded sample data, connected to
          nothing. For design sign-off before any TicketDesk wiring. Safe to delete.
        </div>

        {/* Compliance */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Compliance Review</h2>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current submission
            </p>
            <div className="space-y-3">
              <ComplianceCurrentCard />
              <ComplianceCurrentCard actionNeeded />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Past submission
            </p>
            <CompliancePastCard onView={() => setComplianceOpen(true)} />
          </div>
        </section>

        {/* Concierge */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">BTS Concierge™</h2>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current submission
            </p>
            <div className="space-y-3">
              <ConciergeCurrentCard />
              <ConciergeCurrentCard actionNeeded />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Past submission
            </p>
            <ConciergePastCard onView={() => setConciergeOpen(true)} />
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground">
          Tip: click <span className="font-medium">View Results</span> /{" "}
          <span className="font-medium">View Details</span> on a past card to see the
          reply popup.
        </p>
      </div>

      <RepliesDialog
        open={complianceOpen}
        onOpenChange={setComplianceOpen}
        title="Review Results — SlimCore — Banner Set"
        description="The compliance team's response to your submission."
        team="Compliance Team"
        teamIcon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
        replies={COMPLIANCE_REPLIES}
      />
      <RepliesDialog
        open={conciergeOpen}
        onOpenChange={setConciergeOpen}
        title="Request Details — KetoLaunch"
        description="The BTS Concierge™ team's response to your request."
        team="BTS Concierge™ Team"
        teamIcon={<Sparkles className="h-3.5 w-3.5 text-primary" />}
        replies={CONCIERGE_REPLIES}
      />
    </div>
  );
}
