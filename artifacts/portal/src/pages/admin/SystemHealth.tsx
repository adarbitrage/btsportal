import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Database, Globe, Server, Webhook, RefreshCw, Zap, ExternalLink, ListChecks, ShieldCheck, Pause, Play, Brush, Bell, Archive, KeyRound, Volume2, VolumeX, X, Siren, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";

type AlertOutcomeFilter = "sent" | "failed" | "throttled" | "skipped";
type AlertChannelFilter = "pagerduty" | "email" | "slack";
const ALERT_OUTCOME_VALUES: AlertOutcomeFilter[] = ["sent", "failed", "throttled", "skipped"];
const ALERT_CHANNEL_VALUES: AlertChannelFilter[] = ["pagerduty", "email", "slack"];

function parseOutcomeFilter(value: string | null): AlertOutcomeFilter | null {
  return value && (ALERT_OUTCOME_VALUES as string[]).includes(value) ? (value as AlertOutcomeFilter) : null;
}

function parseChannelFilter(value: string | null): AlertChannelFilter | null {
  return value && (ALERT_CHANNEL_VALUES as string[]).includes(value) ? (value as AlertChannelFilter) : null;
}

interface QueueFallbackEvent {
  id: number;
  createdAt: string;
  channel: "email" | "sms" | null;
  recipient: string | null;
  reason: string | null;
  description: string;
}

interface QueueFallbackAlertEvent {
  id: number;
  createdAt: string;
  queueChannel: "email" | "sms" | null;
  deliveryChannel: "pagerduty" | "email" | "slack" | null;
  kind: "fire" | "clear" | null;
  outcome: "sent" | "failed" | "throttled" | "skipped" | null;
  reason: string | null;
  description: string;
}

interface QueueFallbackAlertStats {
  windowMs: number;
  sent: number;
  failed: number;
  throttled: number;
  skipped: number;
  unknown: number;
  total: number;
}

interface AlerterChannelHealth {
  channel: "email" | "sms";
  alerting: boolean;
  lastFireAt: string | null;
  lastClearAt: string | null;
}

interface AlerterThrottleSlot {
  queueChannel: "email" | "sms";
  deliveryChannel: "pagerduty" | "email" | "slack";
  kind: "fire" | "clear";
  ttlMs: number;
  expiresAt: string;
}

interface AlerterHealth {
  alertingSource: "redis" | "memory";
  throttleSource: "redis" | "memory";
  channels: AlerterChannelHealth[];
  throttles: AlerterThrottleSlot[];
  serverTime: string;
}

const FALLBACK_EVENTS_LIMIT = 50;
const ALERT_EVENTS_LIMIT = 20;
const AUTO_REFRESH_INTERVAL_MS = 30_000;
const NEW_EVENT_HIGHLIGHT_MS = 6_000;
const FALLBACK_SOUND_PREF_KEY = "systemHealth.fallbackSoundEnabled";
const FALLBACK_CHIME_VOLUME = 0.4;

function readSoundPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FALLBACK_SOUND_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export default function SystemHealth() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackEvents, setFallbackEvents] = useState<QueueFallbackEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [alertEvents, setAlertEvents] = useState<QueueFallbackAlertEvent[]>([]);
  const [alertStats, setAlertStats] = useState<QueueFallbackAlertStats | null>(null);
  const [alertEventsLoading, setAlertEventsLoading] = useState(true);
  const [alertEventsError, setAlertEventsError] = useState<string | null>(null);
  const [alerterHealth, setAlerterHealth] = useState<AlerterHealth | null>(null);
  const [alerterHealthLoading, setAlerterHealthLoading] = useState(true);
  const [alerterHealthError, setAlerterHealthError] = useState<string | null>(null);
  // Re-render driver so the throttle TTL countdowns visibly tick down between
  // backend refreshes (which only happen every 30s). Cheap: just bumps a
  // counter once per second while the alerter card is on screen.
  const [, setNowTick] = useState(0);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState(0);
  const [refreshInFlight, setRefreshInFlight] = useState(0);
  const [silentRefreshError, setSilentRefreshError] = useState<string | null>(null);
  const [highlightedEventIds, setHighlightedEventIds] = useState<Set<number>>(() => new Set());
  const [recentNewEventCount, setRecentNewEventCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => readSoundPreference());
  const inFlightRef = useRef(0);
  const previousMaxEventIdRef = useRef<number | null>(null);
  const hasLoadedFallbackEventsRef = useRef(false);
  const highlightTimersRef = useRef<Map<number, number>>(new Map());
  const recentNewCountTimerRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const chimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FALLBACK_SOUND_PREF_KEY, soundEnabled ? "1" : "0");
    } catch {
      // ignore — non-fatal if storage is unavailable
    }
  }, [soundEnabled]);

  const playFallbackChime = useCallback(() => {
    if (!soundEnabledRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (!chimeAudioRef.current) {
        const audio = new Audio(`${import.meta.env.BASE_URL}sounds/fallback-chime.wav`);
        audio.preload = "auto";
        audio.volume = FALLBACK_CHIME_VOLUME;
        chimeAudioRef.current = audio;
      }
      const audio = chimeAudioRef.current;
      audio.volume = FALLBACK_CHIME_VOLUME;
      try {
        audio.currentTime = 0;
      } catch {
        // some browsers throw if the audio hasn't loaded yet — that's fine
      }
      const result = audio.play();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Browsers may block playback before the user interacts with the page.
          // Silently swallow — the toggle itself is a user gesture, so subsequent
          // plays will succeed.
        });
      }
    } catch {
      // ignore — playback is purely a nice-to-have
    }
  }, []);

  // Alert deliveries filters live in the URL so an admin's narrowed view
  // survives a refresh and is shareable in an incident channel. Wouter's
  // useSearch returns the current query string; we re-derive the active
  // filters from it via useMemo so URL is the single source of truth.
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const alertOutcomeFilter = useMemo(
    () => parseOutcomeFilter(new URLSearchParams(searchString).get("alertOutcome")),
    [searchString],
  );
  const alertChannelFilter = useMemo(
    () => parseChannelFilter(new URLSearchParams(searchString).get("alertChannel")),
    [searchString],
  );

  const updateAlertFilter = useCallback(
    (key: "alertOutcome" | "alertChannel", value: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      const path = window.location.pathname;
      navigate(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [navigate],
  );

  const markEventsAsNew = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setHighlightedEventIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    ids.forEach((id) => {
      const existing = highlightTimersRef.current.get(id);
      if (existing) window.clearTimeout(existing);
      const timerId = window.setTimeout(() => {
        setHighlightedEventIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        highlightTimersRef.current.delete(id);
      }, NEW_EVENT_HIGHLIGHT_MS);
      highlightTimersRef.current.set(id, timerId);
    });
  }, []);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      timers.forEach((tid) => window.clearTimeout(tid));
      timers.clear();
      if (recentNewCountTimerRef.current !== null) {
        window.clearTimeout(recentNewCountTimerRef.current);
        recentNewCountTimerRef.current = null;
      }
    };
  }, []);

  const loadHealth = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await adminPanelApi.getSystemHealth();
      setHealth(data);
      return true;
    } catch (err: any) {
      if (!silent) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  const loadFallbackEvents = useCallback(async (silent = false) => {
    try {
      if (!silent) setEventsLoading(true);
      const data = await adminPanelApi.getQueueFallbackEvents(FALLBACK_EVENTS_LIMIT);
      const events: QueueFallbackEvent[] = Array.isArray(data?.events) ? data.events : [];
      setFallbackEvents(events);
      setEventsError(null);

      const newMaxId = events.reduce((max, e) => (e.id > max ? e.id : max), 0);
      if (hasLoadedFallbackEventsRef.current && previousMaxEventIdRef.current !== null) {
        const prevMax = previousMaxEventIdRef.current;
        const newIds = events.filter((e) => e.id > prevMax).map((e) => e.id);
        if (newIds.length > 0) {
          markEventsAsNew(newIds);
          playFallbackChime();
          setRecentNewEventCount(newIds.length);
          if (recentNewCountTimerRef.current !== null) {
            window.clearTimeout(recentNewCountTimerRef.current);
          }
          recentNewCountTimerRef.current = window.setTimeout(() => {
            setRecentNewEventCount(0);
            recentNewCountTimerRef.current = null;
          }, NEW_EVENT_HIGHLIGHT_MS);
        }
      }
      previousMaxEventIdRef.current = newMaxId;
      hasLoadedFallbackEventsRef.current = true;

      return true;
    } catch (err: any) {
      if (silent) {
        return false;
      }
      setEventsError(err?.message ?? "Failed to load fallback events");
      return false;
    } finally {
      if (!silent) setEventsLoading(false);
    }
  }, [markEventsAsNew, playFallbackChime]);

  const loadAlertEvents = useCallback(async (silent = false) => {
    try {
      if (!silent) setAlertEventsLoading(true);
      const data = await adminPanelApi.getQueueFallbackAlertEvents(ALERT_EVENTS_LIMIT, {
        outcome: alertOutcomeFilter,
        deliveryChannel: alertChannelFilter,
      });
      setAlertEvents(Array.isArray(data?.events) ? data.events : []);
      setAlertStats(data?.stats && typeof data.stats === "object" ? (data.stats as QueueFallbackAlertStats) : null);
      setAlertEventsError(null);
      return true;
    } catch (err: any) {
      if (silent) {
        return false;
      }
      setAlertEventsError(err?.message ?? "Failed to load alert delivery events");
      return false;
    } finally {
      if (!silent) setAlertEventsLoading(false);
    }
  }, [alertOutcomeFilter, alertChannelFilter]);

  const loadAlerterHealth = useCallback(async (silent = false) => {
    try {
      if (!silent) setAlerterHealthLoading(true);
      const data = await adminPanelApi.getQueueFallbackAlerterHealth();
      setAlerterHealth(data);
      setAlerterHealthError(null);
      return true;
    } catch (err: any) {
      if (silent) {
        return false;
      }
      setAlerterHealthError(err?.message ?? "Failed to load on-call alerter state");
      return false;
    } finally {
      if (!silent) setAlerterHealthLoading(false);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current > 0) return;
    inFlightRef.current += 1;
    setRefreshInFlight(inFlightRef.current);
    try {
      const [healthOk, eventsOk, alertEventsOk, alerterHealthOk] = await Promise.all([
        loadHealth(silent),
        loadFallbackEvents(silent),
        loadAlertEvents(silent),
        loadAlerterHealth(silent),
      ]);
      const allOk = healthOk && eventsOk && alertEventsOk && alerterHealthOk;
      if (silent) {
        setSilentRefreshError(allOk ? null : "Last auto-refresh failed — showing previous data");
      } else {
        setSilentRefreshError(null);
      }
      if (allOk) {
        setLastRefreshedAt(Date.now());
        setSecondsSinceRefresh(0);
      }
    } finally {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      setRefreshInFlight(inFlightRef.current);
    }
  }, [loadHealth, loadFallbackEvents, loadAlertEvents, loadAlerterHealth]);

  // Once we've loaded an alerter snapshot with at least one active throttle
  // slot, tick a counter every second so the "remaining" labels update in
  // place between the 30s backend refreshes. Idle (zero throttles) stays
  // quiet so this doesn't burn CPU when the system is healthy.
  useEffect(() => {
    if (!alerterHealth || alerterHealth.throttles.length === 0) return;
    const id = window.setInterval(() => {
      setNowTick((n) => (n + 1) % 1_000_000);
    }, 1000);
    return () => window.clearInterval(id);
  }, [alerterHealth]);

  const isRefreshing = refreshInFlight > 0;

  useEffect(() => {
    load();
  }, [load]);

  const autoRefreshActive = !autoRefreshPaused;

  useEffect(() => {
    if (!autoRefreshActive) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (inFlightRef.current > 0) return;
      load(true);
    };

    const intervalId = window.setInterval(tick, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (!document.hidden && inFlightRef.current === 0) {
        load(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefreshActive, load]);

  useEffect(() => {
    if (lastRefreshedAt === null) return;
    const tickerId = window.setInterval(() => {
      setSecondsSinceRefresh(Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(tickerId);
  }, [lastRefreshedAt]);

  const formatRefreshLabel = () => {
    if (lastRefreshedAt === null) return "Loading...";
    if (secondsSinceRefresh < 5) return "Just now";
    if (secondsSinceRefresh < 60) return `${secondsSinceRefresh}s ago`;
    const m = Math.floor(secondsSinceRefresh / 60);
    return `${m}m ago`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const formatRelativeTime = (iso: string | null) => {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const diffMs = Date.now() - then;
    if (diffMs < 0) return "just now";
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  };

  const formatThrottleRemaining = (expiresAt: string) => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return "expiring";
    const sec = Math.ceil(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return remSec === 0 ? `${min}m` : `${min}m ${remSec}s`;
  };

  const formatAlertStatsWindow = (windowMs: number) => {
    if (!Number.isFinite(windowMs) || windowMs <= 0) return "recent";
    const minutes = Math.round(windowMs / 60000);
    if (minutes < 60) return `last ${minutes}m`;
    const hours = Math.round(windowMs / (60 * 60 * 1000));
    if (hours === 1) return "last hour";
    if (hours < 24) return `last ${hours}h`;
    const days = Math.round(windowMs / (24 * 60 * 60 * 1000));
    return days === 1 ? "last 24h" : `last ${days}d`;
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6" /> System Health
            </h1>
            <p className="text-muted-foreground mt-1">Monitor system status and performance</p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-testid="auto-refresh-indicator"
              aria-live="polite"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing ? "animate-spin text-primary" : autoRefreshActive ? "text-primary/70" : "text-muted-foreground"
                }`}
              />
              <span>
                {autoRefreshActive ? "Auto-refresh on" : "Auto-refresh paused"}
                {" · "}
                <span data-testid="last-refreshed-label">Last refreshed {formatRefreshLabel()}</span>
              </span>
              {silentRefreshError && (
                <span
                  className="ml-2 inline-flex items-center gap-1 text-amber-600"
                  title={silentRefreshError}
                  data-testid="silent-refresh-warning"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">retrying…</span>
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSoundEnabled((prev) => !prev)}
              data-testid="button-toggle-fallback-sound"
              aria-pressed={soundEnabled}
              title={
                soundEnabled
                  ? "Sound on — chime when new fallback events arrive"
                  : "Sound off — no chime when new fallback events arrive"
              }
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-4 h-4 mr-1" />Sound on
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4 mr-1" />Sound off
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAutoRefreshPaused((prev) => {
                  const next = !prev;
                  if (!next && inFlightRef.current === 0) {
                    load(true);
                  }
                  return next;
                });
              }}
              data-testid="button-toggle-auto-refresh"
              title={autoRefreshActive ? "Pause auto-refresh" : "Resume auto-refresh"}
            >
              {autoRefreshActive ? (
                <>
                  <Pause className="w-4 h-4 mr-1" />Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-1" />Resume
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        </div>

        {loading && !health ? (
          <div className="p-8 text-center text-muted-foreground">Loading system health...</div>
        ) : health && (
          <>
            <div className="flex items-center gap-3">
              <Badge variant={health.status === "healthy" ? "default" : "destructive"} className="text-sm px-3 py-1">
                {health.status === "healthy" ? "All Systems Operational" : "System Degraded"}
              </Badge>
              <span className="text-sm text-muted-foreground">Last checked: {health.serverTime ? new Date(health.serverTime).toLocaleString() : "N/A"}</span>
            </div>

            {health.services?.redis?.queueFallbacks?.alerting && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">Email/SMS queue is bypassing Redis</p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      Members are still receiving messages through the direct-send fallback,
                      but retries and backoff are disabled until Redis recovers. Check the
                      worker and Redis connection.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {health.services?.rateLimitAuditFailures?.totalCount > 0 && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30" data-testid="rate-limit-audit-failure-banner">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      Rate-limit audit writes are failing
                    </p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      {health.services.rateLimitAuditFailures.totalCount} blocked
                      requests have served a 429 to the client but failed to record
                      an audit-log row since this server started. The Audit Log will
                      under-report attacks until the underlying write error clears.
                      Check database health and recent server logs for{" "}
                      <code>[AbuseRateLimit][AuditFailure]</code>.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {Array.isArray(health.services?.missingCriticalSecrets) && health.services.missingCriticalSecrets.length > 0 && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30" data-testid="missing-critical-secrets-banner">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      {health.services.missingCriticalSecrets.length === 1
                        ? "1 production secret is unset or defaulted"
                        : `${health.services.missingCriticalSecrets.length} production secrets are unset or defaulted`}
                    </p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      On-call has been paged. See the "Production secrets" card below for the
                      affected env vars and remediation details.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {health.services?.signupChallenge && health.services.signupChallenge.enforced === false && (
              <Card className="border-yellow-500/40 bg-yellow-50 dark:bg-yellow-950/30">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-yellow-900 dark:text-yellow-200">Signup challenge is disabled</p>
                    <p className="text-sm text-yellow-800/80 dark:text-yellow-200/80">
                      The Cloudflare Turnstile secret is not configured, so signup requests
                      are passing through without verification. Set <code>TURNSTILE_SECRET_KEY</code>
                      in this environment to enforce the challenge.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4" />API Server</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Status</span><Badge variant={health.services.api.status === "up" ? "default" : "destructive"}>{health.services.api.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Uptime</span><span className="text-sm font-medium">{formatUptime(health.services.api.uptime)}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Node Version</span><span className="text-sm font-medium">{health.nodeVersion}</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />Database</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Status</span><Badge variant={health.services.database.status === "up" ? "default" : "destructive"}>{health.services.database.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total Users</span><span className="text-sm font-medium">{health.services.database.totalUsers?.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total Tickets</span><span className="text-sm font-medium">{health.services.database.totalTickets?.toLocaleString()}</span></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Webhook className="w-4 h-4" />Webhooks (24h)</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Total</span><span className="text-sm font-medium">{health.webhooks.last24h}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Failed</span><span className={`text-sm font-medium ${health.webhooks.failed24h > 0 ? "text-red-600" : ""}`}>{health.webhooks.failed24h}</span></div>
                    <div className="flex justify-between"><span className="text-sm text-muted-foreground">Audit Events</span><span className="text-sm font-medium">{health.auditLogs.last24h}</span></div>
                  </div>
                </CardContent>
              </Card>

              {Array.isArray(health.services?.missingCriticalSecrets) && (
                <Card
                  className={
                    health.services.missingCriticalSecrets.length > 0
                      ? "border-red-500/40 bg-red-50/40 dark:bg-red-950/20"
                      : undefined
                  }
                  data-testid="card-missing-critical-secrets"
                >
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <KeyRound className="w-4 h-4" />Production secrets
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        {health.services.missingCriticalSecrets.length > 0 ? (
                          <span
                            className="inline-flex items-center rounded-full border border-transparent bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider"
                            data-testid="missing-critical-secrets-status"
                          >
                            {health.services.missingCriticalSecrets.length} missing
                          </span>
                        ) : (
                          <Badge variant="success" data-testid="missing-critical-secrets-status">
                            All set
                          </Badge>
                        )}
                      </div>
                      {health.services.missingCriticalSecrets.length > 0 ? (
                        <ul className="space-y-3 pt-1">
                          {(health.services.missingCriticalSecrets as Array<{
                            id: string;
                            envVar: string;
                            title: string;
                            message: string;
                          }>).map((secret) => (
                            <li
                              key={secret.id}
                              className="space-y-1 border-l-2 border-red-500/60 pl-3"
                              data-testid={`missing-critical-secret-${secret.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <code className="text-xs font-semibold">{secret.envVar}</code>
                                <span className="inline-flex items-center rounded-full border border-transparent bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                                  unset
                                </span>
                              </div>
                              <p className="text-xs font-medium" data-testid={`missing-critical-secret-title-${secret.id}`}>
                                {secret.title}
                              </p>
                              <p
                                className="text-xs text-muted-foreground"
                                data-testid={`missing-critical-secret-message-${secret.id}`}
                              >
                                {secret.message}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          All guarded production secrets are configured on this server. Outside
                          production this list is always empty.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {health.services?.signupChallenge && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Signup Challenge</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={health.services.signupChallenge.enforced ? "success" : "warning"} data-testid="signup-challenge-status">
                          {health.services.signupChallenge.enforced ? "Enforced" : "Disabled"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {health.services.signupChallenge.enforced
                          ? "Cloudflare Turnstile is verifying signup requests on this server."
                          : "TURNSTILE_SECRET_KEY is not set — signups bypass verification on this server."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {health.services?.abuseRateLimitCleanup && (() => {
                const arl = health.services.abuseRateLimitCleanup as {
                  enabled: boolean;
                  intervalMs: number;
                  lastRanAt: string | null;
                  lastResult: { scanned: number; trimmed: number; deleted: number } | null;
                  lastError: { at: string; message: string } | null;
                  stale: boolean;
                  recentRuns?: Array<{ at: string; scanned: number; trimmed: number; deleted: number }>;
                };
                const recentRuns = Array.isArray(arl.recentRuns) ? arl.recentRuns : [];
                const lastRanLabel = arl.lastRanAt ? new Date(arl.lastRanAt).toLocaleString() : "Never";
                const intervalLabel = arl.intervalMs >= 60000
                  ? `${Math.round(arl.intervalMs / 60000)}m`
                  : `${Math.round(arl.intervalMs / 1000)}s`;
                const statusLabel = !arl.enabled
                  ? "Disabled"
                  : arl.stale
                    ? "Stale"
                    : arl.lastRanAt
                      ? "Healthy"
                      : "Pending";
                const statusVariant: "default" | "warning" | "secondary" = !arl.enabled
                  ? "secondary"
                  : arl.stale
                    ? "warning"
                    : "default";
                return (
                  <Card data-testid="card-abuse-rate-limit-cleanup">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brush className="w-4 h-4" />Rate-limit hygiene
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Status</span>
                          <Badge variant={statusVariant} data-testid="abuse-rate-limit-status">
                            {statusLabel}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last run</span>
                          <span
                            className={`text-sm font-medium ${arl.stale ? "text-red-600" : ""}`}
                            data-testid="abuse-rate-limit-last-ran"
                          >
                            {lastRanLabel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Keys scanned</span>
                          <span className="text-sm font-medium" data-testid="abuse-rate-limit-scanned">
                            {arl.lastResult?.scanned ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Stale entries trimmed</span>
                          <span className="text-sm font-medium" data-testid="abuse-rate-limit-trimmed">
                            {arl.lastResult?.trimmed ?? 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Empty keys deleted</span>
                          <span className="text-sm font-medium" data-testid="abuse-rate-limit-deleted">
                            {arl.lastResult?.deleted ?? 0}
                          </span>
                        </div>
                        {recentRuns.length > 0 && (() => {
                          // Tiny inline bar chart of "stale entries trimmed
                          // per run" so a sustained spam wave (a tall run
                          // of bars) or a regressing sweep (suddenly all
                          // zeros) jumps out at a glance, where the single
                          // "Stale entries trimmed" row above only shows
                          // the latest snapshot.
                          const max = Math.max(1, ...recentRuns.map((r) => r.trimmed));
                          const totalTrimmed = recentRuns.reduce((sum, r) => sum + r.trimmed, 0);
                          return (
                            <div className="pt-1" data-testid="abuse-rate-limit-recent-runs-chart">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">Trimmed per run</span>
                                <span
                                  className="text-xs text-muted-foreground"
                                  data-testid="abuse-rate-limit-recent-runs-count"
                                >
                                  last {recentRuns.length} {recentRuns.length === 1 ? "run" : "runs"}
                                </span>
                              </div>
                              <div className="flex items-end gap-0.5 h-10" role="img" aria-label={`Trimmed entries across the last ${recentRuns.length} cleanup runs (total ${totalTrimmed})`}>
                                {recentRuns.map((run, idx) => {
                                  const heightPct = run.trimmed === 0
                                    ? 4
                                    : Math.max(8, Math.round((run.trimmed / max) * 100));
                                  const at = new Date(run.at);
                                  const tooltip = `${at.toLocaleString()}\nScanned ${run.scanned} · Trimmed ${run.trimmed} · Deleted ${run.deleted}`;
                                  return (
                                    <div
                                      key={`${run.at}-${idx}`}
                                      className={`flex-1 min-w-[3px] rounded-sm ${
                                        run.trimmed === 0
                                          ? "bg-muted"
                                          : "bg-primary/70 hover:bg-primary"
                                      }`}
                                      style={{ height: `${heightPct}%` }}
                                      title={tooltip}
                                      data-testid="abuse-rate-limit-recent-runs-bar"
                                      data-trimmed={run.trimmed}
                                      data-scanned={run.scanned}
                                      data-deleted={run.deleted}
                                      data-at={run.at}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                        {arl.stale && (
                          <p className="text-xs text-red-600" data-testid="abuse-rate-limit-stale-warning">
                            {arl.lastRanAt
                              ? `Sweep hasn't reported in over 2× its ${intervalLabel} interval — the cleanup job may have stopped. Check the API server logs.`
                              : `Sweep hasn't reported a single run in over 2× its ${intervalLabel} interval since this server started — check the API server logs to confirm the job is running.`}
                          </p>
                        )}
                        {arl.lastError && (
                          <p
                            className="text-xs text-amber-700 dark:text-amber-300"
                            data-testid="abuse-rate-limit-last-error"
                            title={`Failed at ${new Date(arl.lastError.at).toLocaleString()}`}
                          >
                            Last sweep error: {arl.lastError.message}
                          </p>
                        )}
                        {!arl.enabled && (
                          <p className="text-xs text-muted-foreground">
                            REDIS_URL is not set, so the hourly sweep is disabled on this server.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {health.services?.emailChangeAttemptsRetention && (() => {
                const retention = health.services.emailChangeAttemptsRetention as {
                  rateLimitRetentionDays: number;
                  auditRetentionDays: number;
                  adminCancelledRetentionDays: number;
                };
                const fmtDays = (days: number) => `${days}d`;
                return (
                  <Card data-testid="card-email-change-retention">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Archive className="w-4 h-4" />Email-change attempt retention
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Legacy rate-limit rows</span>
                            <span className="text-sm font-medium" data-testid="email-change-retention-rate-limit">
                              {fmtDays(retention.rateLimitRetentionDays)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Counter-only rows with no <code>new_email</code>. Kept just past the 24h
                            rate-limit window so support can still spot bursts.
                          </p>
                        </div>
                        <div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Audit rows</span>
                            <span className="text-sm font-medium" data-testid="email-change-retention-audit">
                              {fmtDays(retention.auditRetentionDays)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Real change attempts (with a <code>new_email</code>). Kept long enough to
                            answer "what address did this member try to switch to?" on follow-up calls.
                          </p>
                        </div>
                        <div>
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Admin-cancelled rows</span>
                            <span className="text-sm font-medium" data-testid="email-change-retention-admin-cancelled">
                              {fmtDays(retention.adminCancelledRetentionDays)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Attempts cancelled via the admin tool. Held longer so support can revisit
                            the deliberate cancellation when stale tickets resurface.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {Array.isArray(health.services?.auditLogRetention?.policies) && health.services.auditLogRetention.policies.length > 0 && (() => {
                interface AuditRetentionPolicy {
                  label: string;
                  actionTypes: string[];
                  retentionDays: number;
                  lastRanAt: string | null;
                  lastDeletedCount: number | null;
                  lastError: { at: string; message: string } | null;
                }
                const policies = health.services.auditLogRetention.policies as AuditRetentionPolicy[];
                const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
                const now = Date.now();
                const isRecentFailure = (iso: string | null | undefined) => {
                  if (!iso) return false;
                  const at = new Date(iso).getTime();
                  return Number.isFinite(at) && now - at < RECENT_FAILURE_WINDOW_MS;
                };
                const recentFailureCount = policies.filter(
                  (p) => p.lastError && isRecentFailure(p.lastError.at),
                ).length;
                const fmtDays = (days: number) => `${days}d`;
                const fmtRunLabel = (iso: string | null) => {
                  if (!iso) return "Pending — sweep has not reported a run yet";
                  const rel = formatRelativeTime(iso);
                  const abs = new Date(iso).toLocaleString();
                  return rel ? `${rel} (${abs})` : abs;
                };
                return (
                  <Card data-testid="card-audit-log-retention">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Archive className="w-4 h-4" />
                        Audit-log retention policies
                        <Badge variant="outline" className="ml-2 font-normal">
                          {policies.length} {policies.length === 1 ? "policy" : "policies"}
                        </Badge>
                        {recentFailureCount > 0 && (
                          <Badge
                            variant="warning"
                            className="ml-1"
                            data-testid="audit-retention-failure-badge"
                          >
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {recentFailureCount} failed in last 24h
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        Background sweeps that cap how long each audit-log action type is kept.
                        Last-run heartbeat advances on success and failure, so a sweep that quietly
                        starts throwing still surfaces here.
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {policies.map((policy) => {
                          const recentFailure = policy.lastError && isRecentFailure(policy.lastError.at);
                          return (
                            <div
                              key={policy.label}
                              className={`rounded-md border p-3 ${
                                recentFailure
                                  ? "border-red-500/40 bg-red-50 dark:bg-red-950/30"
                                  : "border-border"
                              }`}
                              data-testid={`audit-retention-policy-${policy.label}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium" data-testid={`audit-retention-label-${policy.label}`}>
                                      {policy.label}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="font-normal"
                                      data-testid={`audit-retention-window-${policy.label}`}
                                    >
                                      {fmtDays(policy.retentionDays)} retention
                                    </Badge>
                                    {recentFailure && (
                                      <Badge
                                        variant="warning"
                                        data-testid={`audit-retention-recent-failure-${policy.label}`}
                                      >
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        Failure in last 24h
                                      </Badge>
                                    )}
                                  </div>
                                  <p
                                    className="text-xs text-muted-foreground break-words"
                                    data-testid={`audit-retention-action-types-${policy.label}`}
                                  >
                                    {policy.actionTypes.length > 0
                                      ? policy.actionTypes.map((t) => `${t}`).join(", ")
                                      : "(no action types)"}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Last run</span>
                                  <span
                                    className={`font-medium text-right ${policy.lastRanAt ? "" : "text-muted-foreground italic"}`}
                                    data-testid={`audit-retention-last-run-${policy.label}`}
                                    title={policy.lastRanAt ? new Date(policy.lastRanAt).toLocaleString() : undefined}
                                  >
                                    {fmtRunLabel(policy.lastRanAt)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Last deleted</span>
                                  <span
                                    className="font-medium text-right"
                                    data-testid={`audit-retention-last-deleted-${policy.label}`}
                                  >
                                    {policy.lastDeletedCount === null
                                      ? "—"
                                      : `${policy.lastDeletedCount} row${policy.lastDeletedCount === 1 ? "" : "s"}`}
                                  </span>
                                </div>
                              </div>
                              {policy.lastError && (
                                <p
                                  className={`mt-2 text-xs ${
                                    recentFailure ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"
                                  }`}
                                  data-testid={`audit-retention-last-error-${policy.label}`}
                                  title={`Failed at ${new Date(policy.lastError.at).toLocaleString()}`}
                                >
                                  Last sweep error ({formatRelativeTime(policy.lastError.at) ?? new Date(policy.lastError.at).toLocaleString()}): {policy.lastError.message}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {health.services?.rateLimitAuditFailures && (
                <Card data-testid="card-rate-limit-audit-failures">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" />
                      Rate-limit audit writes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Failed writes</span>
                        <span
                          className={`text-sm font-medium ${health.services.rateLimitAuditFailures.totalCount > 0 ? "text-red-600" : ""}`}
                          data-testid="rate-limit-audit-failure-total"
                        >
                          {health.services.rateLimitAuditFailures.totalCount ?? 0}
                        </span>
                      </div>
                      {health.services.rateLimitAuditFailures.lastAt && (
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last failure</span>
                          <span className="text-sm font-medium">
                            {new Date(health.services.rateLimitAuditFailures.lastAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {Object.entries(health.services.rateLimitAuditFailures.byName ?? {}).length > 0 ? (
                        <div className="space-y-1 pt-2 border-t">
                          {Object.entries(health.services.rateLimitAuditFailures.byName as Record<string, { count: number; lastError: string | null }>).map(([name, info]) => (
                            <div key={name} className="flex justify-between text-xs">
                              <span className="text-muted-foreground truncate">{name}</span>
                              <span className="font-medium">
                                {info.count}
                                {info.lastError ? ` · ${info.lastError}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No audit-write failures since this server started.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {health.services?.redis && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" />Redis / Comms Queue</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <Badge variant={health.services.redis.status === "up" ? "default" : "warning"}>
                          {health.services.redis.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Email fallbacks (5m / 1h / 24h)</span>
                        <span className={`text-sm font-medium ${health.services.redis.queueFallbacks?.email?.recentCount > 0 ? "text-red-600" : ""}`}>
                          {health.services.redis.queueFallbacks?.email?.recentCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.email?.hourCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.email?.dayCount ?? 0}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">SMS fallbacks (5m / 1h / 24h)</span>
                        <span className={`text-sm font-medium ${health.services.redis.queueFallbacks?.sms?.recentCount > 0 ? "text-red-600" : ""}`}>
                          {health.services.redis.queueFallbacks?.sms?.recentCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.sms?.hourCount ?? 0} /{" "}
                          {health.services.redis.queueFallbacks?.sms?.dayCount ?? 0}
                        </span>
                      </div>
                      {(health.services.redis.queueFallbacks?.email?.lastAt || health.services.redis.queueFallbacks?.sms?.lastAt) && (
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last fallback</span>
                          <span className="text-sm font-medium">
                            {new Date(
                              [
                                health.services.redis.queueFallbacks?.email?.lastAt,
                                health.services.redis.queueFallbacks?.sms?.lastAt,
                              ]
                                .filter(Boolean)
                                .sort()
                                .pop() as string,
                            ).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ListChecks className="w-4 h-4" />
                  Recent queue-fallback events
                  <Badge variant="outline" className="ml-2 font-normal">last {FALLBACK_EVENTS_LIMIT}</Badge>
                  {recentNewEventCount > 0 && (
                    <Badge
                      variant="default"
                      className="ml-1 font-normal bg-yellow-500 hover:bg-yellow-500 text-white border-transparent"
                      data-testid="recent-new-events-badge"
                      title={`${recentNewEventCount} new fallback event${recentNewEventCount === 1 ? "" : "s"} arrived in the last refresh`}
                    >
                      +{recentNewEventCount} new
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Each row corresponds to a direct-send fallback recorded in the audit log. Click an event to open the
                  matching audit log entry.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {eventsLoading && fallbackEvents.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">Loading recent events...</div>
                ) : eventsError ? (
                  <div className="p-6 text-center text-sm text-red-600">{eventsError}</div>
                ) : fallbackEvents.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    No queue-fallback events recorded — Redis and the comms queue look healthy.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-4 py-2">When</th>
                          <th className="text-left font-medium px-4 py-2">Channel</th>
                          <th className="text-left font-medium px-4 py-2">Recipient</th>
                          <th className="text-left font-medium px-4 py-2">Reason</th>
                          <th className="text-right font-medium px-4 py-2">Audit row</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {fallbackEvents.map((event) => {
                          const ts = event.createdAt ? new Date(event.createdAt) : null;
                          const tsLabel = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : "Unknown";
                          const isNew = highlightedEventIds.has(event.id);
                          return (
                            <tr
                              key={event.id}
                              className={`hover:bg-muted/20 transition-colors duration-1000 ${
                                isNew ? "bg-yellow-100 dark:bg-yellow-900/40" : ""
                              }`}
                              data-testid={`fallback-event-row-${event.id}`}
                              data-new-event={isNew ? "true" : "false"}
                            >
                              <td className="px-4 py-2 whitespace-nowrap text-xs">
                                <div className="flex items-center gap-2">
                                  <span>{tsLabel}</span>
                                  {isNew && (
                                    <Badge
                                      variant="default"
                                      className="text-[9px] px-1.5 py-0 bg-yellow-500 hover:bg-yellow-500 text-white border-transparent"
                                      data-testid={`new-event-badge-${event.id}`}
                                    >
                                      new
                                    </Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                {event.channel ? (
                                  <Badge variant={event.channel === "email" ? "secondary" : "outline"} className="text-[10px]">
                                    {event.channel}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">unknown</span>
                                )}
                              </td>
                              <td className="px-4 py-2 max-w-[14rem] truncate text-xs" title={event.recipient ?? ""}>
                                {event.recipient ?? <span className="text-muted-foreground italic">redacted</span>}
                              </td>
                              <td className="px-4 py-2 text-xs">
                                {event.reason ?? <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <Link
                                  href={`/admin/audit-log?actionType=queue_fallback&entityType=queue&expand=${event.id}`}
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  data-testid={`link-audit-${event.id}`}
                                >
                                  #{event.id}
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-alerter-health">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Siren className="w-4 h-4" />
                  On-call alerter state
                  {alerterHealth && (
                    <Badge
                      variant={alerterHealth.alertingSource === "redis" ? "outline" : "warning"}
                      className="ml-2 font-normal"
                      data-testid="alerter-health-source"
                      title={
                        alerterHealth.alertingSource === "redis"
                          ? "State sourced from cluster-shared Redis."
                          : "Redis is unavailable on this pod — showing per-instance fallback state."
                      }
                    >
                      {alerterHealth.alertingSource === "redis" ? "shared (Redis)" : "in-memory only"}
                    </Badge>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Live snapshot of whether the alerter believes each queue is currently in an outage,
                  when it last fired or cleared, and which delivery channels are currently throttled.
                </p>
              </CardHeader>
              <CardContent>
                {alerterHealthLoading && !alerterHealth ? (
                  <div className="p-4 text-center text-muted-foreground text-sm" data-testid="alerter-health-loading">
                    Loading alerter state...
                  </div>
                ) : alerterHealthError ? (
                  <div className="p-4 text-center text-sm text-red-600" data-testid="alerter-health-error">
                    {alerterHealthError}
                  </div>
                ) : alerterHealth ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {alerterHealth.channels.map((ch) => {
                        const lastFireRel = formatRelativeTime(ch.lastFireAt);
                        const lastClearRel = formatRelativeTime(ch.lastClearAt);
                        return (
                          <div
                            key={ch.channel}
                            className={`rounded-md border p-3 ${
                              ch.alerting
                                ? "border-red-500/40 bg-red-50/60 dark:bg-red-950/30"
                                : "bg-muted/20"
                            }`}
                            data-testid={`alerter-channel-${ch.channel}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium uppercase">{ch.channel}</span>
                              <Badge
                                variant={ch.alerting ? "warning" : "success"}
                                className={
                                  ch.alerting
                                    ? "bg-red-100 text-red-800"
                                    : undefined
                                }
                                data-testid={`alerter-channel-${ch.channel}-flag`}
                              >
                                {ch.alerting ? "Alerting" : "Clear"}
                              </Badge>
                            </div>
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <div className="flex justify-between gap-2">
                                <span>Last fire</span>
                                <span
                                  className="font-medium text-foreground"
                                  data-testid={`alerter-channel-${ch.channel}-last-fire`}
                                  title={ch.lastFireAt ?? undefined}
                                >
                                  {ch.lastFireAt
                                    ? `${lastFireRel ?? new Date(ch.lastFireAt).toLocaleString()}`
                                    : "never"}
                                </span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span>Last clear</span>
                                <span
                                  className="font-medium text-foreground"
                                  data-testid={`alerter-channel-${ch.channel}-last-clear`}
                                  title={ch.lastClearAt ?? undefined}
                                >
                                  {ch.lastClearAt
                                    ? `${lastClearRel ?? new Date(ch.lastClearAt).toLocaleString()}`
                                    : "never"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium flex items-center gap-2">
                          <Hourglass className="w-4 h-4" />
                          Active throttle slots
                        </h3>
                        <Badge variant="outline" className="font-normal" data-testid="alerter-throttle-count">
                          {alerterHealth.throttles.length}
                        </Badge>
                      </div>
                      {alerterHealth.throttles.length === 0 ? (
                        <p
                          className="text-xs text-muted-foreground italic"
                          data-testid="alerter-throttles-empty"
                        >
                          No delivery channels are currently throttled.
                          {alerterHealth.throttleSource === "memory" && (
                            <> Showing per-instance state; cluster-wide throttles may differ.</>
                          )}
                        </p>
                      ) : (
                        <div className="overflow-x-auto" data-testid="alerter-throttles-table">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                              <tr>
                                <th className="text-left font-medium px-3 py-1.5">Queue</th>
                                <th className="text-left font-medium px-3 py-1.5">Delivery</th>
                                <th className="text-left font-medium px-3 py-1.5">Kind</th>
                                <th className="text-right font-medium px-3 py-1.5">Remaining</th>
                                <th className="text-right font-medium px-3 py-1.5">Expires</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {alerterHealth.throttles.map((slot) => {
                                const expiresLabel = (() => {
                                  const d = new Date(slot.expiresAt);
                                  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
                                })();
                                const slotKey = `${slot.queueChannel}-${slot.deliveryChannel}-${slot.kind}`;
                                return (
                                  <tr
                                    key={slotKey}
                                    className="hover:bg-muted/20"
                                    data-testid={`alerter-throttle-row-${slotKey}`}
                                  >
                                    <td className="px-3 py-1.5 text-xs">{slot.queueChannel}</td>
                                    <td className="px-3 py-1.5">
                                      <Badge variant="outline" className="text-[10px]">
                                        {slot.deliveryChannel}
                                      </Badge>
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <Badge variant="secondary" className="text-[10px]">
                                        {slot.kind}
                                      </Badge>
                                    </td>
                                    <td
                                      className="px-3 py-1.5 text-right text-xs font-medium"
                                      data-testid={`alerter-throttle-remaining-${slotKey}`}
                                    >
                                      {formatThrottleRemaining(slot.expiresAt)}
                                    </td>
                                    <td
                                      className="px-3 py-1.5 text-right text-xs text-muted-foreground"
                                      title={slot.expiresAt}
                                    >
                                      {expiresLabel}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell className="w-4 h-4" />
                  On-call alert deliveries
                  <Badge variant="outline" className="ml-2 font-normal">last {ALERT_EVENTS_LIMIT}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Each row is a single PagerDuty / ops email / Slack delivery attempt the alerter made when the queue
                  started or stopped bypassing Redis. Click an event to open the matching audit log entry.
                </p>
                <div className="mt-3 space-y-2" data-testid="alert-events-filters">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase text-muted-foreground mr-1">Outcome</span>
                    {ALERT_OUTCOME_VALUES.map((value) => {
                      const active = alertOutcomeFilter === value;
                      return (
                        <Button
                          key={value}
                          type="button"
                          variant={active ? "default" : "outline"}
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          aria-pressed={active}
                          onClick={() => updateAlertFilter("alertOutcome", active ? null : value)}
                          data-testid={`filter-alert-outcome-${value}`}
                        >
                          {value}
                        </Button>
                      );
                    })}
                    {alertOutcomeFilter && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => updateAlertFilter("alertOutcome", null)}
                        data-testid="filter-alert-outcome-clear"
                      >
                        <X className="w-3 h-3 mr-1" />Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase text-muted-foreground mr-1">Channel</span>
                    {ALERT_CHANNEL_VALUES.map((value) => {
                      const active = alertChannelFilter === value;
                      return (
                        <Button
                          key={value}
                          type="button"
                          variant={active ? "default" : "outline"}
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          aria-pressed={active}
                          onClick={() => updateAlertFilter("alertChannel", active ? null : value)}
                          data-testid={`filter-alert-channel-${value}`}
                        >
                          {value}
                        </Button>
                      );
                    })}
                    {alertChannelFilter && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => updateAlertFilter("alertChannel", null)}
                        data-testid="filter-alert-channel-clear"
                      >
                        <X className="w-3 h-3 mr-1" />Clear
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {alertStats && (
                  <div
                    className="px-4 py-2 border-b bg-muted/20 text-xs flex flex-wrap items-center gap-x-3 gap-y-1"
                    data-testid="alert-events-summary"
                  >
                    <span className="text-muted-foreground">
                      {formatAlertStatsWindow(alertStats.windowMs)}:
                    </span>
                    <span data-testid="alert-stats-sent">
                      <span className="font-medium">{alertStats.sent}</span>
                      <span className="text-muted-foreground"> sent</span>
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span
                      className={alertStats.failed > 0 ? "text-red-600" : ""}
                      data-testid="alert-stats-failed"
                    >
                      <span className="font-medium">{alertStats.failed}</span>
                      <span className={alertStats.failed > 0 ? "text-red-600/80" : "text-muted-foreground"}> failed</span>
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span data-testid="alert-stats-throttled">
                      <span className="font-medium">{alertStats.throttled}</span>
                      <span className="text-muted-foreground"> throttled</span>
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span data-testid="alert-stats-skipped">
                      <span className="font-medium">{alertStats.skipped}</span>
                      <span className="text-muted-foreground"> skipped</span>
                    </span>
                    {alertStats.unknown > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span data-testid="alert-stats-unknown">
                          <span className="font-medium">{alertStats.unknown}</span>
                          <span className="text-muted-foreground"> unknown</span>
                        </span>
                      </>
                    )}
                    {alertStats.total === 0 && (
                      <span className="text-muted-foreground italic" data-testid="alert-stats-quiet">
                        — no alerts dispatched
                      </span>
                    )}
                  </div>
                )}
                {alertEventsLoading && alertEvents.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm" data-testid="alert-events-loading">Loading recent alert deliveries...</div>
                ) : alertEventsError ? (
                  <div className="p-6 text-center text-sm text-red-600" data-testid="alert-events-error">{alertEventsError}</div>
                ) : alertEvents.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm" data-testid="alert-events-empty">
                    {alertOutcomeFilter || alertChannelFilter
                      ? "No alert deliveries match the current filter."
                      : "No on-call alerts have been dispatched yet."}
                  </div>
                ) : (
                  <div className="overflow-x-auto" data-testid="alert-events-table">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-4 py-2">When</th>
                          <th className="text-left font-medium px-4 py-2">Channel</th>
                          <th className="text-left font-medium px-4 py-2">Queue / Kind</th>
                          <th className="text-left font-medium px-4 py-2">Outcome</th>
                          <th className="text-left font-medium px-4 py-2">Reason</th>
                          <th className="text-right font-medium px-4 py-2">Audit row</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {alertEvents.map((event) => {
                          const ts = event.createdAt ? new Date(event.createdAt) : null;
                          const tsLabel = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : "Unknown";
                          const outcomeVariant: "default" | "success" | "warning" | "secondary" | "outline" =
                            event.outcome === "sent"
                              ? "success"
                              : event.outcome === "failed"
                                ? "warning"
                                : event.outcome === "throttled"
                                  ? "outline"
                                  : event.outcome === "skipped"
                                    ? "secondary"
                                    : "outline";
                          return (
                            <tr key={event.id} className="hover:bg-muted/20" data-testid={`alert-event-row-${event.id}`}>
                              <td className="px-4 py-2 whitespace-nowrap text-xs">{tsLabel}</td>
                              <td className="px-4 py-2">
                                {event.deliveryChannel ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    {event.deliveryChannel}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">unknown</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs">
                                <span>{event.queueChannel ?? "—"}</span>
                                {event.kind && (
                                  <Badge variant="secondary" className="ml-2 text-[10px]">
                                    {event.kind}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                {event.outcome ? (
                                  <Badge variant={outcomeVariant} className="text-[10px]" data-testid={`alert-event-outcome-${event.id}`}>
                                    {event.outcome}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">unknown</span>
                                )}
                              </td>
                              <td className="px-4 py-2 max-w-[14rem] truncate text-xs" title={event.reason ?? ""}>
                                {event.reason ?? <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <Link
                                  href={`/admin/audit-log?actionType=queue_fallback_alert&entityType=alert&expand=${event.id}`}
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                  data-testid={`link-alert-audit-${event.id}`}
                                >
                                  #{event.id}
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="w-4 h-4" />Memory Usage</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {health.memoryUsage && Object.entries(health.memoryUsage).map(([key, value]) => (
                    <div key={key} className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-lg font-bold">{formatBytes(value as number)}</p>
                      <p className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
