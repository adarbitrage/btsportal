import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type BlitzLessonDetail,
  type BlitzLessonSummary,
} from "@/lib/blitz-api";
import snapshot from "./blitz-archive-lessons.json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Phase = "build" | "test" | "scale";

const PHASE_META: Record<Phase, { label: string; badgeClass: string; description: string }> = {
  build: {
    label: "Phase 1 — Build",
    badgeClass: "bg-emerald-700",
    description: "Set up your offer, landing pages, ads, and tracking.",
  },
  test: {
    label: "Phase 2 — Test",
    badgeClass: "bg-amber-600",
    description: "Run your campaigns and find your winners through data.",
  },
  scale: {
    label: "Phase 3 — Scale",
    badgeClass: "bg-purple-700",
    description: "Multiply spend on what's already proven to work.",
  },
};

const NETWORK_LABEL: Record<string, { label: string; cls: string }> = {
  universal: { label: "All Networks", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  "media-mavens": { label: "Media Mavens", cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  clickbank: { label: "ClickBank", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  maxweb: { label: "MaxWeb", cls: "bg-blue-50 text-blue-800 border-blue-300" },
};

const PUBLISHER_LABEL: Record<string, { label: string; cls: string }> = {
  all: { label: "All Publishers", cls: "bg-slate-100 text-slate-700 border-slate-300" },
  caterpillar: { label: "Caterpillar", cls: "bg-purple-50 text-purple-800 border-purple-300" },
  "grasshopper-crane": { label: "Grasshopper / Crane", cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
};

interface GroupedModule {
  moduleName: string;
  lessons: BlitzLessonSummary[];
}

interface GroupedPhase {
  phase: Phase;
  modules: GroupedModule[];
}

function groupLessons(lessons: BlitzLessonSummary[]): GroupedPhase[] {
  const order: Phase[] = ["build", "test", "scale"];
  const buckets = new Map<Phase, Map<string, BlitzLessonSummary[]>>();
  order.forEach((p) => buckets.set(p, new Map()));

  for (const l of lessons) {
    const phase = (l.phase || "build") as Phase;
    if (!buckets.has(phase)) continue;
    const moduleName = l.module || "Other";
    const moduleMap = buckets.get(phase)!;
    if (!moduleMap.has(moduleName)) moduleMap.set(moduleName, []);
    moduleMap.get(moduleName)!.push(l);
  }

  return order
    .map((phase) => {
      const moduleMap = buckets.get(phase)!;
      const modules: GroupedModule[] = Array.from(moduleMap.entries())
        .map(([moduleName, ls]) => ({
          moduleName,
          lessons: ls.sort((a, b) => (a.blitzOrder ?? 0) - (b.blitzOrder ?? 0)),
        }))
        .sort((a, b) => {
          const aMin = Math.min(...a.lessons.map((l) => l.blitzOrder ?? Infinity));
          const bMin = Math.min(...b.lessons.map((l) => l.blitzOrder ?? Infinity));
          return aMin - bMin;
        });
      return { phase, modules };
    })
    .filter((g) => g.modules.length > 0);
}

const ARCHIVE_LESSONS = snapshot.lessons as BlitzLessonSummary[];
const ARCHIVE_DETAILS = snapshot.details as unknown as Record<string, BlitzLessonDetail>;

export default function LessonLibraryArchive() {
  const [lessons] = useState<BlitzLessonSummary[]>(ARCHIVE_LESSONS);
  const [loading] = useState(false);
  const [error] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [openLesson, setOpenLesson] = useState<BlitzLessonDetail | null>(null);
  const [openLoading] = useState(false);
  const [openError] = useState<string | null>(null);

  useEffect(() => {
    if (openId == null) {
      setOpenLesson(null);
      return;
    }
    setOpenLesson(ARCHIVE_DETAILS[String(openId)] ?? null);
  }, [openId]);

  const grouped = useMemo(() => groupLessons(lessons), [lessons]);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading the Blitz lesson library…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Couldn't load the lesson library: {error}
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No Blitz lessons available yet.
      </div>
    );
  }

  return (
    <div className="lesson-library">
      <p className="mb-4 text-sm text-slate-600">
        Every step-by-step lesson, in order. Click any lesson to read the full walkthrough.
      </p>

      {grouped.map(({ phase, modules }) => {
        const meta = PHASE_META[phase];
        return (
          <div key={phase} className="mb-8">
            <div className="mb-3 flex items-center gap-3">
              <span
                className={`inline-block rounded-full px-3 py-1 text-[0.7rem] font-bold uppercase tracking-wider text-white ${meta.badgeClass}`}
              >
                {meta.label}
              </span>
              <span className="text-sm text-slate-500">{meta.description}</span>
            </div>

            <div className="space-y-4">
              {modules.map((m) => (
                <div
                  key={m.moduleName}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                    <h4 className="text-sm font-semibold text-slate-800">
                      {m.moduleName}{" "}
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
                      </span>
                    </h4>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {m.lessons.map((l) => {
                      const network = l.networkPath ? NETWORK_LABEL[l.networkPath] : undefined;
                      const publisher = l.publisherPath ? PUBLISHER_LABEL[l.publisherPath] : undefined;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => setOpenId(l.id)}
                            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                          >
                            <div className="flex min-w-0 items-baseline gap-3">
                              <span className="font-mono text-xs text-slate-400">
                                {l.lessonId || `#${l.blitzOrder ?? "—"}`}
                              </span>
                              <span className="truncate text-sm font-medium text-slate-800">
                                {l.title}
                              </span>
                            </div>
                            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                              {network && network.label !== "All Networks" && (
                                <span
                                  className={`rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${network.cls}`}
                                >
                                  {network.label}
                                </span>
                              )}
                              {publisher && publisher.label !== "All Publishers" && (
                                <span
                                  className={`rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${publisher.cls}`}
                                >
                                  {publisher.label}
                                </span>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <Dialog open={openId != null} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openLesson?.title || (openLoading ? "Loading…" : "Lesson")}</DialogTitle>
            <DialogDescription>
              {openLesson ? (
                <>
                  {openLesson.lessonId && (
                    <span className="mr-2 font-mono text-xs">{openLesson.lessonId}</span>
                  )}
                  {openLesson.module && <span>{openLesson.module}</span>}
                </>
              ) : (
                <span className="text-xs">Blitz lesson detail</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {openLoading && <p className="text-sm text-slate-500">Loading lesson…</p>}
          {openError && (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {openError}
            </p>
          )}
          {openLesson && (
            <div className="prose prose-slate max-w-none prose-headings:scroll-mt-4 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-pre:bg-slate-50 prose-pre:text-slate-800">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {openLesson.content}
              </ReactMarkdown>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
