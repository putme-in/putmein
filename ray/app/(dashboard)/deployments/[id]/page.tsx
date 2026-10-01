"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";
import { getPrimaryProjectUrl } from "@/lib/domains";

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function DeploymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [deployment, setDeployment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDeployment = useCallback(async () => {
    try {
      const res = await fetch(`/api/deployments/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDeployment(data.deployment || null);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/deploy/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        fetchDeployment();
      }
    } catch { /* silent */ }
    finally {
      setCancelling(false);
    }
  };

  const handleRedeploy = async () => {
    setRedeploying(true);
    try {
      const res = await fetch(`/api/deploy/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redeploy" }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event("ray:redeploy-triggered"));
        fetchDeployment();
      }
    } catch { /* silent */ }
    finally {
      setRedeploying(false);
    }
  };

  useEffect(() => {
    fetchDeployment();
    const interval = setInterval(fetchDeployment, 5000);
    return () => clearInterval(interval);
  }, [fetchDeployment]);

  if (!deployment && loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-white/40 font-sans">
        <SpinIcon /><span className="text-xs font-medium">Loading deployment details…</span>
      </div>
    );
  }

  const effectiveUrl = getPrimaryProjectUrl(deployment?.deployUrl, deployment?.hostPort) || (deployment?.hostPort ? `http://localhost:${deployment.hostPort}` : null);
  const isFailed = deployment?.status === "failed";
  const containerName = deployment?.containerName || `ray-${deployment?.name}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden font-sans">
      {/* Top Header */}
      <div className="p-6 border-b border-white/[0.08] flex items-center justify-between gap-4 flex-shrink-0 bg-[#0c0c0c]">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => router.push("/deployments")}
            className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/10 transition-all cursor-pointer flex-shrink-0"
            title="Back to Deployments"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>

          {/* Large Technology Icon */}
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm">
            <Icon icon={deployment?.icon || (deployment?.isDocker ? "logos:docker-icon" : "logos:nodejs-icon")} width={24} height={24} className="shrink-0" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-jersey text-3xl text-white tracking-wide">
                {deployment?.name}
              </h1>

              {/* 1. Framework badge (First) */}
              {deployment?.framework && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                    deployment.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                  }`}
                >
                  <Icon icon={deployment.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                  <span>{deployment.framework.toLowerCase()}</span>
                </span>
              )}

              {/* 2. Docker badge (Second) */}
              {deployment?.isDocker && (
                <Link
                  href="/containers"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer"
                  title="View Docker Container"
                >
                  <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                  <span>docker</span>
                </Link>
              )}

              {/* 3. Status badge (Third, without dots) */}
              {deployment?.status === "healthy" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.1] border border-emerald-500/25 text-[10.5px] font-mono text-emerald-300">
                  <Icon icon="lucide:check-circle-2" width={11} height={11} className="text-emerald-400" />
                  <span>healthy</span>
                </span>
              ) : deployment?.status === "building" || deployment?.status === "deploying" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/[0.1] border border-amber-500/25 text-[10.5px] font-mono text-amber-300">
                  <SpinIcon size={10} />
                  <span>{deployment?.status}…</span>
                </span>
              ) : deployment?.status === "failed" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-500/[0.15] border border-red-500/30 text-[10.5px] font-mono text-red-300">
                  <Icon icon="lucide:alert-triangle" width={11} height={11} className="text-red-400" />
                  <span>failed</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[10.5px] font-mono text-white/50">
                  <span>{deployment?.status}</span>
                </span>
              )}

              {/* 4. Port badge (Fourth) */}
              {deployment?.hostPort && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[11px] font-mono text-blue-300">
                  <Icon icon="lucide:radio" width={11} height={11} className="text-blue-400/80" />
                  <span>:{deployment.hostPort}</span>
                </span>
              )}
            </div>

            <p className="text-[11px] font-mono text-white/40 truncate mt-0.5">
              Container: {containerName} · Path: {deployment?.projectPath}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {effectiveUrl && (
            <a
              href={effectiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <span>Open App ↗</span>
            </a>
          )}

          {(deployment?.status === "building" || deployment?.status === "deploying") && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
              title="Cancel build"
            >
              {cancelling ? (
                <SpinIcon size={12} />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
              )}
              <span>{cancelling ? "Cancelling…" : "Cancel Build"}</span>
            </button>
          )}

          <button
            onClick={() => setShowTroubleshooter(true)}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
          >
            <span>⚡</span>
            <span>Ray AI Troubleshooter</span>
          </button>

          <button
            onClick={handleRedeploy}
            disabled={redeploying || deployment?.status === "building"}
            className="ray-btn-primary flex items-center gap-1.5 text-xs px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {redeploying ? (
              <SpinIcon size={12} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            )}
            <span>{redeploying ? "Redeploying…" : "Redeploy"}</span>
          </button>
        </div>
      </div>

      {/* Failure Banner */}
      {isFailed && (
        <div className="px-6 py-3.5 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-base">⚠️</span>
            <div>
              <p className="text-xs font-bold text-red-300">Deployment Failed</p>
              <p className="text-[11px] text-red-300/70 mt-0.5">
                The build or container launch failed. Ray AI Troubleshooter can diagnose root cause and suggest quick fixes.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowTroubleshooter(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <span>⚡</span>
            <span>Diagnose with Ray AI</span>
          </button>
        </div>
      )}

      {/* Build Logs Terminal */}
      <div className="flex-1 overflow-y-auto p-6 font-mono text-xs leading-relaxed bg-[#050505] text-[#e2e8f0] select-text">
        <div className="mb-3 flex items-center justify-between text-[11px] text-white/40 border-b border-white/[0.06] pb-2">
          <span>── Build & Deployment Logs ────────────────────────────</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(deployment?.buildLogs || "");
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
          >
            {copied ? "Copied!" : "Copy Logs"}
          </button>
        </div>
        <pre className="whitespace-pre-wrap font-mono">
          {deployment?.buildLogs || "No build logs recorded."}
        </pre>
      </div>

      {/* Diagnosis Modal */}
      <DeployDiagnosisModal
        isOpen={showTroubleshooter}
        onClose={() => setShowTroubleshooter(false)}
        deploymentId={deployment?.id}
        deploymentName={deployment?.name || "Deployment"}
        buildLogs={deployment?.buildLogs || undefined}
        onRedeploySuccess={() => {
          fetchDeployment();
        }}
      />
    </div>
  );
}
