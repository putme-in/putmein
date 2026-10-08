"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";

export interface PipelineFlowProps {
  currentStep: string;
  flowState: "idle" | "uploading" | "analyzing" | "ready" | "deploying" | "success" | "error";
  dockerEnabled: boolean;
  projectName: string;
  buildLogs: string;
  errorMessage: string;
  liveUrl: string | null;
  containerName: string | null;
  onRetry: () => void;
  onTroubleshoot: () => void;
  chatMode?: boolean;
}

interface StepDef {
  id: string;
  title: string;
  subtitle: string;
  matchSteps: string[];
}

export default function DeploymentPipelineFlow({
  currentStep,
  flowState,
  dockerEnabled,
  projectName,
  buildLogs,
  errorMessage,
  liveUrl,
  containerName,
  onRetry,
  onTroubleshoot,
  chatMode = false,
}: PipelineFlowProps) {
  const [showFullLogs, setShowFullLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when logs update and drawer is open
  useEffect(() => {
    if (showFullLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [buildLogs, showFullLogs]);

  const pipelineSteps: StepDef[] = [
    {
      id: "source",
      title: "Source",
      subtitle: "Project archive & integrity check",
      matchSteps: ["source_check", "source", "upload", "prepare"],
    },
    { id: "security", title: "Security", subtitle: "Source checks and deployment policy", matchSteps: ["security"] },
    {
      id: "container",
      title: dockerEnabled ? "Docker Container" : "Host Environment",
      subtitle: dockerEnabled ? "Containerize & image spec" : "Process runtime environment",
      matchSteps: ["dockerize", "container", "spec", "init"],
    },
    {
      id: "build",
      title: "Build",
      subtitle: "Install packages & compile",
      matchSteps: ["building", "build", "compile"],
    },
    {
      id: "deploy",
      title: "Launch",
      subtitle: dockerEnabled ? "Launch container & bind port" : "Spawn managed host process",
      matchSteps: ["launching", "launch", "deploy"],
    },
    {
      id: "verify",
      title: "Health",
      subtitle: "HTTP readiness probe & healthcheck",
      matchSteps: ["healthcheck", "verify", "monitor", "complete"],
    },
  ];

  // Helper to determine the status of each node
  const getStepStatus = (index: number): "pending" | "running" | "success" | "error" => {
    if (flowState === "success") return "success";
    if (flowState === "error") {
      const activeIdx = pipelineSteps.findIndex((s) => s.matchSteps.includes(currentStep.toLowerCase()));
      if (activeIdx === -1) {
        return index === 0 ? "error" : "pending";
      }
      if (index < activeIdx) return "success";
      if (index === activeIdx) return "error";
      return "pending";
    }

    if (flowState === "deploying" || flowState === "uploading" || flowState === "analyzing") {
      const activeIdx = pipelineSteps.findIndex((s) => s.matchSteps.includes(currentStep.toLowerCase()));
      const safeActiveIdx = activeIdx === -1 ? 0 : activeIdx;
      if (index < safeActiveIdx) return "success";
      if (index === safeActiveIdx) return "running";
      return "pending";
    }

    return "pending";
  };

  const completedCount = pipelineSteps.filter((_, index) => getStepStatus(index) === "success").length;
  const scanId = (errorMessage + "\n" + buildLogs).match(/\bscan_\d+\b/)?.[0];

  // Extract recent log line for compact preview
  const logLines = buildLogs.trim().split("\n").filter(Boolean);
  const lastLogLine = logLines.length > 0 ? logLines[logLines.length - 1] : "Initializing deployment stream...";

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      {/* ─── Main Pipeline Card (Static container without hover brightening) ─ */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#090909] p-6 shadow-xl relative overflow-hidden">
        {/* Card Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="ray-eyebrow">
                {dockerEnabled ? "Container Pipeline" : "Host Process Pipeline"}
              </span>
              <span className="text-white/20">·</span>
              <span className="text-[11px] font-mono text-white/50">
                {completedCount} of {pipelineSteps.length} stages complete
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2.5">
              <span>{projectName || "Application"}</span>
              {flowState === "deploying" && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-xs font-mono text-white/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span>{currentStep.toUpperCase()}</span>
                </span>
              )}
              {flowState === "success" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>ONLINE</span>
                </span>
              )}
              {flowState === "error" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span>FAILED</span>
                </span>
              )}
            </h2>
          </div>

          {/* Quick Actions in Header */}
          <div className="flex items-center gap-2 shrink-0">
            {flowState === "error" && !chatMode && (
              <button
                type="button"
                onClick={onTroubleshoot}
                className="ray-btn-ghost text-xs px-3 py-1.5 text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50 flex items-center gap-1.5 cursor-pointer"
              >
                <Icon icon="lucide:sparkles" width={13} height={13} />
                <span>AI Troubleshoot</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowFullLogs(!showFullLogs)}
              className="ray-btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer"
            >
              <Icon icon="lucide:terminal" width={13} height={13} />
              <span>{showFullLogs ? "Hide Terminal" : "Show More"}</span>
              <Icon
                icon="lucide:chevron-down"
                width={12}
                height={12}
                className={`transition-transform duration-200 ${showFullLogs ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        </div>

        <ol aria-label="Deployment stages" className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mb-6 border-t border-white/[0.08]">
          {pipelineSteps.map((step, index) => {
            const status = getStepStatus(index);
            return <li key={step.id} aria-current={status === "running" || status === "error" ? "step" : undefined} className="flex items-start gap-3 py-3 border-b border-white/[0.06]">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs ${status === "error" ? "bg-red-500/10 text-red-400" : status === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/50"}`}>
                {status === "success" ? "✓" : status === "error" ? "!" : status === "running" ? <Icon icon="lucide:loader-circle" className="animate-spin" width={14} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2 text-xs"><span className={status === "error" ? "font-medium text-red-400" : "font-medium text-white/80"}>{step.title}</span><span className="text-white/40">{status === "error" ? "Blocked" : status === "success" ? "Done" : status === "running" ? "In progress" : "Waiting"}</span></div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">{step.subtitle}</p>
              </div>
            </li>;
          })}
        </ol>

        {/* ─── Compact Live Status Strip ────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/60 border border-white/[0.06] text-xs font-mono">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                flowState === "success"
                  ? "bg-emerald-400"
                  : flowState === "error"
                  ? "bg-red-400"
                  : "bg-white animate-pulse"
              }`}
            />
            <span className="text-white/70 truncate">{lastLogLine}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowFullLogs(!showFullLogs)}
            className="text-[11px] text-white/50 hover:text-white underline cursor-pointer shrink-0"
          >
            {showFullLogs ? "Close Terminal" : "View Full Log"}
          </button>
        </div>

        {/* ─── Expandable Full Terminal Log Drawer ("Show More") ────────────── */}
        {showFullLogs && (
          <div className="mt-4 animate-fade-in flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-white/40 px-1">
              <span>DEPLOYMENT TERMINAL STREAM</span>
              <span>{logLines.length} lines</span>
            </div>
            <div className="p-4 rounded-xl bg-black border border-white/[0.08] font-mono text-xs text-white/80 h-72 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text shadow-inner">
              {buildLogs}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ─── Error State Details ─────────────────────────────────────────── */}
        {flowState === "error" && (
          <div className="mt-5 p-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
            <div>
              <span className="text-xs font-bold text-red-400 block">
                Deployment Pipeline Error
              </span>
              <p className="text-xs text-white/70 mt-0.5 leading-relaxed">
                {errorMessage || "Build or application execution halted unexpectedly."}
              </p>
            </div>
            {chatMode ? <p className="text-xs text-white/60">Deployment remains stopped. Chat investigates recorded failures and explains any attention needed.</p> : <div className="flex flex-wrap items-center gap-2 shrink-0">
              {scanId && <Link href={`/security?scanId=${encodeURIComponent(scanId)}`} className="ray-btn-primary text-xs px-3 py-1.5">Review security findings</Link>}
              <button
                type="button"
                onClick={onTroubleshoot}
                className="ray-btn-primary text-xs px-3 py-1.5 font-medium flex items-center gap-1 cursor-pointer"
              >
                <Icon icon="lucide:sparkles" width={12} height={12} />
                <span>Analyze Root Cause</span>
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="ray-btn-ghost text-xs px-3 py-1.5 cursor-pointer"
              >
                <span>Retry</span>
              </button>
            </div>}
          </div>
        )}

        {/* ─── Success State Details ───────────────────────────────────────── */}
        {flowState === "success" && (
          <div className="mt-5 p-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] flex flex-col gap-4 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-sm font-bold text-emerald-400 block">
                  ✓ {dockerEnabled ? "Container Deployment Active & Healthy" : "Host Process Deployment Active"}
                </span>
                <p className="text-xs text-white/70 mt-0.5 font-mono">
                  {dockerEnabled ? (
                    <>
                      Running in container{" "}
                      <span className="text-white font-semibold">
                        {containerName || `ray-${projectName}`}
                      </span>
                    </>
                  ) : (
                    "Running directly on the host with live output captured"
                  )}
                </p>
              </div>

              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ray-btn-primary text-xs px-4 py-2 font-bold flex items-center gap-1.5 cursor-pointer shadow-lg"
                >
                  <span>Open Live Application</span>
                  <Icon icon="lucide:external-link" width={13} height={13} />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 border-t border-emerald-500/15 text-xs text-white/60">
              <div className="flex items-center gap-1.5">
                <Icon icon="lucide:check" width={14} height={14} className="text-emerald-400" />
                <span>Added to Projects</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Icon icon="lucide:check" width={14} height={14} className="text-emerald-400" />
                <span>{dockerEnabled ? "Container registered" : "Host process registered"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Icon icon="lucide:check" width={14} height={14} className="text-emerald-400" />
                <span>Security report generated</span>
              </div>
            </div>

            {/* Quick Navigation Links */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Link
                href={dockerEnabled ? "/containers" : "/projects"}
                className="ray-btn-ghost text-xs px-3 py-1.5 text-white/70 hover:text-white"
              >
                {dockerEnabled ? "View in Containers" : "View in Projects"}
              </Link>
              <Link
                href="/projects"
                className="ray-btn-ghost text-xs px-3 py-1.5 text-white/70 hover:text-white"
              >
                View in Projects
              </Link>
              <Link
                href="/dashboard"
                className="ray-btn-ghost text-xs px-3 py-1.5 text-white/70 hover:text-white"
              >
                Return to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
