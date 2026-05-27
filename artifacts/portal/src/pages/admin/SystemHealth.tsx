import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Database, Globe, Server, Webhook, RefreshCw, Zap, ExternalLink, ListChecks, ShieldCheck, Pause, Play, Brush, Bell, BellOff, Archive, KeyRound, Volume2, VolumeX, X, Siren, Hourglass, History, Send, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
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
  // Raw audit-log metadata payload — used by the inline expand-in-place row
  // so an on-call admin investigating a flagged delivery can see the full
  // reason text and channel-specific identifiers without leaving the
  // System Health page. Server may omit on older deployments.
  metadata?: Record<string, unknown> | null;
}

interface QueueFallbackAlertChannelStats {
  sent: number;
  failed: number;
  throttled: number;
  skipped: number;
  unknown: number;
  total: number;
}

type AlertStatsChannelKey = "pagerduty" | "email" | "slack" | "unknown";

interface QueueFallbackAlertStats {
  windowMs: number;
  sent: number;
  failed: number;
  throttled: number;
  skipped: number;
  unknown: number;
  total: number;
  byChannel?: Record<AlertStatsChannelKey, QueueFallbackAlertChannelStats>;
}

const ALERT_CHANNEL_DISPLAY_LABELS: Record<AlertStatsChannelKey, string> = {
  pagerduty: "PagerDuty",
  email: "Email",
  slack: "Slack",
  unknown: "Unknown",
};

