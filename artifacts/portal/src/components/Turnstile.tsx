import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
    __onTurnstileLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileLoad&render=explicit";

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    window.__onTurnstileLoad = () => resolve();
    if (existing) {
      if (window.turnstile) resolve();
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Turnstile script"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface TurnstileProps {
  siteKey: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
}

export interface TurnstileHandle {
  /**
   * Reset the rendered widget back to its unsolved state. Safe to call before
   * the widget has finished mounting — the call is silently ignored in that
   * case. Use this after a submission failure so the user can solve the
   * challenge again without manually re-clicking it.
   */
  reset: () => void;
}

/**
 * Cloudflare Turnstile widget. Loads the Turnstile script on demand and
 * renders a single widget into a managed container. Calls `onToken` with the
 * latest token whenever the user solves the challenge (or with `""` if the
 * token expires or the widget errors).
 *
 * Forwards a ref exposing a `reset()` handle so callers can re-arm the
 * challenge after a failed submission.
 */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { siteKey, onToken, onExpire, onError, theme = "auto" },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep callbacks in refs so we can re-mount the widget only when siteKey
  // changes, not on every render of the parent.
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  onTokenRef.current = onToken;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (!widgetIdRef.current || !window.turnstile) return;
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          // ignore — widget may have been removed mid-reset
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => {
            onTokenRef.current("");
            onExpireRef.current?.();
          },
          "error-callback": () => {
            onTokenRef.current("");
            onErrorRef.current?.();
          },
        });
      })
      .catch((err) => {
        // Error code 3589 = hostname not in the widget's allowed-domain list
        // (or invalid site key). Fix: go to the Cloudflare Turnstile dashboard,
        // find the widget whose site key matches VITE_TURNSTILE_SITE_KEY, and
        // add the production hostname (e.g. portal.buildtestscale.com) to its
        // allowed-hostnames list. If the key itself is wrong, generate a new one
        // and update the VITE_TURNSTILE_SITE_KEY secret in the deployment.
        console.error("[Turnstile] failed to load:", err);
        onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore — widget may already be gone
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme]);

  return <div ref={containerRef} />;
});
