import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ChevronDown, ClipboardList, ShieldCheck } from "lucide-react";
import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_PHASE_LABELS,
  type CampaignNetwork,
  type CampaignPhase,
  type CampaignStep,
} from "@workspace/campaign-roadmap";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const NETWORK_LABELS: Record<CampaignNetwork, string> = {
  "media-mavens": "Media Mavens",
  clickbank: "ClickBank",
};

/**
 * Display-only phase label: the shared CAMPAIGN_PHASE_LABELS embed numbers
 * ("Phase 1 — Build") for the chat spine; the checklist shows just the name.
 */
export function phaseDisplayLabel(phase: CampaignPhase): string {
  return CAMPAIGN_PHASE_LABELS[phase].replace(/^Phase\s*\d+\s*[\u2014\u2013-]\s*/u, "");
}

/** Substeps of a step visible for the chosen network (shared + own branch). */
function visibleSubsteps(step: CampaignStep, network: CampaignNetwork | null) {
  return step.substeps.filter(
    (s) => s.network === undefined || (network !== null && s.network === network),
  );
}

/** Checkable keys for a step: its substepIds, or the step id when it has none. */
function stepKeys(step: CampaignStep, network: CampaignNetwork | null): string[] {
  if (step.id === "choose-network") return [];
  const subs = visibleSubsteps(step, network);
  return subs.length > 0 ? subs.map((s) => s.substepId) : [step.id];
}

function isStepComplete(
  step: CampaignStep,
  network: CampaignNetwork | null,
  checked: Set<string>,
): boolean {
  if (step.id === "choose-network") return network !== null;
  const keys = stepKeys(step, network);
  return keys.length > 0 && keys.every((k) => checked.has(k));
}

/** Where the "up next" cue should render. */
interface UpNextTarget {
  stepId: string;
  /** Substep key when the cue sits on a specific substep row; null = step header. */
  substepId: string | null;
}

/**
 * The first actionable, VISIBLE unchecked item: respects network gating
 * (hidden steps and other-branch substeps never count) and collapse state
 * (a target inside a collapsed step marks the step header instead).
 */
function computeUpNext(
  visibleSteps: readonly CampaignStep[],
  network: CampaignNetwork | null,
  checked: Set<string>,
  collapsed: Set<string>,
): UpNextTarget | null {
  for (const step of visibleSteps) {
    if (step.id === "choose-network") {
      if (network === null) return { stepId: step.id, substepId: null };
      continue;
    }
    const subs = visibleSubsteps(step, network);
    if (subs.length === 0) {
      if (!checked.has(step.id)) return { stepId: step.id, substepId: null };
      continue;
    }
    const firstUnchecked = subs.find((s) => !checked.has(s.substepId));
    if (firstUnchecked) {
      if (collapsed.has(step.id)) return { stepId: step.id, substepId: null };
      return { stepId: step.id, substepId: firstUnchecked.substepId };
    }
  }
  return null;
}

function UpNextBadge() {
  return (
    <span
      className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground"
      data-testid="up-next"
    >
      Up next
    </span>
  );
}

