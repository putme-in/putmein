"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";

import Sidebar from "@/components/Sidebar";
import TerminalPanel from "@/components/TerminalPanel";
import { StateSpinner } from "@/components/StateSpinner";
import { getPrimaryProjectUrl } from "@/lib/domains";

interface ClientLayoutProps {
  children: React.ReactNode;
  user: { name: string; email: string; role: string };
}

// ─── Toast notification types ─────────────────────────────────────────────────

interface Toast {
  id: string;
  severity: "info" | "warn" | "error" | "critical";
  message: string;
  projectName?: string;
  createdAt: number;
}

const severityColor: Record<string, string> = {
  critical: "#ef4444",
  error: "#f97316",
  warn: "#eab308",
  info: "#22c55e",
};

function ToastStack({
  toasts,
  onDismiss,
  offsetRight = "20px",
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  offsetRight?: string;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-5 z-[200] flex flex-col gap-2 transition-all duration-300 pointer-events-auto"
      style={{ maxWidth: "360px", minWidth: "280px", right: offsetRight }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-fade-in-scale rounded-xl shadow-2xl overflow-hidden"
          style={{
            background: "#0e0e0e",
            border: `1px solid ${severityColor[toast.severity]}28`,
            borderLeft: `3px solid ${severityColor[toast.severity]}`,
            boxShadow: `0 4px 24px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)`,
          }}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
              style={{ background: severityColor[toast.severity] }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: severityColor[toast.severity] }}
                >
                  {toast.severity}
                </span>
                {toast.projectName && (
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>
                    {toast.projectName}
                  </span>
                )}
              </div>
              <p className="text-sm text-white leading-snug">{toast.message}</p>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors mt-0.5"
              style={{ color: "rgba(255,255,255,0.3)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";

interface ActiveDeployment {
  id: string;
  projectId?: string;
  projectPath?: string;
  type: "deployment" | "pipeline";
  name: string;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  status: "building" | "deploying" | "pending" | "healthy" | "failed";
  failureReason?: string;
  deployUrl?: string;
  port?: number;
  buildLogs: string;
  updatedAt: number;
  currentStage?: string;
  stageIndex?: number;
  totalStages?: number;
}

function LiveDeploymentWidget({
  deployment,
  onDismiss,
  onRedeploy,
  offsetRight = "20px",
}: {
  deployment: ActiveDeployment;
  onDismiss: () => void;
  onRedeploy: () => void;
  offsetRight?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const isBuilding = deployment.status === "building" || deployment.status === "deploying" || deployment.status === "pending";
  const isSuccess = deployment.status === "healthy";
  const isFailed = deployment.status === "failed";

  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [expanded, deployment.buildLogs]);

  const copyLogs = () => {
    navigator.clipboard.writeText(deployment.buildLogs || "No logs");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTriggerCancel = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/deploy/${deployment.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        onRedeploy();
        window.dispatchEvent(new Event("ray:deployment-cancelled"));
      }
    } catch { /* silent */ }
    finally {
      setCancelling(false);
    }
  };

  const handleTriggerRedeploy = async () => {
    setRedeploying(true);
    try {
      const res = await fetch(`/api/deploy/${deployment.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redeploy" }),
      });
      if (res.ok) {
        onRedeploy();
      }
    } catch { /* silent */ }
    finally {
      setRedeploying(false);
    }
  };

  return (
    <>
      <div
        className="fixed bottom-5 z-[160] flex flex-col items-end font-sans transition-all duration-300"
        style={{ right: offsetRight }}
      >
        {/* Upward Dropdown Modal Card */}
        {expanded && (
          <div
            className="mb-3 w-[360px] sm:w-[480px] rounded-2xl overflow-hidden shadow-2xl animate-fade-in border flex flex-col select-text"
            style={{
              background: "var(--color-card)",
              borderColor: isFailed ? "rgba(239, 68, 68, 0.25)" : "rgba(255, 255, 255, 0.14)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.06)",
            }}
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-white/[0.08] flex items-center justify-between bg-[#0f0f0f]/90">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                    isBuilding
                      ? "bg-white/[0.08] border border-white/20 text-white"
                      : isSuccess
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}
                >
                  {isBuilding ? (
                    <svg className="animate-spin text-white w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : isSuccess ? (
                    <svg className="text-emerald-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="text-red-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white tracking-tight truncate">{deployment.name}</span>

                  </div>
                  <p className="text-[11px] font-medium text-white/50 mt-0.5 truncate">
                    {isBuilding
                      ? (deployment.currentStage ? `Stage ${deployment.stageIndex || 1}/${deployment.totalStages || 6}: ${deployment.currentStage}` : "Compiling Docker image & dependencies...")
                      : isSuccess
                      ? "Container healthy & live"
                      : (deployment.failureReason || "Container build or launch failed")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isSuccess && deployment.deployUrl && (
                  <a
                    href={getPrimaryProjectUrl(deployment.deployUrl) || deployment.deployUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all flex items-center gap-1.5 active:scale-95"
                  >
                    <span>Open</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}

                {isBuilding && (
                  <button
                    onClick={handleTriggerCancel}
                    disabled={cancelling}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/30 transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                    title="Cancel deployment"
                  >
                    {cancelling ? (
                      <svg className="animate-spin w-3 h-3 text-red-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      </svg>
                    )}
                    <span>{cancelling ? "Cancelling…" : "Cancel"}</span>
                  </button>
                )}

                <button
                  onClick={copyLogs}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-white/5 text-white/70 hover:text-white hover:bg-white/10 border border-white/[0.08] transition-all cursor-pointer active:scale-95"
                >
                  {copied ? "Copied" : "Copy"}
                </button>

                <button
                  onClick={() => setExpanded(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                  title="Collapse"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Failure Alert Banner */}
            {isFailed && (
              <div className="mx-3.5 mt-3 p-3 rounded-xl bg-red-500/[0.08] border border-red-500/20 flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-red-400 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Deployment Failed</p>
                    <p className="text-xs font-medium text-white/90 mt-0.5 leading-snug">
                      {deployment.failureReason || "Build terminated with error. Inspect failure logs below."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1.5 border-t border-red-500/15">
                  <button
                    onClick={() => setShowTroubleshooter(true)}
                    className="flex-1 bg-white text-black hover:bg-white/90 font-bold text-xs py-1.5 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    </svg>
                    <span>Ray AI Troubleshooter</span>
                  </button>

                  <button
                    onClick={handleTriggerRedeploy}
                    disabled={redeploying}
                    className="ray-btn-ghost text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5 font-medium cursor-pointer"
                  >
                    {redeploying ? (
                      <svg className="animate-spin w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                    )}
                    <span>Redeploy</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mini Pipeline Strip */}
            <div className="px-4 py-2 bg-black/40 border-b border-white/[0.06] flex items-center justify-between text-[11px] font-medium mt-1">
              <div className="flex items-center gap-2 text-white/70">
                {isBuilding ? (
                  <StateSpinner color="white" size="xs" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${isSuccess ? "bg-emerald-400" : "bg-red-400"}`} />
                )}
                <span>
                  {isBuilding
                    ? `Stage ${deployment.stageIndex || 1}/${deployment.totalStages || 6}: ${deployment.currentStage || "In Progress"}`
                    : isSuccess
                    ? `All ${deployment.totalStages || 6} Pipeline Stages Completed`
                    : (deployment.failureReason ? `Halted: ${deployment.failureReason.slice(0, 35)}` : "Pipeline Stopped on Error")}
                </span>
              </div>
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Live Logs</span>
            </div>

            {/* Logs Terminal Box */}
            <div className="mx-3.5 my-3 p-3.5 bg-black/90 rounded-xl border border-white/[0.06] max-h-52 overflow-y-auto text-[11.5px] font-mono text-white/80 select-text">
              <pre ref={logRef} className="whitespace-pre-wrap leading-relaxed">
                {deployment.buildLogs || "Compiling container spec..."}
              </pre>
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-white/[0.06] bg-[#090909] flex items-center justify-between text-[11px] text-white/40">
              <div className="flex items-center gap-2">
                {isBuilding ? (
                  <StateSpinner color="white" size="xs" />
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? "bg-emerald-400" : "bg-red-400"}`} />
                )}
                <span>
                  {isBuilding
                    ? (deployment.currentStage ? `Executing ${deployment.currentStage}...` : "Streaming active deployment telemetry")
                    : isSuccess
                    ? "Deployment online & healthy"
                    : "Failure preserved for diagnosis"}
                </span>
              </div>
              <button
                onClick={onDismiss}
                className="hover:text-white transition-colors underline text-[11px] font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Prominent Bottom Floating Pill Button */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className="group cursor-pointer select-none flex items-center gap-3 px-4 py-2.5 rounded-2xl border transition-all duration-200 active:scale-98"
          style={{
            background: "#0e0e0e",
            borderColor: isBuilding ? "rgba(255, 255, 255, 0.18)" : isSuccess ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.35)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        >
          {/* Left Icon Badge */}
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
              isBuilding
                ? "bg-white/10 border border-white/20 text-white"
                : isSuccess
                ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                : "bg-red-500/15 border border-red-500/30 text-red-400"
            }`}
          >
            {isBuilding ? (
              <svg className="animate-spin text-white w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : isSuccess ? (
              <svg className="text-emerald-400 w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg className="text-red-400 w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
          </div>

          {/* Text Details */}
          <div className="flex flex-col min-w-0 pr-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-tight truncate max-w-[140px]">
                {deployment.name}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0 ${
                  isBuilding
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : isSuccess
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "bg-red-500/15 text-red-400 border border-red-500/30"
                }`}
              >
                {isBuilding ? "Building" : isSuccess ? "Healthy" : "Failed"}
              </span>
            </div>

            <span className="text-[11px] font-medium text-white/50 truncate max-w-[210px] mt-0.5">
              {isBuilding
                ? (deployment.currentStage ? `Stage ${deployment.stageIndex || 1}/${deployment.totalStages || 6}: ${deployment.currentStage}...` : "Compiling image & dependencies...")
                : isSuccess
                ? `Online on port :${deployment.port || 3000}`
                : (deployment.failureReason || "Build halted on error · Click for AI Troubleshooter")}
            </span>
          </div>

          {/* Right Up/Down Chevron */}
          <div className="w-6 h-6 rounded-lg bg-white/5 group-hover:bg-white/10 flex items-center justify-center text-white/40 group-hover:text-white transition-all flex-shrink-0">
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </div>

          {/* Quick Dismiss (X) Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/15 text-white/40 hover:text-white flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ml-0.5"
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Ray AI Troubleshooter Modal */}
      {showTroubleshooter && (
        <DeployDiagnosisModal
          isOpen={showTroubleshooter}
          onClose={() => setShowTroubleshooter(false)}
          deploymentId={deployment.id}
          projectName={deployment.name}
          logs={deployment.buildLogs}
          onRedeployStarted={() => {
            onRedeploy();
          }}
        />
      )}
    </>
  );
}

// ─── Main layout ──────────────────────────────────────────────────────────────

export default function ClientLayout({ children, user }: ClientLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalWidth, setTerminalWidth] = useState(460);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeDeployment, setActiveDeployment] = useState<ActiveDeployment | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dismissedDeploymentsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const widgetOffsetRight = terminalOpen && !isMobile ? `${terminalWidth + 20}px` : "20px";

  // Load persisted dismissed deployments on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("ray:dismissed-deployments");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => dismissedDeploymentsRef.current.add(id));
        }
      }
    } catch { /* ignore */ }
  }, []);

  const handleDismissDeployment = useCallback((id: string) => {
    dismissedDeploymentsRef.current.add(id);
    try {
      localStorage.setItem(
        "ray:dismissed-deployments",
        JSON.stringify(Array.from(dismissedDeploymentsRef.current))
      );
    } catch { /* ignore */ }
    setActiveDeployment(null);
  }, []);

  // Function to refresh active deployments
  const checkActiveDeployments = useCallback(async () => {
    try {
      const res = await fetch("/api/deployments/active");
      if (res.ok) {
        const data = await res.json();
        if (data.active) {
          if (!dismissedDeploymentsRef.current.has(data.active.id)) {
            setActiveDeployment(data.active);
          } else {
            setActiveDeployment(null);
          }
        } else {
          setActiveDeployment(null);
        }
      }
    } catch { /* silent */ }
  }, []);

  // Check active deployments & CI/CD status periodically
  useEffect(() => {
    let isMounted = true;

    // Auto-poll GitHub remotes for newly pushed commits every 15 seconds
    const pollGitRemotes = async () => {
      try {
        await fetch("/api/cicd/poll", { method: "POST" });
      } catch { /* silent */ }
    };

    checkActiveDeployments();
    const activeInterval = setInterval(checkActiveDeployments, 8000);
    const gitPollInterval = setInterval(pollGitRemotes, 45000);

    return () => {
      isMounted = false;
      clearInterval(activeInterval);
      clearInterval(gitPollInterval);
    };
  }, [checkActiveDeployments]);

  useEffect(() => {
    const sidebarW = 180;
    const half = Math.round((window.innerWidth - sidebarW) * 0.5);
    setTerminalWidth(Math.max(320, Math.min(800, half)));
  }, []);

  // Broadcast terminal state to ChatInterface whenever it changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ray:terminal-state", { detail: terminalOpen }));
  }, [terminalOpen]);

  // Close on escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        setTerminalOpen(false);
        setShowLogsModal(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Auto-open when AI runs a tool, monitor project is opened, or deployment starts
  useEffect(() => {
    const handleOpen = () => setTerminalOpen(true);
    window.addEventListener("ray:open-terminal", handleOpen);
    window.addEventListener("ray:open-monitor-project", handleOpen);
    window.addEventListener("ray:open-deploy", handleOpen);
    return () => {
      window.removeEventListener("ray:open-terminal", handleOpen);
      window.removeEventListener("ray:open-monitor-project", handleOpen);
      window.removeEventListener("ray:open-deploy", handleOpen);
    };
  }, []);

  // Handle toggle dispatched by ChatInterface header button
  useEffect(() => {
    const handler = () => setTerminalOpen((v) => !v);
    window.addEventListener("ray:toggle-terminal", handler);
    return () => window.removeEventListener("ray:toggle-terminal", handler);
  }, []);

  // Listen for deployment start, progress, and finish events across dashboard
  useEffect(() => {
    const handleDeployStart = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; projectPath?: string }>).detail;
      setActiveDeployment({
        id: `live-${Date.now()}`,
        type: "deployment",
        name: detail?.name || "Application",
        projectPath: detail?.projectPath,
        status: "building",
        buildLogs: `[INIT] Starting container deployment for ${detail?.name || "application"}...\n`,
        updatedAt: Date.now(),
      });
    };

    const handleDeployOutput = (e: Event) => {
      const detail = (e as CustomEvent<{ delta?: string }>).detail;
      const delta = detail?.delta || "";
      if (!delta) return;
      setActiveDeployment((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          buildLogs: (prev.buildLogs || "") + delta,
          updatedAt: Date.now(),
        };
      });
    };

    const handleDeployEnd = (e: Event) => {
      const detail = (e as CustomEvent<{ exit?: number }>).detail;
      const isErr = (detail?.exit ?? 0) !== 0;
      setActiveDeployment((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: isErr ? "failed" : "healthy",
          updatedAt: Date.now(),
        };
      });
      checkActiveDeployments();
    };

    window.addEventListener("ray:tool-deploy-start", handleDeployStart);
    window.addEventListener("ray:tool-deploy-output", handleDeployOutput);
    window.addEventListener("ray:tool-deploy-end", handleDeployEnd);
    window.addEventListener("ray:redeploy-triggered", checkActiveDeployments);
    window.addEventListener("ray:deployment-cancelled", checkActiveDeployments);
    return () => {
      window.removeEventListener("ray:tool-deploy-start", handleDeployStart);
      window.removeEventListener("ray:tool-deploy-output", handleDeployOutput);
      window.removeEventListener("ray:tool-deploy-end", handleDeployEnd);
      window.removeEventListener("ray:redeploy-triggered", checkActiveDeployments);
      window.removeEventListener("ray:deployment-cancelled", checkActiveDeployments);
    };
  }, [checkActiveDeployments]);

  // ─── Monitor SSE stream ───────────────────────────────────────────────────
  const addToast = useCallback((alert: { severity: string; message: string; projectName?: string }) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = {
      id,
      severity: alert.severity as Toast["severity"],
      message: alert.message,
      projectName: alert.projectName,
      createdAt: Date.now(),
    };
    setToasts((prev) => [...prev.slice(-4), toast]);

    // Dispatch event for sidebar badge update
    window.dispatchEvent(new Event("ray:monitor-alert"));

    // Auto-dismiss after 8s (critical: no auto-dismiss)
    if (alert.severity !== "critical") {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        toastTimersRef.current.delete(id);
      }, 8000);
      toastTimersRef.current.set(id, timer);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) { clearTimeout(timer); toastTimersRef.current.delete(id); }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource("/api/monitor/stream");

      es.addEventListener("alert", (e) => {
        try {
          const alert = JSON.parse(e.data);
          addToast({
            severity: alert.severity || "info",
            message: alert.message || "Unknown alert",
            projectName: alert.projectName,
          });
        } catch {
          // ignore parse errors
        }
      });

      es.onerror = () => {
        es?.close();
        // Retry after 30 seconds
        retryTimeout = setTimeout(connect, 30000);
      };
    };

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
      toastTimersRef.current.forEach((t) => clearTimeout(t));
    };
  }, [addToast]);

  const toggleTerminal = useCallback(() => setTerminalOpen((v) => !v), []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#000" }}>
      {/* Ambient page glow */}
      <div className="ray-ambient-glow" />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="ray-drawer-overlay lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <Sidebar
        user={user}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      {/* Main content area wrapped in inset rounded lighter-grey container on desktop, full height on mobile */}
      <div className="flex-1 flex overflow-hidden min-w-0 p-0 lg:p-2.5 lg:pl-2">
        <div
          className="flex flex-1 overflow-hidden min-w-0 rounded-none lg:rounded-[22px] border-0 lg:border relative"
          style={{
            background: "var(--color-panel-bg, #0c0c0c)",
            borderColor: "var(--color-panel-border, rgba(255,255,255,0.08))",
          }}
        >
          {/* Center column */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            {/* Mobile top bar */}
            <header
              className="flex items-center gap-3 px-4 py-3 border-b lg:hidden flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}
            >
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                style={{ color: "rgba(255,255,255,0.5)" }}
                aria-label="Open sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <Link href="/dashboard" className="flex items-center gap-2.5 flex-1 cursor-pointer">
                <Image src="/logo.svg" alt="Ray" width={28} height={28} className="w-[28px] h-[28px] object-contain" priority />
                <span className="font-jersey text-xl text-white tracking-wide">ray</span>
              </Link>

              {/* Terminal toggle in mobile top bar */}
              <button
                onClick={toggleTerminal}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150"
                style={{
                  color: terminalOpen ? "#fff" : "rgba(255,255,255,0.4)",
                  background: terminalOpen ? "rgba(255,255,255,0.07)" : "transparent",
                }}
                aria-label="Toggle Terminal"
                title="Toggle Terminal"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
            </header>

            <main className="flex-1 overflow-hidden flex flex-col relative z-10">
              {children}
            </main>
          </div>

          {/* Right Terminal Panel */}
          <TerminalPanel
            isOpen={terminalOpen}
            onClose={() => setTerminalOpen(false)}
            width={terminalWidth}
            onWidthChange={setTerminalWidth}
          />
        </div>
      </div>

      {/* Global Live Deployment Notification Widget at Bottom Right (Opens Upward) */}
      {activeDeployment && (
        <LiveDeploymentWidget
          deployment={activeDeployment}
          offsetRight={widgetOffsetRight}
          onRedeploy={checkActiveDeployments}
          onDismiss={() => handleDismissDeployment(activeDeployment.id)}
        />
      )}

      {/* Toast notifications stack */}
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        offsetRight={widgetOffsetRight}
      />
    </div>
  );
}
