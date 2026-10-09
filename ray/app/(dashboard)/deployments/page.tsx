"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";
import { getPrimaryProjectUrl } from "@/lib/domains";

interface DeploymentItem {
  id: string;
  name: string;
  sourceType: string;
  runtime?: "host" | "docker";
  repoUrl?: string | null;
  branch?: string | null;
  commitHash?: string | null;
  commitMessage?: string | null;
  projectPath: string;
  containerName?: string | null;
  hostPort?: number | null;
  status: "pending" | "building" | "deploying" | "healthy" | "failed" | "stopped";
  deployUrl?: string | null;
  buildLogs?: string | null;
  createdAt: string;
  framework?: string;
  frameworkSlug?: string;
  language?: string;
  icon?: string;
  colorClasses?: string;
  isDocker?: boolean;
  container?: {
    id: string;
    name: string;
    state: string;
    port?: number;
    image?: string;
    url?: string;
  } | null;
}

interface PortClaim {
  port: number;
  name: string;
  type: string;
  source: string;
  status: string;
  url?: string;
  containerName?: string;
}

interface PortConflictItem {
  port: number;
  deploymentId?: string;
  deploymentName: string;
  conflictingWith: string;
  reason: string;
}

interface PortRegistryState {
  claimed: PortClaim[];
  reserved: number[];
  nextFreePort: number;
  suggestedPorts: number[];
  conflicts?: PortConflictItem[];
  stats?: {
    totalClaimed: number;
    projectPortsCount: number;
    deploymentPortsCount: number;
    dockerPortsCount: number;
    systemListenersCount: number;
    conflictsCount?: number;
  };
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function DeploymentsPage() {
  const router = useRouter();
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedLogsDep, setSelectedLogsDep] = useState<DeploymentItem | null>(null);
  const [troubleshootDep, setTroubleshootDep] = useState<DeploymentItem | null>(null);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [portRegistry, setPortRegistry] = useState<PortRegistryState | null>(null);
  const [showAllPorts, setShowAllPorts] = useState(false);
  const [reallocatingId, setReallocatingId] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const [res, portRes] = await Promise.all([
        fetch("/api/deployments"),
        fetch("/api/ports").catch(() => null),
      ]);
      if (res.ok) {
        const data = await res.json();
        setDeployments(data.deployments || []);
      }
      if (portRes && portRes.ok) {
        const pData = await portRes.json();
        setPortRegistry(pData);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  const handleReallocatePort = async (depId: string) => {
    setReallocatingId(depId);
    try {
      const res = await fetch(`/api/deployments/${depId}/reallocate`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchDeployments();
      }
    } catch {
      /* silent */
    } finally {
      setReallocatingId(null);
    }
  };

  const handleRedeploy = async (dep: DeploymentItem) => {
    setRedeployingId(dep.id);
    try {
      const res = await fetch(`/api/deploy/${dep.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "redeploy" }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event("ray:redeploy-triggered"));
        fetchDeployments();
      }
    } catch { /* silent */ }
    finally {
      setRedeployingId(null);
    }
  };

  const handleCancelDeploy = async (dep: DeploymentItem) => {
    setCancellingId(dep.id);
    try {
      const res = await fetch(`/api/deploy/${dep.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        window.dispatchEvent(new Event("ray:redeploy-triggered"));
        fetchDeployments();
      }
    } catch { /* silent */ }
    finally {
      setCancellingId(null);
    }
  };

  useEffect(() => {
    fetchDeployments();
    const interval = setInterval(fetchDeployments, 12000);
    return () => clearInterval(interval);
  }, [fetchDeployments]);

  const filtered = deployments.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.containerName && d.containerName.toLowerCase().includes(search.toLowerCase())) ||
    (d.framework && d.framework.toLowerCase().includes(search.toLowerCase())) ||
    d.projectPath.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-jersey text-3xl text-white tracking-wide">Deployments</h1>
          <p className="text-xs text-white/50 mt-1 font-normal">
            Real-time status of containerized builds, Docker containers, folder uploads, and GitHub repo deployments.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchDeployments}
            className="ray-btn-ghost flex items-center gap-1.5 text-xs px-3.5 py-2 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Refresh</span>
          </button>
          <Link
            href="/deployments/new"
            className="ray-btn-primary flex items-center gap-1.5 text-xs px-3.5 py-2 font-medium cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Deploy</span>
          </Link>
        </div>
      </div>

