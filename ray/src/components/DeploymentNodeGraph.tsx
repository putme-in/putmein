"use client";

import { useState, useRef, useEffect } from "react";
import { getPrimaryProjectUrl } from "@/lib/domains";

export interface DeployStepState {
  step: string;
  status: "pending" | "running" | "success" | "error";
  message: string;
  logDelta?: string;
  port?: number;
  url?: string;
  container?: string;
}

interface DeploymentNodeGraphProps {
  projectName: string;
  steps: DeployStepState[];
  isDeploying: boolean;
  deployUrl?: string | null;
  hostPort?: number | null;
  containerName?: string | null;
  buildLogs?: string | null;
  onRestart?: () => void;
  onViewLogs?: () => void;
}

interface PipelineNodeDef {
  id: string;
  title: string;
  subtitle: string;
  icon: (active: boolean) => React.ReactNode;
}

const PIPELINE_NODES: PipelineNodeDef[] = [
  {
    id: "source_check",
    title: "Source Verification",
    subtitle: "Validate project files & git workspace",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
        <line x1="8" y1="16" x2="8.01" y2="16" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
        <line x1="16" y1="16" x2="16.01" y2="16" />
      </svg>
    ),
  },
  {
    id: "dockerize",
    title: "Spec & Dockerfile",
    subtitle: "Framework detection & container spec",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    id: "building",
    title: "Docker Build",
    subtitle: "Compiling image & dependency layers",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "launching",
    title: "Container Launch",
    subtitle: "Port binding & isolated container run",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  },
  {
    id: "healthcheck",
    title: "Port & Healthcheck",
    subtitle: "HTTP readiness probe & port verify",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "monitoring",
    title: "Live & Monitored",
    subtitle: "Container online & 24/7 logging",
    icon: () => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

export default function DeploymentNodeGraph({
  projectName,
  steps,
  isDeploying,
  deployUrl,
  hostPort,
  containerName,
  buildLogs,
  onRestart,
  onViewLogs,
}: DeploymentNodeGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const buildLogsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll build logs to bottom when new logs stream in
  useEffect(() => {
    if (buildLogsRef.current) {
      buildLogsRef.current.scrollTop = buildLogsRef.current.scrollHeight;
    }
  }, [buildLogs]);

  // Map incoming step events to pipeline nodes
  const stepMap = new Map<string, DeployStepState>();
  for (const s of steps) {
    stepMap.set(s.step, s);
    if (s.step === "complete") {
      stepMap.set("monitoring", { ...s, step: "monitoring" });
    }
  }

  // Calculate overall progress percentage
  let completedCount = 0;
  PIPELINE_NODES.forEach((n) => {
    const s = stepMap.get(n.id);
    if (s?.status === "success") completedCount++;
  });
  const progressPercent = Math.round((completedCount / PIPELINE_NODES.length) * 100);

  const activeUrl = getPrimaryProjectUrl(deployUrl, hostPort) || (hostPort ? `http://localhost:${hostPort}` : null);

  return (
    <div className="flex flex-col h-full bg-card text-white select-none overflow-hidden font-sans">
      {/* ── Top Floating Island Header ── */}
      <div className="mx-3 mt-3 mb-2 p-3.5 rounded-2xl bg-card border border-card-border flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
              isDeploying
                ? "bg-white/[0.08] border border-white/20 text-white"
                : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
            }`}
          >
            {isDeploying ? (
              <svg className="animate-spin text-white w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg className="text-emerald-400 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight truncate">
                {projectName || "Application"}
              </span>
              {hostPort && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  :{hostPort}
                </span>
              )}
            </div>
            <p className="text-[11px] font-medium text-white/50 mt-0.5 truncate">
              {isDeploying ? `Deploying pipeline (${progressPercent}% complete)` : "Container pipeline active & healthy"}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {activeUrl && (
            <a
              href={activeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all flex items-center gap-1.5 active:scale-95"
            >
              <span>Open</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
          {onRestart && (
            <button
              onClick={onRestart}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all active:scale-95 cursor-pointer"
            >
              Restart
            </button>
          )}
        </div>
      </div>

      {/* ── Centered Node Flow Canvas ── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col">
        <div className="flex items-center justify-between mb-2 max-w-sm w-full mx-auto">
          <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
            Pipeline Architecture ({completedCount}/{PIPELINE_NODES.length})
          </span>
          <span className={`text-[11px] font-bold ${completedCount === PIPELINE_NODES.length ? "text-emerald-400" : "text-white/60"}`}>
            {progressPercent}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-sm mx-auto h-1.5 bg-white/5 rounded-full overflow-hidden mb-4 border border-white/5">
          <div
            className={`h-full transition-all duration-500 ease-out rounded-full ${
              completedCount === PIPELINE_NODES.length
                ? "bg-emerald-400"
                : "bg-white/80"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Centered Node Graph Sequence */}
        <div className="flex flex-col items-center w-full max-w-sm mx-auto pb-4">
          {PIPELINE_NODES.map((node, index) => {
            const stepState = stepMap.get(node.id);
            const isLast = index === PIPELINE_NODES.length - 1;

            let status: "pending" | "running" | "success" | "error" = "pending";
            if (stepState) {
              status = stepState.status;
            } else if (!isDeploying && completedCount === PIPELINE_NODES.length) {
              status = "success";
            }

            const isSelected = selectedNodeId === node.id;
            const message = stepState?.message || node.subtitle;

            return (
              <div key={node.id} className="w-full flex flex-col items-center">
                {/* Node Box */}
                <div
                  onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                  className={`w-full p-3 rounded-2xl border transition-all duration-150 cursor-pointer ${
                    status === "success"
                      ? isSelected
                        ? "bg-[#111111] border-emerald-500/40"
                        : "bg-card border-emerald-500/20 hover:border-emerald-500/35 hover:bg-card"
                      : status === "running"
                      ? isSelected
                        ? "bg-[#161616] border-white/40"
                        : "bg-[#121212] border-white/20 hover:border-white/30"
                      : status === "error"
                      ? "bg-[#130b0b] border-red-500/30 hover:border-red-500/40"
                      : isSelected
                      ? "bg-[#111111] border-white/20"
                      : "bg-[#0a0a0a] border-card-border hover:border-white/12 hover:bg-card"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Node Icon Box */}
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        status === "success"
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : status === "running"
                          ? "bg-white/10 border border-white/20 text-white"
                          : status === "error"
                          ? "bg-red-500/10 border border-red-500/20 text-red-400"
                          : "bg-white/[0.03] border border-white/[0.06] text-white/25"
                      }`}
                    >
                      {status === "running" ? (
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      ) : status === "success" ? (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : status === "error" ? (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      ) : (
                        node.icon(false)
                      )}
                    </div>

                    {/* Node Title & Description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`text-xs font-bold tracking-tight truncate ${status === "success" ? "text-white" : status === "pending" ? "text-white/40" : "text-white"}`}>
                          {node.title}
                        </span>

                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0 ${
                            status === "success"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : status === "running"
                              ? "bg-white/15 text-white border border-white/25"
                              : status === "error"
                              ? "bg-red-500/10 text-red-400 border border-red-500/20"
                              : "bg-white/[0.03] text-white/25 border border-white/[0.05]"
                          }`}
                        >
                          {status}
                        </span>
                      </div>

                      <p
                        className={`text-[11px] font-medium truncate leading-tight ${
                          status === "success"
                            ? "text-white/50"
                            : status === "running"
                            ? "text-white/80"
                            : status === "error"
                            ? "text-red-300/80"
                            : "text-white/25"
                        }`}
                      >
                        {message}
                      </p>
                    </div>
                  </div>

                  {/* Expandable Inspection Drawer */}
                  {isSelected && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.08] text-[11px] font-mono text-white/70 select-text animate-fade-in">
                      {stepState?.logDelta ? (
                        <pre className="p-2.5 rounded-xl bg-black/80 border border-white/[0.08] max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed text-white/90">
                          {stepState.logDelta}
                        </pre>
                      ) : (
                        <div className="text-white/40 italic px-1">
                          Node: {node.title} — {status === "success" ? "Completed successfully." : status === "running" ? "Currently processing task..." : status === "error" ? "Execution failed at this step." : "Pending execution queue."}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Centered Connector Line between nodes */}
                {!isLast && (
                  <div className="flex flex-col items-center justify-center my-1.5 h-6">
                    <div
                      className={`w-[2px] h-full transition-colors relative ${
                        status === "success"
                          ? "bg-emerald-500/35"
                          : status === "running"
                          ? "bg-white/30"
                          : "bg-white/[0.08]"
                      }`}
                    >
                      <div
                        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-black ${
                          status === "success"
                            ? "bg-emerald-400"
                            : status === "running"
                            ? "bg-white"
                            : "bg-white/20"
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom Build Logs Drawer ── */}
      {buildLogs && (
        <div className="mx-3 mb-3 p-3 rounded-2xl border border-card-border bg-card flex flex-col gap-1.5 flex-shrink-0">
          <div className="flex items-center justify-between text-[10px] font-bold text-white/50 uppercase tracking-wider">
            <span>Live Container Build Logs</span>
            {onViewLogs && (
              <button onClick={onViewLogs} className="hover:text-white transition-colors cursor-pointer font-semibold underline">
                View All
              </button>
            )}
          </div>
          <div
            ref={buildLogsRef}
            className="max-h-24 overflow-y-auto p-2 rounded-xl bg-black font-mono text-[10px] text-white/70 whitespace-pre-wrap select-text border border-white/5"
          >
            {buildLogs}
          </div>
        </div>
      )}
    </div>
  );
}


