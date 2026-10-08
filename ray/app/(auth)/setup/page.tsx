"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getSafeRedirectUrl } from "@/lib/redirect";

function isDatabaseErrorString(msg?: string): boolean {
  if (!msg || typeof msg !== "string") return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes("prisma") ||
    (lower.includes("table") && lower.includes("does not exist")) ||
    (lower.includes("users") && lower.includes("does not exist")) ||
    lower.includes("p2021") ||
    lower.includes("p1001") ||
    lower.includes("can't reach database") ||
    lower.includes("cannot reach database") ||
    lower.includes("database is not initialized") ||
    lower.includes("connect econnrefused")
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isDbInitError, setIsDbInitError] = useState(false);
  const [command, setCommand] = useState("curl -fsSL https://putme.in/install.sh | bash");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Check on mount whether setup is actually required
  useEffect(() => {
    let isMounted = true;
    async function checkStatus() {
      try {
        const res = await fetch("/api/auth/setup-status");
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (!data.setupRequired) {
            // Setup already finished — bounce to login
            router.replace("/login");
            return;
          }
        } else if (data.isDbInitError || isDatabaseErrorString(data.error)) {
          setIsDbInitError(true);
          setError(
            data.error ||
              "Database tables are not initialized or the database service is unavailable."
          );
          if (data.command) setCommand(data.command);
        }
      } catch {
        // Continue to show setup page if network is ok
      } finally {
        if (isMounted) setCheckingSetup(false);
      }
    }
    checkStatus();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleCopyCommand = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = command;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsDbInitError(false);

    if (!form.name.trim()) {
      setError("Please enter your name or username.");
      return;
    }

    if (!form.email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const isDbError = Boolean(
          data.isDbInitError || isDatabaseErrorString(data.error)
        );

        if (isDbError) {
          setIsDbInitError(true);
          setError(
            data.error ||
              "Database tables are not initialized. Please run the setup command."
          );
          if (data.command) setCommand(data.command);
        } else {
          setIsDbInitError(false);
          setError(data.error || "Setup failed. Please check server logs.");
        }
        return;
      }

      // Successful setup — redirect into dashboard or requested destination
      let destination = "/dashboard";
      if (typeof window !== "undefined") {
        const searchParams = new URLSearchParams(window.location.search);
        destination = getSafeRedirectUrl(searchParams.get("from"), "/dashboard");
      }
      window.location.href = destination;
    } catch {
      setIsDbInitError(false);
      setError("Network connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const passwordsMatch =
    form.password &&
    form.confirmPassword &&
    form.password === form.confirmPassword;
  const passwordsMismatch =
    form.password &&
    form.confirmPassword &&
    form.password !== form.confirmPassword;

  if (checkingSetup) {
    return (
      <div className="flex items-center justify-center p-8">
        <svg
          className="animate-spin text-white/50"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Brand */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="flex items-center justify-center flex-shrink-0">
            <Image
              src="/logo.svg"
              alt="Ray"
              width={36}
              height={36}
              className="w-9 h-9 object-contain drop-shadow-[0_0_16px_rgba(255,255,255,0.15)]"
              priority
            />
          </div>
          <span className="font-jersey text-white text-3xl tracking-wide">ray</span>
        </div>
        <h1 className="font-jersey text-4xl text-white mb-2 tracking-wide">
          Initial Setup
        </h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
          Create your administrator account to secure your platform
        </p>
      </div>

      {/* Card */}
      <div
        className="p-7"
        style={{
          background: "#070707",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.03), 0 0 40px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Database Setup Required Alert */}
          {isDbInitError && (
            <div
              className="animate-fade-in flex flex-col gap-3 p-4 rounded-xl text-left"
              style={{
                background: "rgba(234, 179, 8, 0.05)",
                border: "1px solid rgba(234, 179, 8, 0.25)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/15 text-amber-400 flex-shrink-0">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </span>
                <span className="text-xs font-semibold tracking-wider text-amber-400 uppercase">
                  Database Setup Required
                </span>
              </div>

              <p className="text-xs leading-relaxed text-neutral-300">
                Database tables have not been created yet. Run the PutmeIn command in your
                terminal to initialize the schema:
              </p>

              <div
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg text-xs"
                style={{
                  background: "#0c0c0c",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <code className="text-[11px] text-white/90 overflow-x-auto whitespace-nowrap select-all pr-2">
                  {command}
                </code>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all cursor-pointer"
                  style={{
                    background: copied ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.08)",
                    color: copied ? "#4ade80" : "#ffffff",
                    border: copied
                      ? "1px solid rgba(34, 197, 94, 0.3)"
                      : "1px solid rgba(255, 255, 255, 0.12)",
                  }}
                  title="Copy command to clipboard"
                >
                  {copied ? (
                    <>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <span className="text-[11px] text-neutral-400">
                After the command finishes, click Complete Setup below to continue.
              </span>
            </div>
          )}

          {/* Standard Error Alert */}
          {error && !isDbInitError && (
            <div
              className="animate-fade-in flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm"
              style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.15)",
                color: "#fca5a5",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="flex-shrink-0 mt-0.5 text-red-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1 text-xs sm:text-sm font-normal leading-snug">{error}</div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Name / Username</label>
            <input
              className="ray-input"
              type="text"
              placeholder="e.g. admin or your name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Email Address</label>
            <input
              className="ray-input"
              type="email"
              placeholder="admin@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="ray-eyebrow">New Password</label>
              {form.password && (
                <span
                  className={`text-[10px] font-mono ${
                    form.password.length >= 8
                      ? "text-emerald-400"
                      : "text-amber-400"
                  }`}
                >
                  {form.password.length >= 8
                    ? "✓ 8+ chars"
                    : `${form.password.length}/8 chars`}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                className="ray-input pr-14"
                type={showPassword ? "text" : "password"}
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-white/40 hover:text-white px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="ray-eyebrow">Confirm Password</label>
              {form.confirmPassword && (
                <span
                  className={`text-[10px] font-mono ${
                    passwordsMatch ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {passwordsMatch ? "✓ Passwords match" : "Mismatch"}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                className="ray-input pr-14"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm({ ...form, confirmPassword: e.target.value })
                }
                required
                autoComplete="new-password"
                style={
                  passwordsMismatch
                    ? { borderColor: "rgba(239,68,68,0.35)" }
                    : {}
                }
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-white/40 hover:text-white px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="ray-btn-primary w-full py-3 mt-2 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="animate-spin"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Configuring platform…
              </span>
            ) : (
              "Complete Setup & Launch"
            )}
          </button>
        </form>
      </div>

      <p
        className="text-center text-xs mt-6"
        style={{
          color: "rgba(255,255,255,0.15)",
          fontFamily: "var(--font-mono)",
        }}
      >
        PutmeIn ray · First-time administrator configuration
      </p>
    </div>
  );
}