      {/* Port Allocation & Conflict Guard Overview */}
      {portRegistry && (
        <div className="mb-6 p-4.5 rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/[0.1] border border-blue-500/20 text-blue-400 shrink-0">
                <Icon icon="lucide:radio" width={16} height={16} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white tracking-tight">Port Allocation & Conflict Guard</h2>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Live Guard Active</span>
                  </span>
                </div>
                <p className="text-[11px] text-white/40 mt-0.5">
                  Pre-scans dashboard projects, Docker containers, and system listeners before every deployment.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="px-3 py-1.5 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/25 flex items-center gap-2">
                <span className="text-[10px] uppercase font-mono tracking-wider text-emerald-400/80">Next Free Port:</span>
                <span className="font-mono text-xs font-bold text-emerald-300">:{portRegistry.nextFreePort}</span>
              </div>
              <button
                onClick={() => setShowAllPorts(!showAllPorts)}
                className="text-[11px] font-mono text-white/50 hover:text-white px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 transition-colors"
              >
                {showAllPorts ? "Hide System Ports" : `View All (${portRegistry.claimed.length})`}
              </button>
            </div>
          </div>

          {/* Active Project & Core Service Ports */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-white/40 mr-1">Active Bindings:</span>
            {portRegistry.claimed
              .filter((c) => c.type === "dashboard_project" || c.type === "docker" || c.type === "deployment" || (c.type === "reserved" && (c.source === "platform" || c.port === 3000 || c.port === 3100 || c.port === 4567 || c.port === 4500)))
              .slice(0, 10)
              .map((c) => (
                <div
                  key={c.port}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border ${
                    c.type === "reserved"
                      ? "bg-purple-500/[0.08] border-purple-500/25 text-purple-300"
                      : "bg-blue-500/[0.08] border-blue-500/25 text-blue-300"
                  }`}
                  title={`${c.name} (${c.source})`}
                >
                  <span className="font-bold">:{c.port}</span>
                  <span className="text-white/40">·</span>
                  <span className="truncate max-w-[120px]">{c.name}</span>
                </div>
              ))}
            {portRegistry.suggestedPorts.length > 1 && (
              <span className="text-[11px] font-mono text-white/30 ml-2">
                Reserved pool: {portRegistry.suggestedPorts.slice(1, 4).map(p => `:${p}`).join(", ")}
              </span>
            )}
          </div>

          {/* Port Conflicts Alert Banner */}
          {portRegistry.conflicts && portRegistry.conflicts.length > 0 && (
            <div className="mt-3.5 p-3 rounded-xl bg-rose-500/[0.1] border border-rose-500/25 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
                  <Icon icon="lucide:alert-triangle" width={14} height={14} className="text-rose-400 shrink-0" />
                  <span>{portRegistry.conflicts.length} Port Conflict{portRegistry.conflicts.length > 1 ? "s" : ""} Detected</span>
                </div>
                <span className="text-[10px] font-mono text-rose-400/80">Next Free Port: :{portRegistry.nextFreePort}</span>
              </div>
              <div className="flex flex-col gap-1.5 mt-0.5">
                {portRegistry.conflicts.map((conf, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-[11px] font-mono bg-black/40 px-2.5 py-1.5 rounded-lg border border-rose-500/15">
                    <div className="flex items-center gap-2 truncate text-white/80">
                      <span className="text-rose-400 font-bold">:{conf.port}</span>
                      <span className="truncate"><strong>{conf.deploymentName}</strong> conflicts with {conf.conflictingWith}</span>
                    </div>
                    {conf.deploymentId && (
                      <button
                        onClick={() => handleReallocatePort(conf.deploymentId!)}
                        disabled={reallocatingId === conf.deploymentId}
                        className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {reallocatingId === conf.deploymentId ? "Reallocating…" : `Reallocate to :${portRegistry.nextFreePort}`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full Ports Accordion */}
          {showAllPorts && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto animate-fade-in pr-1">
              {portRegistry.claimed.map((c) => (
                <div
                  key={c.port}
                  className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-center justify-between gap-1 text-[11px] font-mono"
                >
                  <span className="text-white/80 font-bold">:{c.port}</span>
                  <span className="text-white/40 text-[10px] truncate" title={c.source}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search Filter & Count */}
      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search deployments by name, stack, or container..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-card-border focus:border-white/20 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-lg py-2 pl-9 pr-4 transition-all"
          />
        </div>
        <span className="text-xs font-medium text-white/40">
          {filtered.length} deployment{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Content Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-white/40">
          <SpinIcon /><span className="text-xs font-medium">Loading deployments...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border border-card-border bg-card flex flex-col items-center justify-center text-center shadow-lg">
          <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/60">
            <Icon icon="logos:docker-icon" width={22} height={22} />
          </div>
          <p className="font-sans font-bold text-sm text-white mb-1">No deployments found</p>
          <p className="text-xs text-white/40 max-w-sm mb-4">
            Deploy apps by attaching folders or repo links in AI Chat, or configure a CI/CD pipeline.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((dep) => {
            const effectiveUrl = getPrimaryProjectUrl(dep.deployUrl, dep.hostPort) || dep.container?.url || (dep.hostPort ? `http://localhost:${dep.hostPort}` : null);
            const containerName = dep.container?.name || dep.containerName || `ray-${dep.name}`;

            return (
              <div
                key={dep.id}
                className="group rounded-2xl p-4.5 border border-card-border hover:border-white/20 bg-card hover:bg-card transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg"
              >
                <div className="flex items-start md:items-center gap-3.5 min-w-0">
                  {/* Large Technology Icon */}
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm group-hover:border-white/20 transition-all">
                    <Icon icon={dep.icon || (dep.isDocker ? "logos:docker-icon" : "logos:nodejs-icon")} width={24} height={24} className="shrink-0" />
                  </div>

                  <div className="min-w-0">
                    {/* Title and Badges Row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-sans font-bold text-sm text-white tracking-tight">
                        {dep.name}
                      </h3>

                      {/* 1. Framework / Stack Badge (First) */}
                      {dep.framework && (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                            dep.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                          }`}
                        >
                          <Icon icon={dep.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                          <span>{dep.framework.toLowerCase()}</span>
                        </span>
                      )}

                      {/* 2. Docker Badge (Second) */}
                      {dep.isDocker && (
                        <Link
                          href="/containers"
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer"
                          title="View Docker Container"
                        >
                          <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                          <span>docker</span>
                        </Link>
                      )}

                      {/* 3. State / Status Badge (Third, without bullet dot) */}
                      {dep.status === "healthy" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.1] border border-emerald-500/25 text-[10.5px] font-mono text-emerald-300">
                          <Icon icon="lucide:check-circle-2" width={11} height={11} className="text-emerald-400" />
                          <span>healthy</span>
                        </span>
                      ) : dep.status === "building" || dep.status === "deploying" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/[0.1] border border-amber-500/25 text-[10.5px] font-mono text-amber-300">
                          <SpinIcon size={10} />
                          <span>{dep.status}…</span>
                        </span>
                      ) : dep.status === "failed" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-500/[0.15] border border-red-500/30 text-[10.5px] font-mono text-red-300">
                          <Icon icon="lucide:alert-triangle" width={11} height={11} className="text-red-400" />
                          <span>failed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[10.5px] font-mono text-white/50">
                          <span>{dep.status}</span>
                        </span>
                      )}

                      {/* 4. Port / Domain Badge (Fourth) */}
                      {(dep.hostPort || dep.container?.port) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[11px] font-mono text-blue-300">
                          <Icon icon="lucide:radio" width={11} height={11} className="text-blue-400/80" />
                          <span>:{dep.hostPort || dep.container?.port}</span>
                        </span>
                      )}

                      {/* 5. Conflict Warning Badge */}
                      {(() => {
                        const depConflict = portRegistry?.conflicts?.find(c => c.deploymentId === dep.id || (dep.hostPort && c.port === dep.hostPort));
                        if (!depConflict) return null;
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-[10.5px] font-mono text-rose-300"
                            title={depConflict.reason}
                          >
                            <Icon icon="lucide:alert-triangle" width={11} height={11} className="text-rose-400" />
                            <span>Conflict (:{depConflict.port})</span>
                          </span>
                        );
                      })()}
                    </div>

                    <p className="text-[11px] font-mono text-white/40 truncate mt-1">
                      {dep.runtime === "host" ? "Runtime: Host process" : `Container: ${containerName}`} · Source: {dep.sourceType} {dep.repoUrl ? `· ${dep.repoUrl}` : `· ${dep.projectPath}`}
                    </p>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {effectiveUrl && (
                    <a
                      href={effectiveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Open App ↗</span>
                    </a>
                  )}

                  {(() => {
                    const depConflict = portRegistry?.conflicts?.find(c => c.deploymentId === dep.id || (dep.hostPort && c.port === dep.hostPort));
                    if (!depConflict || !portRegistry) return null;
                    return (
                      <button
                        onClick={() => handleReallocatePort(dep.id)}
                        disabled={reallocatingId === dep.id}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        title={`Port :${depConflict.port} conflicts with ${depConflict.conflictingWith}. Reallocate to guaranteed free port :${portRegistry.nextFreePort}`}
                      >
                        {reallocatingId === dep.id ? <SpinIcon size={12} /> : <Icon icon="lucide:refresh-cw" width={12} height={12} />}
                        <span>Fix Port (:{portRegistry.nextFreePort})</span>
                      </button>
                    );
                  })()}

                  {dep.status === "failed" && (
                    <button
                      onClick={() => setTroubleshootDep(dep)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                    >
                      <span>⚡</span>
                      <span>AI Troubleshoot</span>
                    </button>
                  )}

                  {dep.status === "building" || dep.status === "deploying" ? (
                    <button
                      onClick={() => handleCancelDeploy(dep)}
                      disabled={cancellingId === dep.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                      title="Cancel stuck deployment"
                    >
                      {cancellingId === dep.id ? (
                        <SpinIcon size={12} />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      )}
                      <span>{cancellingId === dep.id ? "Cancelling…" : "Cancel Build"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRedeploy(dep)}
                      disabled={redeployingId === dep.id}
                      className="ray-btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5 cursor-pointer disabled:opacity-40"
                      title="Rebuild and launch the application"
                    >
                      {redeployingId === dep.id ? (
                        <SpinIcon size={12} />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                      )}
                      <span>{redeployingId === dep.id ? "Deploying…" : "Redeploy"}</span>
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedLogsDep(dep)}
                    className="ray-btn-ghost text-xs px-3 py-1.5 cursor-pointer"
                  >
                    Build Logs
                  </button>

                  <Link
                    href={`/deployments/${dep.id}`}
                    className="ray-btn-ghost w-8 h-8 p-0 flex items-center justify-center cursor-pointer"
                    title="View Details"
                  >
                    →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Instant Build Logs Modal - Full Viewport Coverage */}
      {selectedLogsDep && (
        <div
          className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in font-sans"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedLogsDep(null);
          }}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden bg-card border border-card-border shadow-2xl"
            style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.95)" }}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0f0f0f]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/[0.06] border border-white/10 text-white">
                  <Icon icon={selectedLogsDep.icon || "logos:nodejs-icon"} width={16} height={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-sans font-bold text-sm text-white">{selectedLogsDep.name}</h3>
                    <span className="text-[10px] font-mono text-white/40">· Build Logs</span>
                    {selectedLogsDep.framework && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-white/60 border border-white/[0.08]">
                        {selectedLogsDep.framework}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(selectedLogsDep.status === "building" || selectedLogsDep.status === "deploying") && (
                  <button
                    onClick={() => {
                      const dep = selectedLogsDep;
                      setSelectedLogsDep(null);
                      handleCancelDeploy(dep);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1 cursor-pointer shadow-sm active:scale-95"
                    title="Cancel stuck deployment"
                  >
                    <span>Cancel Build</span>
                  </button>
                )}
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    selectedLogsDep.status === "healthy"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : selectedLogsDep.status === "failed"
                      ? "bg-red-500/10 text-red-400 border border-red-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}
                >
                  {selectedLogsDep.status}
                </span>
                <button
                  onClick={() => setSelectedLogsDep(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Failure Alert Inside Logs */}
            {selectedLogsDep.status === "failed" && (
              <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-red-400 font-mono">
                  <span>⚠️</span>
                  <span>Build or deployment failed. Ray AI Troubleshooter can diagnose the root cause.</span>
                </div>
                <button
                  onClick={() => {
                    const dep = selectedLogsDep;
                    setSelectedLogsDep(null);
                    setTroubleshootDep(dep);
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                >
                  <span>⚡</span>
                  <span>AI Troubleshoot</span>
                </button>
              </div>
            )}

            {/* Terminal Logs Window */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-[#050505] text-[#e2e8f0] select-text">
              <pre className="whitespace-pre-wrap font-mono">
                {selectedLogsDep.buildLogs || "No build logs recorded yet. Application is packaged and running."}
              </pre>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-white/[0.08] flex items-center justify-between bg-[#0a0a0a]">
              <span className="text-[11px] text-white/40 font-mono">
                {selectedLogsDep.runtime === "host" ? "Runtime: Host process · Application output is available in Monitor" : `Container: ${selectedLogsDep.container?.name || selectedLogsDep.containerName || `ray-${selectedLogsDep.name}`}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedLogsDep.buildLogs || "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
                >
                  {copied ? "Copied!" : "Copy Logs"}
                </button>
                <button
                  onClick={() => {
                    const dep = selectedLogsDep;
                    setSelectedLogsDep(null);
                    handleRedeploy(dep);
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  <span>Redeploy</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ray AI Troubleshooter Modal */}
      <DeployDiagnosisModal
        isOpen={!!troubleshootDep}
        onClose={() => setTroubleshootDep(null)}
        deploymentId={troubleshootDep?.id}
        deploymentName={troubleshootDep?.name || "Deployment"}
        buildLogs={troubleshootDep?.buildLogs || undefined}
        onRedeploySuccess={() => {
          fetchDeployments();
        }}
      />
    </div>
  );
}