export default function CampaignChecklist() {
  const [network, setNetwork] = useState<CampaignNetwork | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<CampaignNetwork | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Monotonic id so only the latest save's response state matters.
  const saveReqId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/campaign-checklist`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { network: null, checkedIds: [] }))
      .then((data: { network: CampaignNetwork | null; checkedIds: string[] }) => {
        if (cancelled) return;
        setNetwork(data.network ?? null);
        setChecked(new Set(data.checkedIds ?? []));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((nextNetwork: CampaignNetwork | null, nextChecked: Set<string>) => {
    const reqId = ++saveReqId.current;
    fetch(`${API_BASE}/campaign-checklist`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network: nextNetwork, checkedIds: Array.from(nextChecked) }),
    })
      .then((r) => {
        if (reqId === saveReqId.current) setSaveError(!r.ok);
      })
      .catch(() => {
        if (reqId === saveReqId.current) setSaveError(true);
      });
  }, []);

  const toggleKey = useCallback(
    (key: string) => {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        save(network, next);
        return next;
      });
    },
    [network, save],
  );

  /** Check/uncheck every key of a single-checkbox step. */
  const setStepChecked = useCallback(
    (keys: string[], value: boolean) => {
      setChecked((prev) => {
        const next = new Set(prev);
        for (const k of keys) {
          if (value) next.add(k);
          else next.delete(k);
        }
        save(network, next);
        return next;
      });
    },
    [network, save],
  );

  const applyNetwork = useCallback(
    (choice: CampaignNetwork) => {
      setNetwork(choice);
      setChecked((prev) => {
        // Drop branch substeps that belong to the other network; shared
        // checkmarks persist. (The server enforces the same rule.)
        const next = new Set<string>();
        for (const step of CAMPAIGN_ROADMAP) {
          for (const sub of step.substeps) {
            if (!prev.has(sub.substepId)) continue;
            if (sub.network === undefined || sub.network === choice) next.add(sub.substepId);
          }
          if (step.substeps.length === 0 && prev.has(step.id)) next.add(step.id);
        }
        save(choice, next);
        return next;
      });
    },
    [save],
  );

  const chooseNetwork = useCallback(
    (choice: CampaignNetwork) => {
      if (network === choice) return;
      if (network !== null) {
        setPendingSwitch(choice);
        return;
      }
      applyNetwork(choice);
    },
    [network, applyNetwork],
  );

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visibleSteps = useMemo(
    () => (network === null ? CAMPAIGN_ROADMAP.filter((s) => s.number <= 3) : CAMPAIGN_ROADMAP),
    [network],
  );

  const completedByStep = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const step of CAMPAIGN_ROADMAP) {
      map.set(step.id, isStepComplete(step, network, checked));
    }
    return map;
  }, [network, checked]);

  const upNext = useMemo(
    () => computeUpNext(visibleSteps, network, checked, collapsed),
    [visibleSteps, network, checked, collapsed],
  );

  // Group the visible steps by phase, preserving chronological order.
  const phaseGroups = useMemo(() => {
    const groups: { phase: CampaignPhase; steps: CampaignStep[] }[] = [];
    for (const step of visibleSteps) {
      const last = groups[groups.length - 1];
      if (last && last.phase === step.phase) last.steps.push(step);
      else groups.push({ phase: step.phase, steps: [step] });
    }
    return groups;
  }, [visibleSteps]);

  return (
    <AppLayout>
      <div className="space-y-6 max-w-3xl" data-testid="campaign-checklist-page">
        <div className="space-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <ClipboardList className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">Campaign Checklist</h1>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
              Your BTS campaign roadmap. Check items off as you go — your progress is saved to
              your account and follows you across devices.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/blitz">
                <ArrowLeft className="w-4 h-4" />
                Back to The Blitz™
              </Link>
            </Button>
            {saveError && (
              <p className="text-xs text-red-600">
                Couldn't save your latest change — check your connection and try again.
              </p>
            )}
          </div>
        </div>

        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading your checklist…</p>
        ) : (
          <>
            {phaseGroups.map((group) => (
              <div key={`${group.phase}-${group.steps[0]?.id}`}>
                {group.steps[0] &&
                  CAMPAIGN_ROADMAP.find((s) => s.phase === group.phase)?.id === group.steps[0].id && (
                    <div className="mb-2 flex items-center gap-3 pt-2">
                      <h2
                        className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                        data-testid={`phase-header-${group.phase}`}
                      >
                        {phaseDisplayLabel(group.phase)}
                      </h2>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                <div className="divide-y divide-border/40">
                  {group.steps.map((step) => (
                    <div key={step.id}>
                      <StepRow
                        step={step}
                        network={network}
                        checked={checked}
                        complete={completedByStep.get(step.id) ?? false}
                        open={!collapsed.has(step.id)}
                        upNext={upNext?.stepId === step.id ? upNext : null}
                        onToggleOpen={() => toggleCollapsed(step.id)}
                        onToggleKey={toggleKey}
                        onSetStep={setStepChecked}
                        onChooseNetwork={chooseNetwork}
                      />
                      {step.number === 10 && network !== null && (
                        <div
                          className="my-3 flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3"
                          data-testid="compliance-boundary"
                        >
                          <ShieldCheck className="w-5 h-5 shrink-0 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">
                            <strong className="font-semibold text-foreground">
                              Compliance boundary.
                            </strong>{" "}
                            Waiting on compliance review? You can work through here — everything
                            past this point needs your approved assets.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {network === null && (
              <p className="text-sm italic text-muted-foreground" data-testid="unlock-teaser">
                The rest of the checklist unlocks once you choose your affiliate network above.
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={pendingSwitch !== null} onOpenChange={(o) => !o && setPendingSwitch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pendingSwitch ? NETWORK_LABELS[pendingSwitch] : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your shared progress stays; network-specific items will be replaced with the{" "}
              {pendingSwitch ? NETWORK_LABELS[pendingSwitch] : ""} versions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSwitch) applyNetwork(pendingSwitch);
                setPendingSwitch(null);
              }}
            >
              Switch network
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function StepRow({
  step,
  network,
  checked,
  complete,
  open,
  upNext,
  onToggleOpen,
  onToggleKey,
  onSetStep,
  onChooseNetwork,
}: {
  step: CampaignStep;
  network: CampaignNetwork | null;
  checked: Set<string>;
  complete: boolean;
  open: boolean;
  upNext: UpNextTarget | null;
  onToggleOpen: () => void;
  onToggleKey: (key: string) => void;
  onSetStep: (keys: string[], value: boolean) => void;
  onChooseNetwork: (choice: CampaignNetwork) => void;
}) {
  const isNetworkStep = step.id === "choose-network";
  const subs = visibleSubsteps(step, network);
  const singleCheckbox = !isNetworkStep && subs.length === 0;
  const expandable = isNetworkStep || subs.length > 0;
  const headerIsUpNext = upNext !== null && upNext.substepId === null;

  return (
    <div className="py-3" data-testid={`step-row-${step.id}`}>
      <div className="flex items-start gap-3">
        {singleCheckbox && (
          <Checkbox
            checked={checked.has(step.id)}
            onCheckedChange={(v) => onSetStep([step.id], v === true)}
            className="mt-0.5"
            aria-label={`Mark "${step.title}" complete`}
            data-testid={`step-checkbox-${step.id}`}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={`text-sm leading-snug ${
                    complete
                      ? "font-normal text-muted-foreground line-through"
                      : headerIsUpNext
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground"
                  }`}
                >
                  {step.title}
                </h3>
                {headerIsUpNext && <UpNextBadge />}
              </div>
              {step.description && (
                <p
                  className={`mt-0.5 text-sm leading-relaxed ${
                    complete ? "text-muted-foreground/60" : "text-muted-foreground"
                  }`}
                >
                  {step.description}
                </p>
              )}
            </div>
            {expandable && (
              <button
                type="button"
                onClick={onToggleOpen}
                className="p-1 rounded hover:bg-muted text-muted-foreground shrink-0"
                aria-label={open ? `Collapse "${step.title}"` : `Expand "${step.title}"`}
                data-testid={`step-toggle-${step.id}`}
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>

          {isNetworkStep && open && (
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Affiliate network">
              {(["media-mavens", "clickbank"] as const).map((n) => (
                <label
                  key={n}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                    network === n
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="affiliate-network"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={network === n}
                    onChange={() => onChooseNetwork(n)}
                    data-testid={`network-radio-${n}`}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {NETWORK_LABELS[n]}
                  </span>
                </label>
              ))}
            </div>
          )}

          {!isNetworkStep && subs.length > 0 && open && (
            <ul className="mt-2 space-y-2 pl-1">
              {subs.map((sub) => {
                const subChecked = checked.has(sub.substepId);
                const subIsUpNext = upNext !== null && upNext.substepId === sub.substepId;
                return (
                  <li key={sub.substepId} className="flex items-start gap-3">
                    <Checkbox
                      id={`sub-${sub.substepId}`}
                      checked={subChecked}
                      onCheckedChange={() => onToggleKey(sub.substepId)}
                      className="mt-0.5"
                      aria-label={`Mark "${sub.action}" complete`}
                      data-testid={`substep-checkbox-${sub.substepId}`}
                    />
                    <label
                      htmlFor={`sub-${sub.substepId}`}
                      className={`text-sm leading-relaxed cursor-pointer ${
                        subChecked
                          ? "text-muted-foreground line-through"
                          : subIsUpNext
                            ? "font-semibold text-foreground"
                            : "text-foreground"
                      }`}
                    >
                      {sub.action}
                      {subIsUpNext && (
                        <span className="ml-2 align-middle">
                          <UpNextBadge />
                        </span>
                      )}
                      {sub.network && (
                        <span className="ml-2 inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground align-middle">
                          {NETWORK_LABELS[sub.network]}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
