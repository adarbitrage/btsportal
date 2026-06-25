import { useState, useRef, useEffect, useCallback } from "react";
import { RetellWebClient } from "retell-client-js-sdk";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Phone, Loader2, AlertCircle, Volume2 } from "lucide-react";
import { useStartWebCall, useBackfillCall } from "@/lib/voice-api";
import { useQueryClient } from "@tanstack/react-query";

type CallState = "idle" | "connecting" | "active" | "ending" | "error";

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceCall() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentTalking, setIsAgentTalking] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const clientRef = useRef<RetellWebClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const activeCallIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { mutateAsync: startWebCall, isPending: isStarting } = useStartWebCall();
  const { mutateAsync: backfillCall } = useBackfillCall();

  const clearRetryTimers = useCallback(() => {
    retryTimersRef.current.forEach((t) => clearTimeout(t));
    retryTimersRef.current = [];
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (clientRef.current) {
      try { clientRef.current.stopCall(); } catch {}
      clientRef.current = null;
    }
    setIsAgentTalking(false);
    setIsMuted(false);
  }, []);

  // Invalidates voice query caches at t=0, 3s, 8s, 18s and, when a callId is
  // provided, also fires the backfill endpoint at each interval so usage is
  // accrued even when the Retell call_ended webhook is absent or delayed.
  // The backfill endpoint is idempotent (already_finalized guard) so retrying
  // multiple times is safe.
  const scheduleCallsRefresh = useCallback((callId?: string | null) => {
    clearRetryTimers();
    queryClient.invalidateQueries({ queryKey: ["voice", "calls"] });
    queryClient.invalidateQueries({ queryKey: ["voice", "status"] });
    if (callId) {
      backfillCall(callId).catch(() => {});
    }
    const delays = [3_000, 8_000, 18_000];
    retryTimersRef.current = delays.map((ms) =>
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["voice", "calls"] });
        queryClient.invalidateQueries({ queryKey: ["voice", "status"] });
        if (callId) {
          backfillCall(callId).catch(() => {});
        }
      }, ms),
    );
  }, [queryClient, clearRetryTimers, backfillCall]);

  useEffect(() => {
    return () => {
      cleanup();
      clearRetryTimers();
    };
  }, [cleanup, clearRetryTimers]);

  const startCall = useCallback(async () => {
    clearRetryTimers();
    setErrorMsg(null);
    setTranscript([]);
    setElapsed(0);
    activeCallIdRef.current = null;
    setCallState("connecting");

    let permGranted = false;
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      permGranted = true;
    } catch {
      setErrorMsg("Microphone permission denied. Please allow microphone access and try again.");
      setCallState("idle");
      return;
    }

    let callData: { access_token: string; call_id: string };
    try {
      callData = await startWebCall();
    } catch (err: any) {
      if (err.code === "voice_cap_reached") {
        setErrorMsg("Daily voice limit reached. Try again tomorrow.");
      } else if (err.code === "voice_access_required") {
        setErrorMsg("Voice assistant requires a higher membership level.");
      } else {
        setErrorMsg(err.message || "Failed to start call. Please try again.");
      }
      setCallState("idle");
      return;
    }

    activeCallIdRef.current = callData.call_id;

    const retellClient = new RetellWebClient();
    clientRef.current = retellClient;

    retellClient.on("call_started", () => {
      setCallState("active");
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    });

    retellClient.on("call_ended", () => {
      const callId = activeCallIdRef.current;
      cleanup();
      setCallState("idle");
      scheduleCallsRefresh(callId);
    });

    retellClient.on("agent_start_talking", () => setIsAgentTalking(true));
    retellClient.on("agent_stop_talking", () => setIsAgentTalking(false));

    retellClient.on("update", (update: any) => {
      const transcript = update?.transcript;
      if (Array.isArray(transcript)) {
        const lines: string[] = transcript
          .slice(-5)
          .map((t: any) => `${t.role === "agent" ? "Agent" : "You"}: ${t.content}`);
        setTranscript(lines);
      }
    });

    retellClient.on("error", (err: any) => {
      console.error("[VoiceCall] error:", err);
      cleanup();
      setErrorMsg("Call disconnected. Please try again.");
      setCallState("idle");
    });

    try {
      await retellClient.startCall({ accessToken: callData.access_token });
    } catch (err: any) {
      cleanup();
      setErrorMsg(err.message || "Failed to connect call.");
      setCallState("idle");
    }
  }, [startWebCall, cleanup, scheduleCallsRefresh, clearRetryTimers]);

  const endCall = useCallback(() => {
    const callId = activeCallIdRef.current;
    setCallState("ending");
    cleanup();
    setCallState("idle");
    scheduleCallsRefresh(callId);
  }, [cleanup, scheduleCallsRefresh]);

  const toggleMute = useCallback(() => {
    if (!clientRef.current) return;
    if (isMuted) {
      clientRef.current.unmute();
    } else {
      clientRef.current.mute();
    }
    setIsMuted((m) => !m);
  }, [isMuted]);

  return (
    <div className="flex flex-col gap-6">
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-xs underline shrink-0">Dismiss</button>
        </div>
      )}

      <div className="flex flex-col items-center gap-6 py-8">
        <div className="relative flex items-center justify-center">
          <div
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${
              callState === "active" && isAgentTalking
                ? "bg-primary/20 ring-4 ring-primary/40 ring-offset-2 animate-pulse"
                : callState === "active"
                ? "bg-primary/10 ring-2 ring-primary/20"
                : "bg-stone-100 dark:bg-stone-800"
            }`}
          >
            {callState === "connecting" ? (
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            ) : callState === "active" && isAgentTalking ? (
              <Volume2 className="w-10 h-10 text-primary" />
            ) : callState === "active" ? (
              <Phone className="w-10 h-10 text-primary" />
            ) : (
              <Phone className="w-10 h-10 text-stone-400 dark:text-stone-500" />
            )}
          </div>
        </div>

        {callState === "active" && (
          <div className="text-center space-y-1">
            <p className="text-2xl font-mono font-semibold text-stone-900 dark:text-stone-100">
              {formatSeconds(elapsed)}
            </p>
            {isAgentTalking && (
              <p className="text-sm text-primary font-medium animate-pulse">Agent speaking…</p>
            )}
          </div>
        )}

        {callState === "connecting" && (
          <p className="text-sm text-stone-500 dark:text-stone-400">Connecting…</p>
        )}

        {callState === "idle" && (
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center max-w-xs">
            Click Start Call to begin a live voice conversation with your BTS AI assistant.
          </p>
        )}

        <div className="flex items-center gap-4">
          {callState === "active" && (
            <Button
              variant="outline"
              size="icon"
              className={`w-12 h-12 rounded-full transition-colors ${
                isMuted
                  ? "border-destructive text-destructive hover:bg-destructive/10"
                  : "border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-200"
              }`}
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>
          )}

          {callState === "idle" && (
            <Button
              onClick={startCall}
              disabled={isStarting}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 h-11 rounded-full"
            >
              {isStarting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Phone className="w-4 h-4" />
              )}
              Start Call
            </Button>
          )}

          {(callState === "active" || callState === "ending") && (
            <Button
              onClick={endCall}
              disabled={callState === "ending"}
              className="gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground px-6 h-11 rounded-full"
            >
              <PhoneOff className="w-4 h-4" />
              End Call
            </Button>
          )}
        </div>
      </div>

      {transcript.length > 0 && (
        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-4">
          <p className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
            Live Transcript
          </p>
          <div className="space-y-2">
            {transcript.map((line, i) => (
              <p key={i} className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
