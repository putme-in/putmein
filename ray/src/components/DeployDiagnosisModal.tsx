"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface DiagnosisData {
  summary: string;
  rootCause: string;
  fixSteps: string[];
  commands: string[];
  startCommand?: string;
  canAutoFix?: boolean;
  securityScanId?: string;
}

const SparklesIcon = ({ size = 15, color = "#fff" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
  </svg>
);

const SpinIcon = ({ size = 16 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export interface DeployDiagnosisModalProps {
  isOpen: boolean;
  onClose: () => void;
  deploymentId?: string;
  projectName?: string;
  deploymentName?: string;
  logs?: string;
  buildLogs?: string;
  onRedeployStarted?: () => void;
  onRedeploySuccess?: () => void;
}

export default function DeployDiagnosisModal({
  isOpen,
  onClose,
  deploymentId,
  projectName,
  deploymentName,
  logs,
  buildLogs,
  onRedeployStarted,
  onRedeploySuccess,
}: DeployDiagnosisModalProps) {
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState<DiagnosisData | null>(null);
  const [diagError, setDiagError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixLogs, setFixLogs] = useState("");
  const [fixError, setFixError] = useState("");

  const effectiveName = deploymentName || projectName || "Deployment";
  const effectiveLogs = logs || buildLogs || "";

  const runDiagnosis = useCallback(async () => {
    const targetId = deploymentId || "adhoc";
    setLoading(true);
    setDiagError("");
    try {
      const selectedModel = typeof window !== "undefined" ? localStorage.getItem("ray_selected_model") : "";
      const res = await fetch(`/api/deployments/${encodeURIComponent(targetId)}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logs: effectiveLogs,
          modelId: selectedModel || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Diagnosis failed");
      setDiagnosis(data.diagnosis || null);
    } catch (err: unknown) {
      setDiagError(err instanceof Error ? err.message : "Failed to diagnose deployment failure");
    } finally {
      setLoading(false);
    }
  }, [deploymentId, effectiveLogs]);

  useEffect(() => {
    if (isOpen) {
      runDiagnosis();
    } else {
      setDiagnosis(null);
      setFixLogs("");
      setFixError("");
    }
  }, [isOpen, runDiagnosis]);

  const handleApplyFixAndRedeploy = async () => {
    if (!deploymentId || diagnosis?.securityScanId) return;
    setFixing(true);
    setFixError("");
    setFixLogs("Requesting deployment retry...\n");

    try {
      if (deploymentId) {
        // Trigger redeploy via action endpoint
        const res = await fetch(`/api/deploy/${encodeURIComponent(deploymentId)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "redeploy" }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to trigger redeployment");
        }
      }

      setFixLogs((prev) => prev + "Deployment retry dispatched to engine.\nClosing troubleshooter...");
      setTimeout(() => {
        setFixing(false);
        onClose();
        if (onRedeployStarted) onRedeployStarted();
        if (onRedeploySuccess) onRedeploySuccess();
      }, 900);
    } catch (err: unknown) {
      setFixError(err instanceof Error ? err.message : "Redeployment failed to trigger");
      setFixing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[250] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in p-4 font-sans select-text"
      onClick={(e) => {
        if (e.target === e.currentTarget && !fixing) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-card border border-card-border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden p-[20px]"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              <SparklesIcon size={16} color="#ffffff" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Ray AI Troubleshooter</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold uppercase tracking-wider">
                  Deployment Diagnostic
                </span>
              </div>
              <p className="text-xs text-white/50 mt-0.5">
                Analyzing failure trace and Docker build errors for <span className="text-white font-medium">{effectiveName}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={fixing}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white transition-colors cursor-pointer"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            ✕
          </button>
        </div>

        {/* Content States */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-card-border)" }}
            >
              <SpinIcon size={20} />
            </div>
            <p className="text-sm font-semibold text-white mt-1">Analyzing Build Logs & Container Spec…</p>
            <p className="text-xs max-w-sm text-white/40">
              Examining stdout/stderr logs, framework dependencies, Dockerfile configurations, and exit codes.
            </p>
          </div>
        ) : diagError ? (
          <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-xs text-red-400 font-semibold mb-1">Diagnostic Analysis Failed</p>
            <p className="text-xs text-red-300/80 mb-3 whitespace-pre-wrap leading-relaxed">{diagError}</p>
            <button
              onClick={runDiagnosis}
              className="ray-btn-ghost text-xs px-3.5 py-1.5 cursor-pointer font-medium"
            >
              Retry Diagnosis
            </button>
          </div>
        ) : diagnosis ? (
          <div className="flex flex-col gap-3.5">
            {/* Problem Identified */}
            <div
              className="p-4 rounded-xl flex items-start gap-3"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.22)",
              }}
            >
              <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 bg-red-500" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-red-400 uppercase tracking-wider">Problem Identified</p>
                <p className="text-sm font-semibold text-white mt-0.5 leading-snug">{diagnosis.summary}</p>
              </div>
            </div>

            {/* Root Cause Analysis */}
            <div
              className="p-4 rounded-xl"
              style={{
                background: "var(--color-card)",
                border: "1px solid var(--color-card-border)",
              }}
            >
              <p className="ray-eyebrow mb-1.5">Root Cause Analysis</p>
              <p className="text-xs leading-relaxed text-white/80">
                {diagnosis.rootCause}
              </p>
            </div>

            {/* Recommended Remediation Plan */}
            {diagnosis.fixSteps && diagnosis.fixSteps.length > 0 && (
              <div
                className="p-4 rounded-xl flex flex-col gap-2.5"
                style={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-card-border)",
                }}
              >
                <p className="ray-eyebrow">Recommended Remediation Plan</p>
                <ul className="flex flex-col gap-2">
                  {diagnosis.fixSteps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-xs text-white/85 leading-relaxed">
                      <span
                        className="w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          color: "#ffffff",
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>

                {/* Commands Preview */}
                {diagnosis.commands && diagnosis.commands.length > 0 && (
                  <div className="rounded-xl p-3 overflow-x-auto mt-1" style={{ background: "#020202", border: "1px solid var(--color-card-border)" }}>
                    <p className="text-[10px] uppercase font-bold tracking-wider mb-1.5 text-white/30">
                      Recommended Fix Commands
                    </p>
                    {diagnosis.commands.map((c, i) => (
                      <div key={i} className="text-xs font-mono text-white/90 flex items-center gap-1.5">
                        <span className="text-white/30 select-none">$</span> {c}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Execution / Error Logs */}
            {fixLogs && (
              <div className="p-3.5 rounded-xl font-mono text-xs max-h-36 overflow-y-auto leading-relaxed" style={{ background: "#020202", border: "1px solid var(--color-card-border)" }}>
                <pre className="text-emerald-400 whitespace-pre-wrap">{fixLogs}</pre>
              </div>
            )}

            {fixError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                {fixError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-white/[0.08] gap-3">
              <button
                onClick={runDiagnosis}
                disabled={fixing}
                className="ray-btn-ghost text-xs px-3 py-2 cursor-pointer"
              >
                Re-analyze Logs
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={fixing}
                  className="ray-btn-ghost text-xs px-3.5 py-2 cursor-pointer"
                >
                  Close
                </button>
                {diagnosis.securityScanId ? <Link href={`/security?scanId=${encodeURIComponent(diagnosis.securityScanId)}`} onClick={onClose} className="ray-btn-primary text-xs px-4 py-2">Review security findings</Link> : deploymentId ? <button
                  onClick={handleApplyFixAndRedeploy}
                  disabled={fixing}
                  className="bg-white text-black hover:bg-white/90 font-bold text-xs px-4 py-2 rounded-xl transition-all active:scale-95 shadow-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {fixing ? (
                    <>
                      <SpinIcon size={13} />
                      <span>Redeploying...</span>
                    </>
                  ) : (
                    <>
                      <SparklesIcon size={13} color="#000" />
                      <span>Retry deployment</span>
                    </>
                  )}
                </button> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
