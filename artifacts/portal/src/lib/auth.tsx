import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { refreshAccessToken } from "@workspace/api-client-react";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  onboardingComplete: boolean;
  onboardingStep: number;
  // IANA timezone (e.g. "America/New_York"). Always present for real member
  // rows (users.timezone has a DB default), but optional here defensively in
  // case a caller mocks a partial user object.
  timezone?: string;
  // True for staff accounts created via the admin panel that still hold their
  // shared temporary password. While set, route guards force the user to the
  // change-password screen before anything else loads.
  mustChangePassword?: boolean;
  // Set when an admin is impersonating this member's account.
  isImpersonation?: boolean;
  impersonatedBy?: { id: number; name: string };
}

export interface LoginError extends Error {
  emailRecentlyChanged?: boolean;
  emailUnverified?: boolean;
  // Structured backend error code (e.g. "RATE_LIMIT_EXCEEDED",
  // "CAPTCHA_REQUIRED"). Pages use this to decide whether to reset the
  // Turnstile widget — a 429 from the per-IP limiter never reaches captcha
  // verification on the server, so the user's solved token is still valid
  // and shouldn't be discarded.
  code?: string;
}

export interface RegisterError extends Error {
  // See LoginError.code — same anti-reset rule on 429 applies to /register.
  code?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<string>;
  resendVerificationEmail: (email: string) => Promise<string>;
  logout: () => Promise<void>;
  // Returns the freshly-fetched user (or null on auth failure) so callers can
  // act on the new onboardingStep immediately, without waiting for the async
  // setUser() state update to flow through a re-render (React state reads in
  // the same closure would otherwise see the stale pre-refresh value).
  refreshAuth: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = `${import.meta.env.BASE_URL}api`;

// Auth-endpoint paths must never trigger the auto-refresh recovery, for two
// reasons: (1) AuthProvider.refreshAuth already orchestrates its own explicit
// /auth/me → /auth/refresh → /auth/me sequence and auto-refreshing inside that
// would change boot behavior; (2) a failed /auth/refresh returning 401 must NOT
// retry or it would loop (refresh→401→refresh…).
function isAuthPath(path: string): boolean {
  return /^\/auth(\/|$)/.test(path);
}

export async function authFetch(path: string, options?: RequestInit) {
  // Guard against the doubled-prefix footgun: `API_BASE` already ends in
  // `/api`, so callers must pass paths WITHOUT a leading `/api` (e.g.
  // "/content-access/me", not "/api/content-access/me"). A doubled
  // "/api/api/..." silently 404s. Fail loudly in dev so this never ships.
  if (import.meta.env.DEV && /^\/api(\/|$)/.test(path)) {
    throw new Error(
      `authFetch: path must not start with "/api" — authFetch already prepends it. ` +
        `Got "${path}"; use "${path.replace(/^\/api/, "") || "/"}" instead.`,
    );
  }

  const sendRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

  let res = await sendRequest();

  // An expired access token surfaces as a 401. Recover transparently by
  // refreshing once (single-flight shared with customFetch) and replaying the
  // request, so admin pages survive token expiry without a manual reload.
  // Auth paths are skipped to prevent loops and preserve the boot auth flow.
  // On refresh failure the original 401 is returned and the caller's existing
  // logout / redirect-to-login behavior fires as normal.
  if (res.status === 401 && !isAuthPath(path)) {
    const refreshUrl = `${API_BASE}/auth/refresh`;
    const refreshed = await refreshAccessToken(refreshUrl);
    if (refreshed) {
      res = await sendRequest();
    }
  }

  return res;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async (): Promise<User | null> => {
    try {
      const res = await authFetch("/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return data;
      }

      const refreshRes = await authFetch("/auth/refresh", { method: "POST" });
      if (refreshRes.ok) {
        const meRes = await authFetch("/auth/me");
        if (meRes.ok) {
          const data = await meRes.json();
          setUser(data);
          return data;
        }
      }

      setUser(null);
      return null;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshAuth().finally(() => setLoading(false));
  }, [refreshAuth]);

  const login = async (
    email: string,
    password: string,
    captchaToken?: string,
  ) => {
    const res = await authFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, captchaToken }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Support both the legacy `{ error: "msg" }` shape and the structured
      // `{ error: { code, message } }` shape returned by sendError() for
      // captcha failures.
      const code: string | undefined = data?.error?.code;
      let message: string;
      if (code === "CAPTCHA_REQUIRED" || code === "CAPTCHA_INVALID") {
        message = "Please complete the challenge below and try again.";
      } else if (typeof data?.error === "string") {
        message = data.error;
      } else if (typeof data?.error?.message === "string") {
        message = data.error.message;
      } else {
        message = "Login failed";
      }
      const err = new Error(message) as LoginError;
      if (typeof code === "string") {
        err.code = code;
      }
      if (data && data.emailRecentlyChanged === true) {
        err.emailRecentlyChanged = true;
      }
      if (data && data.emailUnverified === true) {
        err.emailUnverified = true;
      }
      throw err;
    }

    const data = await res.json();
    setUser(data);
  };

  const resendVerificationEmail = async (email: string): Promise<string> => {
    const res = await authFetch("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        "Could not resend the verification email. Please try again in a few minutes.";
      throw new Error(message);
    }

    // The backend always returns the same generic message regardless of
    // whether the address actually triggered a send (anti-enumeration).
    return (
      (data && data.message) ||
      "If your account isn't verified yet, we sent a new verification link."
    );
  };

  const register = async (
    name: string,
    email: string,
    password: string,
    captchaToken?: string,
  ): Promise<string> => {
    const res = await authFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, captchaToken }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Support both the legacy `{ error: "msg" }` shape and the structured
      // `{ error: { code, message } }` shape returned by sendError().
      const code: string | undefined = data?.error?.code;
      const message =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        "Registration failed";
      const err = new Error(message) as RegisterError;
      if (typeof code === "string") {
        err.code = code;
      }
      throw err;
    }

    // Register no longer auto-logs-in: the server returns the same generic
    // confirmation message whether the email is brand new or already in use,
    // so we can't tell which path ran. The user finishes via email.
    const data = await res.json().catch(() => ({}));
    return (
      (data && data.message) ||
      "Check your inbox to confirm your account."
    );
  };

  const logout = async () => {
    await authFetch("/auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        resendVerificationEmail,
        logout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