// Render the per-channel breakdown of failures next to the "N failed" line:
//   • single channel  → "PagerDuty"           (count is implied by parent)
//   • multiple        → "2 PagerDuty, 1 Slack"
// Returns null when there's nothing to show so the caller can omit the
// parenthetical entirely.
function formatFailedByChannel(
  byChannel: QueueFallbackAlertStats["byChannel"],
): string | null {
  if (!byChannel) return null;
  const entries = (Object.keys(byChannel) as AlertStatsChannelKey[])
    .map((key) => ({ key, count: byChannel[key]?.failed ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (entries.length === 0) return null;
  if (entries.length === 1) return ALERT_CHANNEL_DISPLAY_LABELS[entries[0].key];
  return entries
    .map((e) => `${e.count} ${ALERT_CHANNEL_DISPLAY_LABELS[e.key]}`)
    .join(", ");
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

type OnCallField = "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl";

interface OnCallHistoryEvent {
  id: number;
  createdAt: string;
  actionType: string;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  description: string;
  changedFields: OnCallField[];
  testResults: Array<{
    channel: "pagerduty" | "email" | "slack";
    ok: boolean;
    skipped: boolean;
    reason: string | null;
  }>;
}

const ONCALL_FIELD_LABELS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "PagerDuty key",
  opsAlertEmail: "Ops alert email",
  opsAlertSlackWebhookUrl: "Slack webhook",
};

const ONCALL_CHANNEL_LABELS: Record<"pagerduty" | "email" | "slack", string> = {
  pagerduty: "PagerDuty",
  email: "Email",
  slack: "Slack",
};

function oncallActorDisplay(event: OnCallHistoryEvent): string {
  if (event.actorName && event.actorEmail) return `${event.actorName} (${event.actorEmail})`;
  if (event.actorName) return event.actorName;
  if (event.actorEmail) return event.actorEmail;
  return "System";
}

const FALLBACK_EVENTS_LIMIT = 50;
const ALERT_EVENTS_LIMIT = 20;
const ONCALL_HISTORY_LIMIT = 20;
const AUTO_REFRESH_INTERVAL_MS = 30_000;
const NEW_EVENT_HIGHLIGHT_MS = 6_000;
const FALLBACK_SOUND_PREF_KEY = "systemHealth.fallbackSoundEnabled";
const FALLBACK_NOTIFY_PREF_KEY = "systemHealth.fallbackNotifyEnabled";
const FALLBACK_CHIME_VOLUME = 0.4;
// Per-beep peak gain for the synthesised two-tone "ding-ding" used when a
// fresh failed/throttled on-call alert delivery row appears. Kept lower than
// FALLBACK_CHIME_VOLUME because two stacked WebAudio beeps subjectively read
// louder than a single short wav at the same nominal volume — and because the
// pitched-higher tone is itself more attention-grabbing than the soft fallback
// chime, so we don't need to crank the gain to make it noticeable.
const ALERT_CHIME_VOLUME = 0.18;

// Some older browsers (and a few mobile WebViews) only expose AudioContext
// under the prefixed `webkitAudioContext` name. We declare a narrow typed view
// of that so `playAlertChime` can pick whichever the browser exposes without
// resorting to `any` casts.
interface WindowWithWebkitAudio {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

// Allow-list mirrors the server's accepted statsWindowMs values. Changing
// these here without updating the server allow-list will silently fall back
// to the 1h default.
const ALERT_STATS_WINDOW_1H_MS = 60 * 60 * 1000;
const ALERT_STATS_WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const ALERT_STATS_WINDOW_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: ALERT_STATS_WINDOW_1H_MS, label: "1h" },
  { ms: ALERT_STATS_WINDOW_24H_MS, label: "24h" },
];
const ALERT_STATS_WINDOW_PREF_KEY = "systemHealth.alertStatsWindowMs";

function readAlertStatsWindowPreference(): number {
  if (typeof window === "undefined") return ALERT_STATS_WINDOW_1H_MS;
  try {
    const raw = window.localStorage.getItem(ALERT_STATS_WINDOW_PREF_KEY);
    if (!raw) return ALERT_STATS_WINDOW_1H_MS;
    const parsed = Number.parseInt(raw, 10);
    if (ALERT_STATS_WINDOW_OPTIONS.some((opt) => opt.ms === parsed)) return parsed;
    return ALERT_STATS_WINDOW_1H_MS;
  } catch {
    return ALERT_STATS_WINDOW_1H_MS;
  }
}

function readSoundPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FALLBACK_SOUND_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function readNotifyPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FALLBACK_NOTIFY_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

// "unsupported" covers SSR and the (rare) browser without the Notifications
// API; otherwise we mirror the standard Notification.permission tri-state so
// the toggle UI can show an inline hint when the user has previously denied.
type NotifyPermissionState = NotificationPermission | "unsupported";

function readNotificationPermission(): NotifyPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

export default function SystemHealth() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [yseGrantSummary, setYseGrantSummary] = useState<{
    pending: number;
    terminal: number;
  } | null>(null);
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
  const [oncallHistory, setOncallHistory] = useState<OnCallHistoryEvent[]>([]);
  const [oncallHistoryLoading, setOncallHistoryLoading] = useState(true);
  const [oncallHistoryError, setOncallHistoryError] = useState<string | null>(null);
  // Click-to-expand row id for the on-call destinations history table.
  // Keeps the table compact by default — actor + changed-fields chips are
  // visible at a glance, and the full description / probe results / exact
  // timestamp are revealed on click for the row an admin is investigating.
  const [expandedOncallEventId, setExpandedOncallEventId] = useState<number | null>(null);
  // Click-to-expand row id for the on-call alert deliveries table. Lets an
  // admin investigating a flagged delivery see the full reason text and raw
  // metadata (delivery-channel-specific identifiers, recent/hour/day counts,
  // etc.) without leaving the System Health workflow. Lives outside the
  // table data so it survives the silent auto-refresh that re-fetches
  // `alertEvents` every 30s — the expanded row stays open as long as the
  // same id is still present.
  const [expandedAlertEventId, setExpandedAlertEventId] = useState<number | null>(null);
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
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() => readNotifyPreference());
  const [notificationPermission, setNotificationPermission] = useState<NotifyPermissionState>(
    () => readNotificationPermission(),
  );
  // Rolling window the on-call alert summary uses. Persisted in localStorage
  // so an admin who flipped to "24h" the night before still sees overnight
  // numbers when they come back in the morning.
  const [alertStatsWindowMs, setAlertStatsWindowMs] = useState<number>(() => readAlertStatsWindowPreference());
  const inFlightRef = useRef(0);
  const previousMaxEventIdRef = useRef<number | null>(null);
  const hasLoadedFallbackEventsRef = useRef(false);
  // Mirrors the fallback-event tracking refs but for the on-call alert
  // deliveries table — only urgent rows (`failed` / `throttled`) feed into
  // this so the sharper alert chime stays reserved for actually-bad outcomes.
  const previousMaxUrgentAlertIdRef = useRef<number | null>(null);
  const hasLoadedAlertEventsRef = useRef(false);
  const highlightTimersRef = useRef<Map<number, number>>(new Map());
  const recentNewCountTimerRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const notifyEnabledRef = useRef(notifyEnabled);
  const notificationPermissionRef = useRef(notificationPermission);
  const chimeAudioRef = useRef<HTMLAudioElement | null>(null);
  // Lazy-created AudioContext used to synthesise the two-tone alert chime.
  // Created on the first attempted play so we never spin one up for admins
  // who keep sound off, and closed on unmount.
  const alertAudioCtxRef = useRef<AudioContext | null>(null);
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

  useEffect(() => {
    notifyEnabledRef.current = notifyEnabled;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FALLBACK_NOTIFY_PREF_KEY, notifyEnabled ? "1" : "0");
    } catch {
      // ignore — non-fatal if storage is unavailable
    }
  }, [notifyEnabled]);

  useEffect(() => {
    notificationPermissionRef.current = notificationPermission;
  }, [notificationPermission]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ALERT_STATS_WINDOW_PREF_KEY, String(alertStatsWindowMs));
    } catch {
      // ignore — non-fatal if storage is unavailable
    }
  }, [alertStatsWindowMs]);

  // Show a desktop notification when new fallback rows arrive while the tab
  // is hidden — pairs with the audible chime so an admin still notices the
  // event when the OS volume or tab is muted, or when they're in another
  // app entirely. Only fires when the toggle is on, permission is granted,
  // and the page is actually backgrounded.
  const showFallbackNotification = useCallback((count: number) => {
    if (count <= 0) return;
    if (!notifyEnabledRef.current) return;
    if (typeof window === "undefined") return;
    if (typeof document !== "undefined" && !document.hidden) return;
    if (typeof Notification === "undefined") return;
    if (notificationPermissionRef.current !== "granted") return;
    try {
      const body = count === 1
        ? "1 new queue-fallback event"
        : `${count} new queue-fallback events`;
      const notif = new Notification("System Health", {
        body,
        // Replacing the previous notification keeps the OS tray tidy when a
        // burst of refreshes each surface a few new rows.
        tag: "system-health-fallback-events",
      });
      notif.onclick = () => {
        try {
          window.focus();
          notif.close();
        } catch {
          // ignore — clicking through is best-effort
        }
      };
    } catch {
      // ignore — notifications are purely a nice-to-have
    }
  }, []);

  // Toggle handler for the "Notify" button. Enabling the toggle for the
  // first time prompts the browser permission dialog; if the user denies
  // we still leave the preference enabled (so the inline hint can appear)
  // and showFallbackNotification will simply no-op until permission is
  // granted at the OS / browser level.
  const handleToggleNotify = useCallback(async () => {
    const next = !notifyEnabledRef.current;
    if (!next) {
      setNotifyEnabled(false);
      return;
    }
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      setNotifyEnabled(true);
      return;
    }
    if (Notification.permission === "default") {
      try {
        const result = await Notification.requestPermission();
        setNotificationPermission(result);
      } catch {
        // Some older browsers throw on the promise form; fall back to
        // whatever permission state the browser currently reports.
        try {
          setNotificationPermission(Notification.permission);
        } catch {
          setNotificationPermission("unsupported");
        }
      }
    } else {
      setNotificationPermission(Notification.permission);
    }
    setNotifyEnabled(true);
  }, []);

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

  // Sharper "ding-ding" used for fresh failed/throttled on-call alert
  // deliveries. Synthesised via WebAudio so we don't ship a second wav asset
  // and so the tone is obviously distinct from the soft fallback chime.
  const playAlertChime = useCallback(() => {
    if (!soundEnabledRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const win = window as unknown as WindowWithWebkitAudio;
      const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
      if (!AudioCtx) return;
      if (!alertAudioCtxRef.current) {
        alertAudioCtxRef.current = new AudioCtx();
      }
      const ctx = alertAudioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {
          // Auto-play policy can keep the context suspended until a user
          // gesture; the sound toggle itself counts, so subsequent plays work.
        });
      }
      const playBeep = (startOffset: number, frequency: number, duration: number) => {
        const start = ctx.currentTime + startOffset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(ALERT_CHIME_VOLUME, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      };
      // Two short, climbing beeps — clearly distinct from the single soft
      // fallback chime and noticeably more attention-grabbing.
      playBeep(0, 880, 0.16);
      playBeep(0.2, 1175, 0.2);
    } catch {
      // ignore — playback is purely a nice-to-have
    }
  }, []);

  // Tear the alert AudioContext down on unmount so we don't leak audio
  // resources if the admin navigates away after enabling sound.
  useEffect(() => {
    return () => {
      const ctx = alertAudioCtxRef.current;
      if (ctx && typeof ctx.close === "function") {
        ctx.close().catch(() => {
          // ignore
        });
      }
      alertAudioCtxRef.current = null;
    };
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

  // Count pending vs. terminal-failed YSE grants so on-call can see at a
  // glance whether any paying customer is still waiting for portal access.
  // Failures here are silent because this card is a sidecar to the main
  // health snapshot, not load-bearing for the rest of the page.
  const loadYseGrantSummary = useCallback(async () => {
    try {
      // Request the backend's max (500) so counts on the System Health
      // card don't underreport against a large backlog.
      const data = await adminPanelApi.getYsePendingGrants(500);
      const terminal = data.items.filter((i) => i.terminal).length;
      setYseGrantSummary({
        pending: data.items.length - terminal,
        terminal,
      });
    } catch {
      // ignore — card hides its numbers and surfaces a dashed value
    }
  }, []);

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
          showFallbackNotification(newIds.length);
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
  }, [markEventsAsNew, playFallbackChime, showFallbackNotification]);

  const loadAlertEvents = useCallback(async (silent = false) => {
    try {
      if (!silent) setAlertEventsLoading(true);
      const data = await adminPanelApi.getQueueFallbackAlertEvents(ALERT_EVENTS_LIMIT, {
        outcome: alertOutcomeFilter,
        deliveryChannel: alertChannelFilter,
        statsWindowMs: alertStatsWindowMs,
      });
      const events: QueueFallbackAlertEvent[] = Array.isArray(data?.events) ? data.events : [];
      setAlertEvents(events);
      setAlertStats(data?.stats && typeof data.stats === "object" ? (data.stats as QueueFallbackAlertStats) : null);
      setAlertEventsError(null);

      // Watch only the urgent outcomes — `failed` (the page didn't reach the
      // on-call human) and `throttled` (the page was suppressed). After the
      // first successful load establishes the baseline, any subsequent load
      // that introduces an urgent row with a higher id triggers the alert
      // chime. The `hasLoaded…` guard prevents the chime on first page load
      // and on re-loads triggered by filter changes (see resetting effect).
      const urgentIds = events
        .filter((e) => e.outcome === "failed" || e.outcome === "throttled")
        .map((e) => e.id);
      const newMaxUrgentId = urgentIds.reduce((max, id) => (id > max ? id : max), 0);
      if (hasLoadedAlertEventsRef.current && previousMaxUrgentAlertIdRef.current !== null) {
        const prevMax = previousMaxUrgentAlertIdRef.current;
        const hasNewUrgent = urgentIds.some((id) => id > prevMax);
        if (hasNewUrgent) {
          playAlertChime();
        }
      }
      previousMaxUrgentAlertIdRef.current = newMaxUrgentId;
      hasLoadedAlertEventsRef.current = true;

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
  }, [alertOutcomeFilter, alertChannelFilter, alertStatsWindowMs, playAlertChime]);

  // Reset alert-event "what's new" tracking whenever the active filter or
  // stats window changes. Without this, switching from e.g. `sent` to
  // `failed` — or expanding the window from 1h to 24h — could be mistaken
  // for "new failed rows arrived" and spuriously chime.
  useEffect(() => {
    hasLoadedAlertEventsRef.current = false;
    previousMaxUrgentAlertIdRef.current = null;
    // Also collapse any inline-expanded row when the active filter changes
    // — otherwise an admin who narrows from "all" to "failed" could be
    // staring at an expanded row whose parent has just been filtered out
    // of the table (the detail panel would still render, looking orphaned).
    setExpandedAlertEventId(null);
  }, [alertOutcomeFilter, alertChannelFilter, alertStatsWindowMs]);

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

  const loadOnCallHistory = useCallback(async (silent = false) => {
    try {
      if (!silent) setOncallHistoryLoading(true);
      const data = await adminPanelApi.getOnCallDestinationsHistory(ONCALL_HISTORY_LIMIT);
      setOncallHistory(Array.isArray(data?.events) ? (data.events as OnCallHistoryEvent[]) : []);
      setOncallHistoryError(null);
      return true;
    } catch (err: any) {
      if (silent) {
        return false;
      }
      setOncallHistoryError(err?.message ?? "Failed to load on-call destination history");
      return false;
    } finally {
      if (!silent) setOncallHistoryLoading(false);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current > 0) return;
    inFlightRef.current += 1;
    setRefreshInFlight(inFlightRef.current);
    try {
      const [healthOk, eventsOk, alertEventsOk, alerterHealthOk, oncallHistoryOk] = await Promise.all([
        loadHealth(silent),
        loadFallbackEvents(silent),
        loadAlertEvents(silent),
        loadAlerterHealth(silent),
        loadOnCallHistory(silent),
        loadYseGrantSummary(),
      ]);
      const allOk = healthOk && eventsOk && alertEventsOk && alerterHealthOk && oncallHistoryOk;
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
  }, [loadHealth, loadFallbackEvents, loadAlertEvents, loadAlerterHealth, loadOnCallHistory, loadYseGrantSummary]);

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
                  ? "Sound on — chime when new fallback events arrive, sharper alert tone for failed/throttled on-call deliveries"
                  : "Sound off — no chime for fallback events or failed/throttled on-call deliveries"
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
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void handleToggleNotify();
                }}
                data-testid="button-toggle-fallback-notify"
                aria-pressed={notifyEnabled}
                title={
                  notifyEnabled
                    ? "Desktop notifications on — a short notification fires when new fallback events arrive while this tab is in the background"
                    : "Desktop notifications off — fallback events will only highlight in the table"
                }
              >
                {notifyEnabled ? (
                  <>
                    <Bell className="w-4 h-4 mr-1" />Notify on
                  </>
                ) : (
                  <>
                    <BellOff className="w-4 h-4 mr-1" />Notify off
                  </>
                )}
              </Button>
              {notifyEnabled && notificationPermission !== "granted" && (
                <span
                  className="text-xs text-amber-600 inline-flex items-center gap-1"
                  data-testid="notify-permission-hint"
                  title={
                    notificationPermission === "denied"
                      ? "Your browser is blocking notifications for this site. Update the site permission to re-enable them."
                      : notificationPermission === "unsupported"
                        ? "This browser does not support desktop notifications."
                        : "Click Notify on to allow notifications."
                  }
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {notificationPermission === "denied"
                      ? "blocked — chime only"
                      : notificationPermission === "unsupported"
                        ? "unsupported — chime only"
                        : "permission needed"}
                  </span>
                </span>
              )}
            </div>
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
                      an audit-log row in the last 24h
                      {Array.isArray(health.services.rateLimitAuditFailures.pods)
                        && health.services.rateLimitAuditFailures.pods.length > 0
                        && health.services.rateLimitAuditFailures.source === "redis"
                        ? ` across ${health.services.rateLimitAuditFailures.pods.length} pod${health.services.rateLimitAuditFailures.pods.length === 1 ? "" : "s"}`
                        : ""}
                      {health.services.rateLimitAuditFailures.source === "memory"
                        ? " (showing this pod only — Redis is unavailable so the cluster total may be higher)"
                        : ""}. The Audit Log will
                      under-report attacks until the underlying write error clears.
                      Check database health and recent server logs for{" "}
                      <code>[AbuseRateLimit][AuditFailure]</code>.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {(health.services?.moderationFailures as { alerter?: { alerting?: boolean } } | undefined)?.alerter?.alerting && (() => {
              const mf = health.services.moderationFailures as {
                window: { totalCount: number; byKind: { engine: number; persist: number }; windowMs: number; lastError: string | null; lastKind: "engine" | "persist" | null };
                cumulative: { totalCount: number };
              };
              const minutes = Math.max(1, Math.round((mf.window.windowMs ?? 0) / 60000));
              return (
                <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30" data-testid="moderation-failures-banner">
                  <CardContent className="py-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium text-red-900 dark:text-red-200">
                        Background moderation jobs are failing
                      </p>
                      <p className="text-sm text-red-800/80 dark:text-red-200/80">
                        {mf.window.totalCount} failure{mf.window.totalCount === 1 ? "" : "s"} in
                        the last {minutes}m
                        {mf.window.byKind.persist > 0
                          ? ` (${mf.window.byKind.persist} persist — flagged content may still be publicly active)`
                          : mf.window.byKind.engine > 0
                            ? ` (${mf.window.byKind.engine} engine — content may have slipped through unevaluated)`
                            : ""}.
                        On-call has been paged. See the "Background moderation failures" card
                        below and search logs for <code>[Moderation][Failure]</code>.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {Array.isArray(health.services?.missingCriticalSecrets) && health.services.missingCriticalSecrets.length > 0 && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30" data-testid="missing-critical-secrets-banner">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      {(() => {
                        const list = health.services.missingCriticalSecrets as Array<{ state?: string }>;
                        const defaultedCount = list.filter((s) => s.state === "defaulted").length;
                        const unsetCount = list.length - defaultedCount;
                        const parts: string[] = [];
                        if (defaultedCount > 0) {
                          parts.push(
                            defaultedCount === 1
                              ? "1 defaulted"
                              : `${defaultedCount} defaulted`,
                          );
                        }
                        if (unsetCount > 0) {
                          parts.push(
                            unsetCount === 1 ? "1 unset" : `${unsetCount} unset`,
                          );
                        }
                        const breakdown = parts.length > 0 ? ` (${parts.join(", ")})` : "";
                        return list.length === 1
                          ? `1 production secret is unset or defaulted${breakdown}`
                          : `${list.length} production secrets are unset or defaulted${breakdown}`;
                      })()}
                    </p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      On-call has been paged. See the "Production secrets" card below for the
                      affected env vars and remediation details.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {(health.services?.portalUrl as { productionFallbackMissing?: boolean } | undefined)?.productionFallbackMissing && (
              <Card className="border-red-500/40 bg-red-50 dark:bg-red-950/30" data-testid="portal-url-unconfigured-banner">
                <CardContent className="py-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium text-red-900 dark:text-red-200">
                      Portal URL is not configured
                    </p>
                    <p className="text-sm text-red-800/80 dark:text-red-200/80">
                      No per-tenant portal URL is set and the <code>PORTAL_URL</code>{" "}
                      env var is empty. Branded emails that include a portal link
                      (password resets, email verifications) are being{" "}
                      <strong>skipped</strong> instead of going out with a broken
                      link. Save a value at{" "}
                      <Link href="/admin/settings" className="underline">
                        Admin → Settings → Branding
                      </Link>{" "}
                      (key{" "}
                      <code>
                        {(health.services.portalUrl as { settingKey?: string } | undefined)
                          ?.settingKey ?? "branding.portal_url"}
                      </code>
                      ) or set the <code>PORTAL_URL</code> env var to restore
                      delivery.
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

              <Card
                data-testid="card-yse-grant-failures"
                className={
                  yseGrantSummary && yseGrantSummary.terminal > 0
                    ? "border-red-500/40 bg-red-50/40 dark:bg-red-950/20"
                    : undefined
                }
              >
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />YSE Grant Deliveries
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Pending (retrying)</span>
                      <span
                        className={`text-sm font-medium ${yseGrantSummary && yseGrantSummary.pending > 0 ? "text-amber-600" : ""}`}
                        data-testid="text-yse-pending-count"
                      >
                        {yseGrantSummary ? yseGrantSummary.pending : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Terminal failures</span>
                      <span
                        className={`text-sm font-medium ${yseGrantSummary && yseGrantSummary.terminal > 0 ? "text-red-600" : ""}`}
                        data-testid="text-yse-terminal-count"
                      >
                        {yseGrantSummary ? yseGrantSummary.terminal : "—"}
                      </span>
                    </div>
                    <Link
                      href="/admin/integrations/yse/failures"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="link-yse-grant-failures"
                    >
                      View details <ExternalLink className="w-3 h-3" />
                    </Link>
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
                            state?: "unset" | "defaulted";
                          }>).map((secret) => {
                            const isDefaulted = secret.state === "defaulted";
                            return (
                            <li
                              key={secret.id}
                              className="space-y-1 border-l-2 border-red-500/60 pl-3"
                              data-testid={`missing-critical-secret-${secret.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <code className="text-xs font-semibold">{secret.envVar}</code>
                                {isDefaulted ? (
                                  <span
                                    className="inline-flex items-center rounded-full border border-transparent bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                    title="Env var is set to a known placeholder default — rotate any tokens or sessions issued under it."
                                    data-testid={`missing-critical-secret-state-${secret.id}`}
                                  >
                                    defaulted
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center rounded-full border border-transparent bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                    title="Env var is not set on the server."
                                    data-testid={`missing-critical-secret-state-${secret.id}`}
                                  >
                                    unset
                                  </span>
                                )}
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
                            );
                          })}
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

              {health.services?.upgradePromptEventsCleanup && (() => {
                const upe = health.services.upgradePromptEventsCleanup as {
                  intervalMs: number;
                  retentionDays: number;
                  lastRanAt: string | null;
                  lastDeletedCount: number | null;
                  lastError: { at: string; message: string } | null;
                  stale: boolean;
                };
                const lastRanLabel = upe.lastRanAt
                  ? new Date(upe.lastRanAt).toLocaleString()
                  : "Never";
                const intervalLabel = upe.intervalMs >= 60 * 60 * 1000
                  ? `${Math.round(upe.intervalMs / (60 * 60 * 1000))}h`
                  : upe.intervalMs >= 60 * 1000
                    ? `${Math.round(upe.intervalMs / 60000)}m`
                    : `${Math.round(upe.intervalMs / 1000)}s`;
                const statusLabel = upe.stale
                  ? "Stale"
                  : upe.lastRanAt
                    ? "Healthy"
                    : "Pending";
                const statusVariant: "default" | "warning" | "secondary" = upe.stale
                  ? "warning"
                  : upe.lastRanAt
                    ? "default"
                    : "secondary";
                return (
                  <Card data-testid="card-upgrade-prompt-events-cleanup">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brush className="w-4 h-4" />Upgrade-prompt analytics retention
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Status</span>
                          <Badge
                            variant={statusVariant}
                            data-testid="upgrade-prompt-events-cleanup-status"
                          >
                            {statusLabel}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Retention window</span>
                          <span
                            className="text-sm font-medium"
                            data-testid="upgrade-prompt-events-cleanup-retention"
                          >
                            {upe.retentionDays}d
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Run interval</span>
                          <span
                            className="text-sm font-medium"
                            data-testid="upgrade-prompt-events-cleanup-interval"
                          >
                            {intervalLabel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last run</span>
                          <span
                            className={`text-sm font-medium ${upe.stale ? "text-red-600" : ""}`}
                            data-testid="upgrade-prompt-events-cleanup-last-ran"
                          >
                            {lastRanLabel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Rows deleted last run</span>
                          <span
                            className="text-sm font-medium"
                            data-testid="upgrade-prompt-events-cleanup-deleted"
                          >
                            {upe.lastDeletedCount ?? 0}
                          </span>
                        </div>
                        {upe.stale && (
                          <p
                            className="text-xs text-red-600"
                            data-testid="upgrade-prompt-events-cleanup-stale-warning"
                          >
                            {upe.lastRanAt
                              ? `Sweep hasn't reported in over 2× its ${intervalLabel} interval — the cleanup job may have stopped. Upgrade-prompt analytics could grow past the ${upe.retentionDays}d window. Check the API server logs.`
                              : `Sweep hasn't reported a single run in over 2× its ${intervalLabel} interval since this server started — check the API server logs to confirm the job is running.`}
                          </p>
                        )}
                        {upe.lastError && (
                          <p
                            className="text-xs text-amber-700 dark:text-amber-300"
                            data-testid="upgrade-prompt-events-cleanup-last-error"
                            title={`Failed at ${new Date(upe.lastError.at).toLocaleString()}`}
                          >
                            Last sweep error: {upe.lastError.message}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {health.services?.emailChangeAttemptsCleanup && (() => {
                const ecc = health.services.emailChangeAttemptsCleanup as {
                  intervalMs: number;
                  lastRanAt: string | null;
                  lastDeletedCount: number | null;
                  lastError: { at: string; message: string } | null;
                  stale: boolean;
                };
                const lastRanLabel = ecc.lastRanAt
                  ? new Date(ecc.lastRanAt).toLocaleString()
                  : "Never";
                const intervalLabel = ecc.intervalMs >= 60 * 60 * 1000
                  ? `${Math.round(ecc.intervalMs / (60 * 60 * 1000))}h`
                  : ecc.intervalMs >= 60 * 1000
                    ? `${Math.round(ecc.intervalMs / 60000)}m`
                    : `${Math.round(ecc.intervalMs / 1000)}s`;
                const statusLabel = ecc.stale
                  ? "Stale"
                  : ecc.lastRanAt
                    ? "Healthy"
                    : "Pending";
                const statusVariant: "default" | "warning" | "secondary" = ecc.stale
                  ? "warning"
                  : ecc.lastRanAt
                    ? "default"
                    : "secondary";
                return (
                  <Card data-testid="card-email-change-attempts-cleanup">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brush className="w-4 h-4" />Email-change retention sweep
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Status</span>
                          <Badge
                            variant={statusVariant}
                            data-testid="email-change-cleanup-status"
                          >
                            {statusLabel}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Last run</span>
                          <span
                            className={`text-sm font-medium ${ecc.stale ? "text-red-600" : ""}`}
                            data-testid="email-change-cleanup-last-ran"
                          >
                            {lastRanLabel}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Rows deleted last run</span>
                          <span
                            className="text-sm font-medium"
                            data-testid="email-change-cleanup-deleted"
                          >
                            {ecc.lastDeletedCount ?? 0}
                          </span>
                        </div>
                        {ecc.stale && (
                          <p
                            className="text-xs text-red-600"
                            data-testid="email-change-cleanup-stale-warning"
                          >
                            {ecc.lastRanAt
                              ? `Sweep hasn't reported in over 2× its ${intervalLabel} interval — the cleanup job may have stopped. Retention windows could lapse. Check the API server logs.`
                              : `Sweep hasn't reported a single run in over 2× its ${intervalLabel} interval since this server started — check the API server logs to confirm the job is running.`}
                          </p>
                        )}
                        {ecc.lastError && (
                          <p
                            className="text-xs text-amber-700 dark:text-amber-300"
                            data-testid="email-change-cleanup-last-error"
                            title={`Failed at ${new Date(ecc.lastError.at).toLocaleString()}`}
                          >
                            Last sweep error: {ecc.lastError.message}
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

              {health.services?.machineMismatchDigest && (() => {
                interface MachineMismatchDigestStatus {
                  intervalMs: number;
                  lastRanAt: string | null;
                  lastOutcome:
                    | "sent"
                    | "skipped_no_mismatches"
                    | "skipped_no_recipient"
                    | "skipped_sendgrid_not_configured"
                    | "failed"
                    | null;
                  lastFlaggedCount: number | null;
                  lastRecipient: string | null;
                  lastReason: string | null;
                }
                const mmd = health.services.machineMismatchDigest as MachineMismatchDigestStatus;
                const now = Date.now();
                const lastRunMs = mmd.lastRanAt ? new Date(mmd.lastRanAt).getTime() : null;
                // Flag a stale heartbeat: no row in > 2× the run interval.
                // Mirrors the retention-sweep card's freshness check so on-call
                // gets a consistent signal across every background job.
                const staleThresholdMs = Math.max(mmd.intervalMs * 2, 1);
                const isStale =
                  lastRunMs === null
                    ? false
                    : now - lastRunMs > staleThresholdMs;
                const isFailed = mmd.lastOutcome === "failed";
                const flagged = isStale || isFailed;
                const intervalHours = Math.max(1, Math.round(mmd.intervalMs / (60 * 60 * 1000)));
                const intervalLabel = `${intervalHours}h`;
                const outcomeLabels: Record<NonNullable<MachineMismatchDigestStatus["lastOutcome"]>, string> = {
                  sent: "Sent",
                  skipped_no_mismatches: "Skipped — no mismatches",
                  skipped_no_recipient: "Skipped — no ops recipient",
                  skipped_sendgrid_not_configured: "Skipped — SendGrid not configured",
                  failed: "Failed",
                };
                const outcomeVariant: Record<NonNullable<MachineMismatchDigestStatus["lastOutcome"]>, "success" | "warning" | "outline"> = {
                  sent: "success",
                  skipped_no_mismatches: "outline",
                  skipped_no_recipient: "warning",
                  skipped_sendgrid_not_configured: "warning",
                  failed: "warning",
                };
                const fmtRunLabel = (iso: string | null) => {
                  if (!iso) return "Pending — digest has not reported a run yet";
                  const rel = formatRelativeTime(iso);
                  const abs = new Date(iso).toLocaleString();
                  return rel ? `${rel} (${abs})` : abs;
                };
                return (
                  <Card data-testid="card-machine-mismatch-digest">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Send className="w-4 h-4" />
                        Machine mismatch daily digest
                        <Badge variant="outline" className="ml-2 font-normal">
                          every {intervalLabel}
                        </Badge>
                        {isStale && (
                          <Badge
                            variant="warning"
                            className="ml-1"
                            data-testid="machine-mismatch-digest-stale-badge"
                          >
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Stale — no run in 2× interval
                          </Badge>
                        )}
                        {isFailed && (
                          <Badge
                            variant="warning"
                            className="ml-1"
                            data-testid="machine-mismatch-digest-failed-badge"
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Last run failed
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        Once per day, ops are emailed every Machine order whose granted
                        product slugs disagree with the portal_product_keys The Machine sent.
                        The heartbeat advances on every run — sent, suppressed, or failed —
                        so a job that stops firing surfaces here.
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div
                        className={`rounded-md border p-3 ${
                          flagged
                            ? isFailed
                              ? "border-red-500/40 bg-red-50 dark:bg-red-950/30"
                              : "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30"
                            : "border-border"
                        }`}
                        data-testid="machine-mismatch-digest-summary"
                      >
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Last run</span>
                            <span
                              className={`font-medium text-right ${mmd.lastRanAt ? "" : "text-muted-foreground italic"}`}
                              data-testid="machine-mismatch-digest-last-run"
                              title={mmd.lastRanAt ? new Date(mmd.lastRanAt).toLocaleString() : undefined}
                            >
                              {fmtRunLabel(mmd.lastRanAt)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Outcome</span>
                            <span
                              className="font-medium text-right"
                              data-testid="machine-mismatch-digest-outcome"
                            >
                              {mmd.lastOutcome ? (
                                <Badge variant={outcomeVariant[mmd.lastOutcome]}>
                                  {outcomeLabels[mmd.lastOutcome]}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground italic">—</span>
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Flagged orders</span>
                            <span
                              className="font-medium text-right"
                              data-testid="machine-mismatch-digest-flagged-count"
                            >
                              {mmd.lastFlaggedCount === null
                                ? "—"
                                : `${mmd.lastFlaggedCount} order${mmd.lastFlaggedCount === 1 ? "" : "s"}`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Recipient</span>
                            <span
                              className="font-medium text-right break-all"
                              data-testid="machine-mismatch-digest-recipient"
                            >
                              {mmd.lastRecipient ?? <span className="text-muted-foreground italic">—</span>}
                            </span>
                          </div>
                        </div>
                        {mmd.lastReason && (
                          <p
                            className={`mt-2 text-xs ${
                              isFailed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"
                            }`}
                            data-testid="machine-mismatch-digest-reason"
                          >
                            Reason: {mmd.lastReason}
                          </p>
                        )}
                        {isStale && (
                          <p
                            className="mt-2 text-xs text-amber-700 dark:text-amber-300"
                            data-testid="machine-mismatch-digest-stale-detail"
                          >
                            Digest hasn't reported in over 2× its {intervalLabel} interval — the daily job may have stopped. Check the API server logs.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {health.services?.rateLimitAuditFailures && (() => {
                const ralf = health.services.rateLimitAuditFailures as {
                  totalCount: number;
                  lastAt: string | null;
                  byName: Record<string, { count: number; lastAt: string | null; lastError: string | null }>;
                  source: "redis" | "memory";
                  pods: Array<{
                    instanceId: string;
                    totalCount: number;
                    lastAt: string | null;
                    byName: Record<string, { count: number; lastAt: string | null; lastError: string | null }>;
                  }>;
                };
                const reportingPods = Array.isArray(ralf.pods) ? ralf.pods : [];
                // The pods array always includes at least the request-handling
                // pod once it has reported a failure; only filter to the ones
                // that actually have non-zero counts so a stale-but-empty
                // record doesn't add noise.
                const podsWithFailures = reportingPods.filter((p) => p.totalCount > 0);
                return (
                  <Card data-testid="card-rate-limit-audit-failures">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4" />
                        Rate-limit audit writes
                        <Badge
                          variant={ralf.source === "redis" ? "outline" : "warning"}
                          className="ml-2 font-normal"
                          data-testid="rate-limit-audit-failure-source"
                          title={
                            ralf.source === "redis"
                              ? "Counts aggregated across every reporting pod via Redis."
                              : "Redis unavailable on this pod — showing per-instance fallback view only."
                          }
                        >
                          {ralf.source === "redis"
                            ? `${podsWithFailures.length} pod${podsWithFailures.length === 1 ? "" : "s"} reporting`
                            : "in-memory only"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">
                            Failed writes
                            {ralf.source === "redis" ? " (cluster, last 24h)" : " (this pod)"}
                          </span>
                          <span
                            className={`text-sm font-medium ${ralf.totalCount > 0 ? "text-red-600" : ""}`}
                            data-testid="rate-limit-audit-failure-total"
                          >
                            {ralf.totalCount ?? 0}
                          </span>
                        </div>
                        {ralf.lastAt && (
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Last failure</span>
                            <span className="text-sm font-medium">
                              {new Date(ralf.lastAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                        {Object.entries(ralf.byName ?? {}).length > 0 ? (
                          <div className="space-y-1 pt-2 border-t">
                            {Object.entries(ralf.byName).map(([name, info]) => (
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
                            No audit-write failures recorded.
                          </p>
                        )}
                        {podsWithFailures.length > 1 && (
                          <div className="pt-2 border-t">
                            <p className="text-[11px] uppercase text-muted-foreground mb-1">
                              Per-pod breakdown
                            </p>
                            <div className="space-y-1" data-testid="rate-limit-audit-failure-pods">
                              {podsWithFailures.map((pod) => (
                                <div
                                  key={pod.instanceId}
                                  className="flex justify-between text-xs"
                                  data-testid={`rate-limit-audit-failure-pod-${pod.instanceId}`}
                                  title={pod.instanceId}
                                >
                                  <span className="text-muted-foreground truncate font-mono">
                                    {pod.instanceId}
                                  </span>
                                  <span className="font-medium">{pod.totalCount}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {health.services?.moderationFailures && (() => {
                const mf = health.services.moderationFailures as {
                  window: {
                    totalCount: number;
                    byKind: { engine: number; persist: number };
                    lastAt: string | null;
                    lastError: string | null;
                    lastKind: "engine" | "persist" | null;
                    windowMs: number;
                    source?: "redis" | "memory";
                    pods?: Array<{
                      instanceId: string;
                      totalCount: number;
                      byKind: { engine: number; persist: number };
                      lastAt: string | null;
                    }>;
                  };
                  cumulative: {
                    totalCount: number;
                    byKind: { engine: number; persist: number };
                    lastAt: string | null;
                  };
                  alerter: {
                    alerting: boolean;
                    lastSeenWindowTotal: number;
                    lastInWindowFailureAt: string | null;
                  };
                };
                const minutes = Math.max(1, Math.round((mf.window.windowMs ?? 0) / 60000));
                const reportingPods = Array.isArray(mf.window.pods) ? mf.window.pods : [];
                const podsWithFailures = reportingPods
                  .filter((p) => p.totalCount > 0)
                  .slice()
                  .sort((a, b) => b.totalCount - a.totalCount);
                const source = mf.window.source ?? "memory";
                return (
                  <Card data-testid="card-moderation-failures">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4" />
                        Background moderation failures
                        <Badge
                          variant={mf.alerter.alerting ? "destructive" : "outline"}
                          className="ml-2 font-normal"
                          data-testid="moderation-failures-alerting-badge"
                          title={
                            mf.alerter.alerting
                              ? "Rolling window is above the configured alert threshold — on-call has been paged."
                              : "Rolling window is below the configured alert threshold."
                          }
                        >
                          {mf.alerter.alerting ? "alerting" : "ok"}
                        </Badge>
                        <Badge
                          variant={source === "redis" ? "outline" : "warning"}
                          className="font-normal"
                          data-testid="moderation-failures-source"
                          title={
                            source === "redis"
                              ? "Counts aggregated across every reporting pod via Redis."
                              : "Redis unavailable on this pod — showing per-instance fallback view only."
                          }
                        >
                          {source === "redis"
                            ? `${podsWithFailures.length} pod${podsWithFailures.length === 1 ? "" : "s"} reporting`
                            : "in-memory only"}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">
                            In-window failures (last {minutes}m)
                          </span>
                          <span
                            className={`text-sm font-medium ${mf.window.totalCount > 0 ? "text-red-600" : ""}`}
                            data-testid="moderation-failures-window-total"
                          >
                            {mf.window.totalCount ?? 0}
                          </span>
                        </div>
                        <div className="space-y-1 pt-2 border-t">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">engine (evaluator threw)</span>
                            <span
                              className="font-medium"
                              data-testid="moderation-failures-window-engine"
                            >
                              {mf.window.byKind?.engine ?? 0}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">persist (DB write threw)</span>
                            <span
                              className={`font-medium ${(mf.window.byKind?.persist ?? 0) > 0 ? "text-red-600" : ""}`}
                              data-testid="moderation-failures-window-persist"
                              title={
                                (mf.window.byKind?.persist ?? 0) > 0
                                  ? "Known flag-worthy posts are still publicly active because the shadow-hide DB write threw."
                                  : undefined
                              }
                            >
                              {mf.window.byKind?.persist ?? 0}
                            </span>
                          </div>
                        </div>
                        {mf.window.lastAt && (
                          <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Last failure</span>
                            <span className="text-sm font-medium">
                              {new Date(mf.window.lastAt).toLocaleString()}
                            </span>
                          </div>
                        )}
                        {mf.window.lastError && (
                          <div
                            className="text-xs text-muted-foreground pt-2 border-t"
                            data-testid="moderation-failures-last-error"
                          >
                            <span className="block uppercase text-[10px] tracking-wide mb-1">
                              Last error{mf.window.lastKind ? ` (${mf.window.lastKind})` : ""}
                            </span>
                            <code className="break-all">{mf.window.lastError}</code>
                          </div>
                        )}
                        <div className="pt-2 border-t">
                          <p className="text-[11px] uppercase text-muted-foreground mb-1">
                            Cumulative (since process start)
                          </p>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">total</span>
                            <span
                              className="font-medium"
                              data-testid="moderation-failures-cumulative-total"
                            >
                              {mf.cumulative.totalCount ?? 0}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">engine / persist</span>
                            <span className="font-medium">
                              {mf.cumulative.byKind?.engine ?? 0}
                              {" / "}
                              {mf.cumulative.byKind?.persist ?? 0}
                            </span>
                          </div>
                        </div>
                        {podsWithFailures.length > 0 && (
                          <div className="pt-2 border-t">
                            <p className="text-[11px] uppercase text-muted-foreground mb-1">
                              Per-pod breakdown (last {minutes}m)
                            </p>
                            <div
                              className="space-y-1"
                              data-testid="moderation-failures-pods"
                            >
                              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] uppercase text-muted-foreground tracking-wide">
                                <span>pod</span>
                                <span className="text-right">engine</span>
                                <span className="text-right">persist</span>
                                <span className="text-right">last</span>
                              </div>
                              {podsWithFailures.map((pod) => (
                                <div
                                  key={pod.instanceId}
                                  className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs items-baseline"
                                  data-testid={`moderation-failures-pod-${pod.instanceId}`}
                                  title={pod.instanceId}
                                >
                                  <span className="text-muted-foreground truncate font-mono">
                                    {pod.instanceId}
                                  </span>
                                  <span className="font-medium text-right">
                                    {pod.byKind?.engine ?? 0}
                                  </span>
                                  <span
                                    className={`font-medium text-right ${(pod.byKind?.persist ?? 0) > 0 ? "text-red-600" : ""}`}
                                  >
                                    {pod.byKind?.persist ?? 0}
                                  </span>
                                  <span className="text-muted-foreground text-right">
                                    {pod.lastAt
                                      ? new Date(pod.lastAt).toLocaleTimeString()
                                      : "—"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

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

            <Card data-testid="card-oncall-destinations-history">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="w-4 h-4" />
                  On-call destination changes
                  <Badge variant="outline" className="ml-2 font-normal">last {ONCALL_HISTORY_LIMIT}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Audit-log timeline of who edited an on-call destination (PagerDuty key, ops email, Slack webhook)
                  or sent a test alert. Useful for correlating an outage window with a recent configuration change —
                  click a row for the full actor + changed-fields detail, or open the audit row for everything else.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {oncallHistoryLoading && oncallHistory.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm" data-testid="oncall-history-loading">
                    Loading recent destination changes...
                  </div>
                ) : oncallHistoryError ? (
                  <div className="p-6 text-center text-sm text-red-600" data-testid="oncall-history-error">
                    {oncallHistoryError}
                  </div>
                ) : oncallHistory.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm" data-testid="oncall-history-empty">
                    No on-call destination changes recorded yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto" data-testid="oncall-history-table">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-4 py-2">When</th>
                          <th className="text-left font-medium px-4 py-2">Action</th>
                          <th className="text-left font-medium px-4 py-2">Actor</th>
                          <th className="text-left font-medium px-4 py-2">Details</th>
                          <th className="text-right font-medium px-4 py-2">Audit row</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {oncallHistory.map((event) => {
                          const ts = event.createdAt ? new Date(event.createdAt) : null;
                          const tsLabel = ts && !Number.isNaN(ts.getTime()) ? ts.toLocaleString() : "Unknown";
                          const actor = oncallActorDisplay(event);
                          const isTest = event.actionType === "send_test_alert";
                          const isUpdate = event.actionType === "update_setting";
                          const isExpanded = expandedOncallEventId === event.id;
                          // Tooltip on the row gives admins the actor + changed-fields
                          // recap on hover without forcing a click; the same data is
                          // also visible inline in the Details column for quick scanning.
                          const hoverParts: string[] = [`Actor: ${actor}`];
                          if (isUpdate && event.changedFields.length > 0) {
                            hoverParts.push(
                              `Changed: ${event.changedFields.map((f) => ONCALL_FIELD_LABELS[f]).join(", ")}`,
                            );
                          }
                          if (isTest && event.testResults.length > 0) {
                            hoverParts.push(
                              `Tested: ${event.testResults
                                .map((r) =>
                                  `${ONCALL_CHANNEL_LABELS[r.channel]} ${r.skipped ? "skipped" : r.ok ? "ok" : "failed"}`,
                                )
                                .join(", ")}`,
                            );
                          }
                          if (event.description) hoverParts.push(event.description);
                          const hoverTitle = hoverParts.join(" — ");
                          return (
                            <Fragment key={event.id}>
                              <tr
                                className="hover:bg-muted/20 cursor-pointer"
                                data-testid={`oncall-history-row-${event.id}`}
                                title={hoverTitle}
                                onClick={() =>
                                  setExpandedOncallEventId((prev) => (prev === event.id ? null : event.id))
                                }
                              >
                                <td className="px-4 py-2 whitespace-nowrap text-xs">{tsLabel}</td>
                                <td className="px-4 py-2 text-xs">
                                  {isTest ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] inline-flex items-center gap-1"
                                      data-testid={`oncall-history-action-${event.id}`}
                                    >
                                      <Send className="w-3 h-3" /> Test alert
                                    </Badge>
                                  ) : isUpdate ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] inline-flex items-center gap-1"
                                      data-testid={`oncall-history-action-${event.id}`}
                                    >
                                      <KeyRound className="w-3 h-3" /> Updated
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                      data-testid={`oncall-history-action-${event.id}`}
                                    >
                                      {event.actionType}
                                    </Badge>
                                  )}
                                </td>
                                <td
                                  className="px-4 py-2 text-xs max-w-[16rem] truncate"
                                  title={actor}
                                  data-testid={`oncall-history-actor-${event.id}`}
                                >
                                  {actor}
                                </td>
                                <td className="px-4 py-2">
                                  {isUpdate && event.changedFields.length > 0 ? (
                                    <div
                                      className="flex flex-wrap gap-1"
                                      data-testid={`oncall-history-fields-${event.id}`}
                                    >
                                      {event.changedFields.map((f) => (
                                        <Badge
                                          key={f}
                                          variant="outline"
                                          className="text-[10px]"
                                        >
                                          {ONCALL_FIELD_LABELS[f]}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : isTest && event.testResults.length > 0 ? (
                                    <div
                                      className="flex flex-wrap gap-1"
                                      data-testid={`oncall-history-results-${event.id}`}
                                    >
                                      {event.testResults.map((r) => (
                                        <span
                                          key={r.channel}
                                          className="text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 bg-background"
                                          title={r.reason ?? undefined}
                                        >
                                          {r.skipped ? (
                                            <AlertCircle className="w-3 h-3 text-muted-foreground" />
                                          ) : r.ok ? (
                                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                                          ) : (
                                            <XCircle className="w-3 h-3 text-red-600" />
                                          )}
                                          <span>{ONCALL_CHANNEL_LABELS[r.channel]}</span>
                                          <span className="text-muted-foreground">
                                            {r.skipped ? "skipped" : r.ok ? "ok" : "failed"}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {event.description || "—"}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <Link
                                    href={`/admin/audit-log?entityType=oncall_destinations&expand=${event.id}`}
                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                    data-testid={`link-oncall-history-audit-${event.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    #{event.id}
                                    <ExternalLink className="w-3 h-3" />
                                  </Link>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr
                                  className="bg-muted/10"
                                  data-testid={`oncall-history-expanded-${event.id}`}
                                >
                                  <td colSpan={5} className="px-4 py-3">
                                    <div className="space-y-1 text-xs">
                                      <div>
                                        <span className="text-muted-foreground">Actor: </span>
                                        <span className="font-medium">{actor}</span>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">When: </span>
                                        <span className="font-medium">{tsLabel}</span>
                                      </div>
                                      {isUpdate && event.changedFields.length > 0 && (
                                        <div>
                                          <span className="text-muted-foreground">Changed fields: </span>
                                          <span className="font-medium">
                                            {event.changedFields
                                              .map((f) => ONCALL_FIELD_LABELS[f])
                                              .join(", ")}
                                          </span>
                                        </div>
                                      )}
                                      {isTest && event.testResults.length > 0 && (
                                        <div className="space-y-0.5">
                                          <span className="text-muted-foreground">Test results:</span>
                                          <ul className="ml-4 list-disc space-y-0.5">
                                            {event.testResults.map((r) => (
                                              <li key={r.channel}>
                                                <span className="font-medium">
                                                  {ONCALL_CHANNEL_LABELS[r.channel]}
                                                </span>
                                                {": "}
                                                <span>
                                                  {r.skipped ? "skipped" : r.ok ? "ok" : "failed"}
                                                </span>
                                                {r.reason && (
                                                  <span className="text-muted-foreground">
                                                    {" "}
                                                    — {r.reason}
                                                  </span>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {event.description && (
                                        <div>
                                          <span className="text-muted-foreground">Description: </span>
                                          <span>{event.description}</span>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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
                  started or stopped bypassing Redis. Click a row to expand the full reason text and raw audit
                  metadata in place; the <span className="font-mono">#id</span> link still opens the matching audit
                  log entry on its own page.
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
                    className="px-4 py-2 border-b bg-muted/20 text-xs space-y-1"
                    data-testid="alert-events-summary"
                  >
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                      <div
                        className="inline-flex items-center rounded-md border bg-background p-0.5 mr-1"
                        role="group"
                        aria-label="Alert summary window"
                        data-testid="alert-stats-window-toggle"
                      >
                        {ALERT_STATS_WINDOW_OPTIONS.map((opt) => {
                          const active = alertStatsWindowMs === opt.ms;
                          return (
                            <button
                              key={opt.ms}
                              type="button"
                              onClick={() => setAlertStatsWindowMs(opt.ms)}
                              aria-pressed={active}
                              className={`px-2 py-0.5 text-[11px] rounded-sm transition-colors ${
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                              data-testid={`alert-stats-window-${opt.label}`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-muted-foreground mr-1">
                        {formatAlertStatsWindow(alertStats.windowMs)}:
                      </span>
                      {ALERT_OUTCOME_VALUES.map((value, idx) => {
                        const count = alertStats[value];
                        const active = alertOutcomeFilter === value;
                        const isFailedHot = value === "failed" && count > 0;
                        return (
                          <Fragment key={value}>
                            {idx > 0 && <span className="text-muted-foreground">·</span>}
                            <button
                              type="button"
                              onClick={() => updateAlertFilter("alertOutcome", active ? null : value)}
                              aria-pressed={active}
                              aria-label={`${count} ${value}${active ? " (filter active — click to clear)" : " — click to filter"}`}
                              title={active ? `Showing only ${value} — click to clear` : `Filter to ${value}`}
                              className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                                active ? "bg-primary/10 ring-1 ring-primary" : ""
                              } ${isFailedHot && !active ? "text-red-600" : ""}`}
                              data-testid={`alert-stats-${value}`}
                            >
                              <span className="font-medium">{count}</span>
                              <span className={isFailedHot && !active ? "text-red-600/80" : "text-muted-foreground"}>{value}</span>
                              {value === "failed" && count > 0 && (() => {
                                const breakdown = formatFailedByChannel(alertStats.byChannel);
                                if (!breakdown) return null;
                                return (
                                  <span
                                    className={active ? "text-muted-foreground" : "text-red-600/80"}
                                    data-testid="alert-stats-failed-by-channel"
                                  >
                                    ({breakdown})
                                  </span>
                                );
                              })()}
                            </button>
                          </Fragment>
                        );
                      })}
                      {alertStats.unknown > 0 && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span
                            className="inline-flex items-baseline gap-1 px-1.5 py-0.5"
                            data-testid="alert-stats-unknown"
                            title="Rows with an unrecognized outcome value"
                          >
                            <span className="font-medium">{alertStats.unknown}</span>
                            <span className="text-muted-foreground">unknown</span>
                          </span>
                        </>
                      )}
                      {alertStats.total === 0 && (
                        <span className="text-muted-foreground italic ml-1" data-testid="alert-stats-quiet">
                          — no alerts dispatched
                        </span>
                      )}
                    </div>
                    {alertStats.byChannel && alertStats.total > 0 && (
                      <div
                        className="flex flex-wrap items-center gap-x-1 gap-y-1"
                        data-testid="alert-stats-channels"
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                          By channel
                        </span>
                        {(() => {
                          const channelKeys = ALERT_CHANNEL_VALUES.filter((c) => {
                            const total = alertStats.byChannel?.[c]?.total ?? 0;
                            return total > 0 || alertChannelFilter === c;
                          });
                          if (channelKeys.length === 0) {
                            return (
                              <span className="text-muted-foreground italic" data-testid="alert-stats-channels-empty">
                                no channel-tagged deliveries
                              </span>
                            );
                          }
                          return channelKeys.map((channel, idx) => {
                            const bucket = alertStats.byChannel?.[channel];
                            const total = bucket?.total ?? 0;
                            const failed = bucket?.failed ?? 0;
                            const active = alertChannelFilter === channel;
                            return (
                              <Fragment key={channel}>
                                {idx > 0 && <span className="text-muted-foreground">·</span>}
                                <button
                                  type="button"
                                  onClick={() => updateAlertFilter("alertChannel", active ? null : channel)}
                                  aria-pressed={active}
                                  aria-label={`${total} ${ALERT_CHANNEL_DISPLAY_LABELS[channel]}${failed > 0 ? `, ${failed} failed` : ""}${active ? " (filter active — click to clear)" : " — click to filter"}`}
                                  title={active ? `Showing only ${ALERT_CHANNEL_DISPLAY_LABELS[channel]} — click to clear` : `Filter to ${ALERT_CHANNEL_DISPLAY_LABELS[channel]}`}
                                  className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                                    active ? "bg-primary/10 ring-1 ring-primary" : ""
                                  }`}
                                  data-testid={`alert-stats-channel-${channel}`}
                                >
                                  <span className="font-medium">{total}</span>
                                  <span className="text-muted-foreground">{ALERT_CHANNEL_DISPLAY_LABELS[channel]}</span>
                                  {failed > 0 && (
                                    <span
                                      className={active ? "text-muted-foreground" : "text-red-600/80"}
                                      data-testid={`alert-stats-channel-${channel}-failed`}
                                    >
                                      ({failed} failed)
                                    </span>
                                  )}
                                </button>
                              </Fragment>
                            );
                          });
                        })()}
                        {(alertStats.byChannel?.unknown?.total ?? 0) > 0 && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span
                              className="inline-flex items-baseline gap-1 px-1.5 py-0.5"
                              data-testid="alert-stats-channel-unknown"
                              title="Rows with an unrecognized deliveryChannel value"
                            >
                              <span className="font-medium">{alertStats.byChannel?.unknown.total ?? 0}</span>
                              <span className="text-muted-foreground">Unknown</span>
                            </span>
                          </>
                        )}
                      </div>
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
                          <th className="w-6 px-2 py-2" aria-hidden="true"></th>
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
                          const isExpanded = expandedAlertEventId === event.id;
                          // Pretty-print the metadata payload as JSON for the
                          // expanded view. Falls back to an empty object so
                          // the panel always renders predictably even on the
                          // brief window after deploy where older API replies
                          // may not include `metadata` yet.
                          const metadataJson = JSON.stringify(event.metadata ?? {}, null, 2);
                          return (
                            <Fragment key={event.id}>
                              <tr
                                className="hover:bg-muted/20 cursor-pointer"
                                data-testid={`alert-event-row-${event.id}`}
                                aria-expanded={isExpanded}
                                onClick={() =>
                                  setExpandedAlertEventId((prev) => (prev === event.id ? null : event.id))
                                }
                              >
                                <td className="px-2 py-2 align-middle text-muted-foreground">
                                  {isExpanded ? (
                                    <ChevronDown
                                      className="w-3.5 h-3.5"
                                      data-testid={`alert-event-chevron-${event.id}`}
                                    />
                                  ) : (
                                    <ChevronRight
                                      className="w-3.5 h-3.5"
                                      data-testid={`alert-event-chevron-${event.id}`}
                                    />
                                  )}
                                </td>
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
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    #{event.id}
                                    <ExternalLink className="w-3 h-3" />
                                  </Link>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr
                                  className="bg-muted/10"
                                  data-testid={`alert-event-expanded-${event.id}`}
                                >
                                  <td colSpan={7} className="px-4 py-3">
                                    <div className="space-y-2 text-xs">
                                      <div>
                                        <span className="text-muted-foreground">When: </span>
                                        <span className="font-medium">{tsLabel}</span>
                                      </div>
                                      {event.description && (
                                        <div>
                                          <span className="text-muted-foreground">Description: </span>
                                          <span>{event.description}</span>
                                        </div>
                                      )}
                                      {event.reason && (
                                        <div data-testid={`alert-event-reason-${event.id}`}>
                                          <span className="text-muted-foreground">Reason: </span>
                                          <span className="whitespace-pre-wrap break-words font-medium">
                                            {event.reason}
                                          </span>
                                        </div>
                                      )}
                                      <div>
                                        <div className="text-muted-foreground mb-1">Raw metadata</div>
                                        <pre
                                          className="rounded border bg-background p-2 text-[11px] leading-snug overflow-x-auto whitespace-pre-wrap break-words"
                                          data-testid={`alert-event-metadata-${event.id}`}
                                        >
                                          {metadataJson}
                                        </pre>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
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
