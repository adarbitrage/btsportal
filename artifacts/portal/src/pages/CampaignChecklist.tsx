import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
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
import { ArrowLeft, Check, ChevronDown, ClipboardList, ShieldCheck } from "lucide-react";
import {
  CAMPAIGN_ROADMAP,
  CAMPAIGN_STEP_COUNT,
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

const NETWORK_TAG_CLASS: Record<CampaignNetwork, string> = {
  "media-mavens": "bg-emerald-50 text-emerald-700 border-emerald-200",
  clickbank: "bg-amber-50 text-amber-700 border-amber-200",
};

const PHASE_PILL: Record<CampaignPhase, string> = {
  build: "bg-[#188f4a] border-[#136b38] text-white",
  test: "bg-[#cf550a] border-[#a03f07] text-white",
  scale: "bg-[#7f2ac9] border-[#641f9e] text-white",
};

const PHASE_ACCENT: Record<CampaignPhase, string> = {
  build: "bg-[#188f4a]",
  test: "bg-[#cf550a]",
  scale: "bg-[#7f2ac9]",
};

const PHASE_NUM: Record<CampaignPhase, string> = {
  build: "border-[#136b38] text-[#188f4a]",
  test: "border-[#a03f07] text-[#cf550a]",
  scale: "border-[#641f9e] text-[#7f2ac9]",
};

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

  /** Check/uncheck every key of a single-checkbox step or a whole card. */
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

  const overallDone = useMemo(
    () => CAMPAIGN_ROADMAP.filter((s) => completedByStep.get(s.id)).length,
    [completedByStep],
  );

  const phaseProgress = useMemo(() => {
    const out: Record<CampaignPhase, { done: number; total: number }> = {
      build: { done: 0, total: 0 },
      test: { done: 0, total: 0 },
      scale: { done: 0, total: 0 },
    };
    for (const step of CAMPAIGN_ROADMAP) {
      out[step.phase].total += 1;
      if (completedByStep.get(step.id)) out[step.phase].done += 1;
    }
    return out;
  }, [completedByStep]);

  const overallPct = Math.round((overallDone / CAMPAIGN_STEP_COUNT) * 100);

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
      <div className="space-y-6 max-w-4xl" data-testid="campaign-checklist-page">
        <div className="space-y-4">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList className="w-6 h-6 text-primary" />
                <h1 className="text-3xl font-bold">Campaign Checklist</h1>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                The 17-step BTS campaign roadmap. Check items off as you go — your progress is
                saved to your account and follows you across devices.
              </p>
            </div>

            <Card className="border-border/60 shadow-sm w-full shrink-0 sm:w-64">
              <CardContent className="px-4 py-2 h-full flex flex-col justify-center">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Your Progress
                  </span>
                  <span className="text-xs font-semibold text-foreground" data-testid="overall-progress">
                    {overallDone} of {CAMPAIGN_STEP_COUNT} steps
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${overallPct}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[11px] text-muted-foreground">
                  {overallPct}% complete
                </div>
              </CardContent>
            </Card>
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
                    <div className="mb-4 flex items-center gap-3">
                      <div
                        className={`inline-flex items-center rounded-full border px-3.5 py-1.5 ${PHASE_PILL[group.phase]}`}
                      >
                        <span className="text-sm font-semibold tracking-wide uppercase">
                          {CAMPAIGN_PHASE_LABELS[group.phase]}
                        </span>
                      </div>
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs font-medium text-muted-foreground" data-testid={`phase-progress-${group.phase}`}>
                        {phaseProgress[group.phase].done} of {phaseProgress[group.phase].total} steps
                      </span>
                    </div>
                  )}
                <div className="space-y-3">
                  {group.steps.map((step) => (
                    <div key={step.id}>
                      <StepCard
                        step={step}
                        network={network}
                        checked={checked}
                        complete={completedByStep.get(step.id) ?? false}
                        open={!collapsed.has(step.id)}
                        onToggleOpen={() => toggleCollapsed(step.id)}
                        onToggleKey={toggleKey}
                        onSetStep={setStepChecked}
                        onChooseNetwork={chooseNetwork}
                      />
                      {step.number === 10 && network !== null && (
                        <div
                          className="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3"
                          data-testid="compliance-boundary"
                        >
                          <ShieldCheck className="w-5 h-5 shrink-0 text-amber-600" />
                          <p className="text-sm text-amber-800">
                            <strong className="font-semibold">Compliance boundary.</strong>{" "}
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
                The rest of the checklist unlocks once you choose your affiliate network in step 3.
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

function StepCard({
  step,
  network,
  checked,
  complete,
  open,
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
  onToggleOpen: () => void;
  onToggleKey: (key: string) => void;
  onSetStep: (keys: string[], value: boolean) => void;
  onChooseNetwork: (choice: CampaignNetwork) => void;
}) {
  const isNetworkStep = step.id === "choose-network";
  const subs = visibleSubsteps(step, network);
  const singleCheckbox = !isNetworkStep && subs.length === 0;
  const expandable = isNetworkStep || subs.length > 0;

  return (
    <Card
      className={`overflow-hidden border shadow-sm transition-all duration-200 ${
        complete ? "border-emerald-200 bg-emerald-50/40" : "border-border/60 hover:shadow-md"
      }`}
      data-testid={`step-card-${step.id}`}
    >
      <div className="flex">
        <div className={`w-1 shrink-0 ${complete ? "bg-emerald-500" : PHASE_ACCENT[step.phase]}`} />
        <CardContent className="p-4 sm:p-5 flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <div
              className={`flex items-center justify-center w-9 h-9 rounded-xl border shrink-0 text-sm font-bold ${
                complete
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : `bg-white ${PHASE_NUM[step.phase]}`
              }`}
            >
              {complete ? <Check className="w-4 h-4" /> : step.number}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold leading-snug text-foreground">{step.title}</h3>
                  {step.description && (
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {singleCheckbox && (
                    <Checkbox
                      checked={checked.has(step.id)}
                      onCheckedChange={(v) => onSetStep([step.id], v === true)}
                      aria-label={`Mark step ${step.number} complete`}
                      data-testid={`step-checkbox-${step.id}`}
                    />
                  )}
                  {expandable && (
                    <button
                      type="button"
                      onClick={onToggleOpen}
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      aria-label={open ? "Collapse step" : "Expand step"}
                      data-testid={`step-toggle-${step.id}`}
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}
                </div>
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
                <ul className="mt-3 space-y-2">
                  {subs.map((sub) => (
                    <li key={sub.substepId} className="flex items-start gap-3">
                      <Checkbox
                        id={`sub-${sub.substepId}`}
                        checked={checked.has(sub.substepId)}
                        onCheckedChange={() => onToggleKey(sub.substepId)}
                        className="mt-0.5"
                        data-testid={`substep-checkbox-${sub.substepId}`}
                      />
                      <label
                        htmlFor={`sub-${sub.substepId}`}
                        className="text-sm leading-relaxed text-foreground cursor-pointer"
                      >
                        {sub.action}
                        {sub.network && (
                          <span
                            className={`ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium align-middle ${NETWORK_TAG_CLASS[sub.network]}`}
                          >
                            {NETWORK_LABELS[sub.network]}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
