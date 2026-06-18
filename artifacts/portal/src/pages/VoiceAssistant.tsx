import { AppLayout } from "@/components/layout/AppLayout";
import { VoiceCall } from "@/components/voice/VoiceCall";
import { useVoiceStatus } from "@/lib/voice-api";
import { Mic, Clock, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default function VoiceAssistant() {
  const { data: status, isLoading } = useVoiceStatus();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
        </div>
      </AppLayout>
    );
  }

  const hasAccess = status?.has_access ?? false;
  const capReached = hasAccess && (status?.seconds_remaining ?? 1) <= 0;
  const disabled = !hasAccess || capReached;

  return (
    <AppLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Mic className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Voice Assistant</h1>
          </div>
          <p className="text-muted-foreground">
            Have a live voice conversation with your BTS AI assistant. Ask questions, talk through strategies, and get real-time answers.
          </p>
        </div>

        {status && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-stone-100 dark:bg-stone-800/60 text-sm">
            <Clock className="w-4 h-4 text-stone-500 shrink-0" />
            <span className="text-stone-600 dark:text-stone-400">
              Daily usage:{" "}
              <span className="font-semibold text-stone-900 dark:text-stone-100">
                {formatSeconds(status.seconds_used_today)}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-stone-900 dark:text-stone-100">
                {formatSeconds(status.daily_cap_seconds)}
              </span>
            </span>
            {!capReached && (
              <span className="ml-auto text-stone-500">
                {formatSeconds(status.seconds_remaining)} remaining
              </span>
            )}
            {capReached && (
              <span className="ml-auto text-destructive font-medium">Limit reached</span>
            )}
          </div>
        )}

        {!hasAccess && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Voice Access Required</h3>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  The voice assistant is available to members with voice access. Upgrade your plan to unlock this feature.
                </p>
                <Link href="/plans">
                  <a className="inline-block mt-3 text-sm font-semibold text-amber-800 dark:text-amber-300 underline underline-offset-2">
                    View upgrade options →
                  </a>
                </Link>
              </div>
            </div>
          </div>
        )}

        {capReached && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-6">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Daily Limit Reached</h3>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  You've used your full {formatSeconds(status?.daily_cap_seconds ?? 1800)} daily voice allowance. Your limit resets at midnight.
                </p>
              </div>
            </div>
          </div>
        )}

        {!disabled && (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6 shadow-sm">
            <VoiceCall />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
