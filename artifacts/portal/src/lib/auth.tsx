import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  onboardingComplete: boolean;
  onboardingStep: number;
}

export interface LoginError extends Error {
  emailRecentlyChanged?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<string>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const API_BASE = `${import.meta.env.BASE_URL}api`;

export async function authFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await authFetch("/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return;
      }

      const refreshRes = await authFetch("/auth/refresh", { method: "POST" });
      if (refreshRes.ok) {
        const meRes = await authFetch("/auth/me");
        if (meRes.ok) {
          const data = await meRes.json();
          setUser(data);
          return;
        }
      }

      setUser(null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshAuth().finally(() => setLoading(false));
  }, [refreshAuth]);

  const login = async (email: string, password: string) => {
    const res = await authFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || "Login failed") as LoginError;
      if (data && data.emailRecentlyChanged === true) {
        err.emailRecentlyChanged = true;
      }
      throw err;
    }

    const data = await res.json();
    setUser(data);
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
      const message =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        "Registration failed";
      throw new Error(message);
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
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshAuth }}>
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
