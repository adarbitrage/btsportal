import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";

function getInitialEmail(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("email") ?? "";
}

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState(getInitialEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#faf9f7",
      fontFamily: "Roboto, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        padding: "48px 40px",
        background: "white",
        borderRadius: 16,
        border: "1px solid #e8e4dc",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
            alt="Build Test Scale"
            style={{ height: 48, marginBottom: 16 }}
          />
          <h1 style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#1a1a1a",
            margin: "0 0 8px",
          }}>Welcome Back</h1>
          <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>
            Sign in to your member portal
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              padding: "12px 16px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              color: "#dc2626",
              fontSize: 14,
              marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
              marginBottom: 6,
            }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="you@example.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#374151",
              }}>Password</label>
              <Link href="/forgot-password" style={{
                fontSize: 13,
                color: "#1a56db",
                textDecoration: "none",
              }}>Forgot password?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => e.target.style.borderColor = "#1a56db"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              background: loading ? "#93b4f4" : "#1a56db",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 14,
          color: "#6b7280",
        }}>
          Don't have an account?{" "}
          <Link href="/register" style={{ color: "#1a56db", textDecoration: "none", fontWeight: 500 }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
