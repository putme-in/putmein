"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DashboardIncidents from "@/components/DashboardIncidents";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ServerStats {
  name: string;
  ip: string;
  status: "online" | "offline";
  os: string;
  arch: string;
  cpuModel: string;
  cpusCount: number;
  cpu: number;
  memory: number;
  disk: number;
  uptime: string;
  uptimeSeconds: number;
  loadAvg: number[];
  memoryFormatted: string;
  diskFormatted: string;
}

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "restarting";
  ports: string;
  port?: number;
  url?: string | null;
  createdAt: string;
  cpu?: string;
  memory?: string;
  isRay: boolean;
  framework?: string;
  frameworkSlug?: string;
  icon?: string;
  colorClasses?: string;
  projectId?: string | null;
  projectName?: string | null;
  deploymentId?: string | null;
}

interface DeploymentItem {
  id: string;
  name: string;
  sourceType: string;
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
}

interface MonitorAlertItem {
  id: string;
  severity: "info" | "warn" | "error" | "critical";
  message: string;
  rawLog?: string;
  dismissed: boolean;
  createdAt: string;
  projectName: string;
  projectId: string;
}

interface MonitorProjectItem {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  status: "discovering" | "active" | "paused" | "error";
  alertsCount: number;
  lastChecked?: string | null;
}

interface DashboardData {
  server: ServerStats;
  containers: {
    total: number;
    running: number;
    stopped: number;
    items: ContainerItem[];
  };
  deployments: {
    total: number;
    healthy: number;
    building: number;
    failed: number;
    recent: DeploymentItem[];
  };
  monitor: {
    totalProjects: number;
    activeProjects: number;
    undismissedAlertsCount: number;
    criticalAlertsCount: number;
    warnAlertsCount: number;
    recentAlerts: MonitorAlertItem[];
    projects: MonitorProjectItem[];
  };
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "recently";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const severityColors: Record<string, { text: string; bg: string; border: string }> = {
  critical: { text: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.28)" },
  error: { text: "#f97316", bg: "rgba(249, 115, 22, 0.12)", border: "rgba(249, 115, 22, 0.28)" },
  warn: { text: "#eab308", bg: "rgba(234, 179, 8, 0.12)", border: "rgba(234, 179, 8, 0.28)" },
  info: { text: "#22c55e", bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.28)" },
};

const deploymentStatusMap: Record<
  DeploymentItem["status"],
  { label: string; text: string; bg: string; border: string; dot: string; pulse?: boolean }
> = {
  healthy: { label: "Healthy", text: "#22c55e", bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.2)", dot: "#22c55e" },
  building: { label: "Building", text: "#eab308", bg: "rgba(234, 179, 8, 0.1)", border: "rgba(234, 179, 8, 0.2)", dot: "#eab308", pulse: true },
  deploying: { label: "Deploying", text: "#3b82f6", bg: "rgba(59, 130, 246, 0.1)", border: "rgba(59, 130, 246, 0.2)", dot: "#3b82f6", pulse: true },
  pending: { label: "Pending", text: "rgba(255, 255, 255, 0.6)", bg: "rgba(255, 255, 255, 0.06)", border: "rgba(255, 255, 255, 0.12)", dot: "rgba(255, 255, 255, 0.4)" },
  stopped: { label: "Stopped", text: "rgba(255, 255, 255, 0.5)", bg: "rgba(255, 255, 255, 0.05)", border: "rgba(255, 255, 255, 0.1)", dot: "rgba(255, 255, 255, 0.3)" },
  failed: { label: "Failed", text: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", border: "rgba(239, 68, 68, 0.2)", dot: "#ef4444" },
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dismissingAlertId, setDismissingAlertId] = useState<string | null>(null);
  const [troubleshootDep, setTroubleshootDep] = useState<DeploymentItem | null>(null);
  const [selectedLogsDep, setSelectedLogsDep] = useState<DeploymentItem | null>(null);

  const fetchDashboardData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(() => {
      fetchDashboardData();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const handleContainerAction = async (id: string, action: "start" | "stop" | "restart") => {
    setActionLoading(`${id}-${action}`);
    try {
      await fetch(`/api/containers/${encodeURIComponent(id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchDashboardData();
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    setDismissingAlertId(alertId);
    try {
      await fetch(`/api/monitor/alerts/${encodeURIComponent(alertId)}`, {
        method: "DELETE",
      });
      setData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          monitor: {
            ...prev.monitor,
            undismissedAlertsCount: Math.max(0, prev.monitor.undismissedAlertsCount - 1),
            recentAlerts: prev.monitor.recentAlerts.filter((a) => a.id !== alertId),
          },
        };
      });
    } catch {
      // silent
    } finally {
      setDismissingAlertId(null);
    }
  };

  const handleOpenTerminal = () => {
    window.dispatchEvent(new CustomEvent("ray:open-terminal"));
  };

  if (loading && !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <SpinIcon size={26} />
        <p className="text-xs text-white/40 mt-3 font-mono">Initializing dashboard telemetry...</p>
      </div>
    );
  }

  const server = data?.server;
  const containers = data?.containers;
  const deployments = data?.deployments;
  const monitor = data?.monitor;

  const totalDeployments = deployments?.total || 0;
  const healthyDeployments = deployments?.healthy || 0;
  const deploymentSuccessRate =
    totalDeployments > 0 ? Math.round((healthyDeployments / totalDeployments) * 100) : 100;

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 font-sans">
      {/* ─── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-7">
        <div>
          <h1 className="font-jersey text-3xl sm:text-4xl text-white tracking-wide">
            Dashboard
          </h1>
          <p className="text-xs text-white/50 mt-1 font-normal max-w-xl">
            Unified telemetry overview for containers, server resource saturation, build releases, and monitor logs.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            className="ray-btn-ghost text-xs px-3 py-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh dashboard metrics"
          >
            {refreshing ? (
              <SpinIcon size={12} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
            <span>{refreshing ? "Updating..." : "Refresh"}</span>
          </button>

          <button
            onClick={handleOpenTerminal}
            className="ray-btn-ghost text-xs px-3 py-1.5 cursor-pointer"
            title="Toggle terminal slide-out"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Terminal</span>
          </button>

          <Link
            href="/deployments/new"
            className="ray-btn-primary text-xs px-3.5 py-1.5 font-medium cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Deploy</span>
          </Link>
        </div>
      </div>

      <DashboardIncidents />

      {/* ─── Executive KPI Strip ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        {/* KPI 1: Server Load */}
        <Link href="/servers/localhost" className="block focus:outline-none">
          <div className="ray-card p-4.5 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="ray-eyebrow">Server Load</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  {server?.name || "localhost"}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold tabular-nums text-white">
                  {server?.cpu ?? 0}%
                </span>
                <span className="text-xs text-white/40 font-mono">CPU</span>
              </div>
              <p className="text-xs text-white/50 font-normal">
                MEM: <span className="text-white/80 font-mono">{server?.memory ?? 0}%</span> · DISK: <span className="text-white/80 font-mono">{server?.disk ?? 0}%</span>
              </p>
            </div>

            {/* Micro Load Progress Bars */}
            <div className="mt-4 pt-3 border-t border-white/[0.04] flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
                <span>RAM Allocation</span>
                <span className="text-white/70">{server?.memoryFormatted || "N/A"}</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, server?.memory || 0)}%`,
                    backgroundColor: (server?.memory || 0) > 85 ? "#ef4444" : (server?.memory || 0) > 65 ? "#eab308" : "#22c55e",
                  }}
                />
              </div>
            </div>
          </div>
        </Link>

        {/* KPI 2: Containers */}
        <Link href="/containers" className="block focus:outline-none">
          <div className="ray-card p-4.5 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="ray-eyebrow">Container Runtimes</span>
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold tabular-nums text-white">
                  {containers?.running ?? 0}
                </span>
                <span className="text-xs text-white/40 font-mono">/ {containers?.total ?? 0} RUNNING</span>
              </div>
              <p className="text-xs text-white/50 font-normal">
                {containers?.stopped ?? 0} exited / idle containers
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/50 group-hover:text-white transition-colors">
              <span>Inspect Docker instances</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </Link>

        {/* KPI 3: Deployments */}
        <Link href="/deployments" className="block focus:outline-none">
          <div className="ray-card p-4.5 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="ray-eyebrow">Deployments</span>
                {deployments?.building ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    <SpinIcon size={10} />
                    <span>{deployments.building} building</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    {deploymentSuccessRate}% Health
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold tabular-nums text-white">
                  {totalDeployments}
                </span>
                <span className="text-xs text-white/40 font-mono">RELEASES</span>
              </div>
              <p className="text-xs text-white/50 font-normal">
                {healthyDeployments} healthy · {deployments?.failed || 0} failed
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/50 group-hover:text-white transition-colors">
              <span>Manage deployments</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </Link>

        {/* KPI 4: Monitor & Alerts */}
        <Link href="/monitor" className="block focus:outline-none">
          <div className="ray-card p-4.5 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="ray-eyebrow">Monitor & Logs</span>
                {(monitor?.criticalAlertsCount || 0) > 0 ? (
                  <span className="text-[10px] font-mono text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded border border-red-500/30 font-semibold animate-pulse">
                    {monitor?.criticalAlertsCount} Critical
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-white/40 bg-white/[0.05] px-1.5 py-0.5 rounded border border-white/10">
                    {monitor?.activeProjects || 0} Active
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-bold tabular-nums text-white">
                  {monitor?.undismissedAlertsCount ?? 0}
                </span>
                <span className="text-xs text-white/40 font-mono">PENDING ALERTS</span>
              </div>
              <p className="text-xs text-white/50 font-normal">
                Across {monitor?.totalProjects ?? 0} registered project monitors
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/50 group-hover:text-white transition-colors">
              <span>Open live monitor logs</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </Link>
      </div>

      {/* ─── Main Content Grid: 7 cols left, 5 cols right ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ─── Left Section (7 cols) ────────────────────────────────────────── */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Running Statuses of Containers */}
          <div className="ray-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    Containers
                  </h2>
                  <span className="ray-badge">
                    {containers?.running || 0} active
                  </span>
                </div>
                <p className="text-xs text-white/40 mt-0.5 font-normal">
                  Live Docker container runtimes, active port bindings, and quick controls.
                </p>
              </div>

              <Link
                href="/containers"
                className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>View all</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
            </div>

            {/* Container List */}
            {containers?.items && containers.items.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {containers.items.slice(0, 5).map((container) => {
                  const isRunning = container.state === "running";
                  return (
                    <div
                      key={container.id}
                      className="p-3.5 rounded-xl border border-white/[0.05] bg-white/[0.015] hover:border-white/10 hover:bg-white/[0.03] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Stack Icon / Avatar */}
                        <div className="w-9 h-9 rounded-lg bg-black/60 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                          {container.icon ? (
                            <Icon icon={container.icon} width="18" height="18" />
                          ) : (
                            <Icon icon="logos:docker-icon" width="18" height="18" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white truncate">
                              {container.name}
                            </span>
                            <span
                              className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-medium ${
                                isRunning
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-white/[0.06] text-white/40 border border-white/10"
                              }`}
                            >
                              {container.state}
                            </span>
                            {container.framework && (
                              <span className="text-[10px] text-white/30 font-mono hidden sm:inline">
                                {container.framework}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-white/40 font-mono mt-0.5">
                            <span className="truncate max-w-[160px] sm:max-w-[220px]" title={container.image}>
                              {container.image}
                            </span>
                            {container.port && (
                              <>
                                <span>·</span>
                                <span className="text-white/70">:{container.port}</span>
                              </>
                            )}
                            {container.cpu && (
                              <>
                                <span>·</span>
                                <span className="text-emerald-400/80">{container.cpu} CPU</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions & Links */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {container.url && (
                          <a
                            href={container.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-colors"
                            title={`Open ${container.url}`}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        )}

                        {/* Lifecycle action buttons */}
                        {isRunning ? (
                          <button
                            onClick={() => handleContainerAction(container.id, "restart")}
                            disabled={actionLoading === `${container.id}-restart`}
                            className="ray-btn-ghost text-xs px-2.5 py-1 text-white/50 hover:text-white cursor-pointer"
                            title="Restart container"
                          >
                            {actionLoading === `${container.id}-restart` ? (
                              <SpinIcon size={11} />
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                            )}
                            <span className="hidden sm:inline">Restart</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleContainerAction(container.id, "start")}
                            disabled={actionLoading === `${container.id}-start`}
                            className="ray-btn-ghost text-xs px-2.5 py-1 text-emerald-400 hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer"
                            title="Start container"
                          >
                            {actionLoading === `${container.id}-start` ? (
                              <SpinIcon size={11} />
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            )}
                            <span className="hidden sm:inline">Start</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center border border-dashed border-white/[0.08] rounded-xl">
                <div className="w-10 h-10 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-2 text-white/40">
                  <Icon icon="logos:docker-icon" width="20" height="20" />
                </div>
                <p className="text-sm text-white/70 font-medium">No containers running</p>
                <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
                  Deploy a project or start a containerized workload to observe live runtime telemetry here.
                </p>
                <Link
                  href="/deployments"
                  className="ray-btn-ghost text-xs px-3.5 py-1.5 mt-3.5 inline-flex items-center gap-1.5"
                >
                  <span>Launch deployment</span>
                </Link>
              </div>
            )}
          </div>

          {/* Recent Deployments */}
          <div className="ray-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Recent Deployments
                </h2>
                <p className="text-xs text-white/40 mt-0.5 font-normal">
                  Latest builds, source repositories, and deployment outcomes.
                </p>
              </div>

              <Link
                href="/deployments"
                className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>All deployments</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
            </div>

            {deployments?.recent && deployments.recent.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {deployments.recent.map((dep) => {
                  const statusConfig = deploymentStatusMap[dep.status] || deploymentStatusMap.pending;
                  return (
                    <div
                      key={dep.id}
                      className="p-3.5 rounded-xl border border-white/[0.05] bg-white/[0.015] hover:border-white/10 hover:bg-white/[0.03] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Framework Icon */}
                        <div className="w-9 h-9 rounded-lg bg-black/60 border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                          {dep.icon ? (
                            <Icon icon={dep.icon} width="18" height="18" />
                          ) : (
                            <Icon icon="logos:docker-icon" width="18" height="18" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white truncate">
                              {dep.name}
                            </span>
                            <span
                              className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-medium flex items-center gap-1"
                              style={{
                                color: statusConfig.text,
                                background: statusConfig.bg,
                                border: `1px solid ${statusConfig.border}`,
                              }}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${statusConfig.pulse ? "animate-pulse" : ""}`}
                                style={{ background: statusConfig.dot }}
                              />
                              <span>{statusConfig.label}</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-white/40 font-mono mt-0.5 flex-wrap">
                            {dep.branch && (
                              <span className="flex items-center gap-1 text-white/60">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
                                <span>{dep.branch}</span>
                              </span>
                            )}
                            {dep.commitHash && (
                              <>
                                <span>·</span>
                                <span className="text-white/40">{dep.commitHash.slice(0, 7)}</span>
                              </>
                            )}
                            <span>·</span>
                            <span>{formatTimeAgo(dep.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {dep.deployUrl ? (
                          <a
                            href={dep.deployUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ray-btn-ghost text-xs px-2.5 py-1 text-white/70 hover:text-white flex items-center gap-1.5"
                          >
                            <span>Visit</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        ) : dep.hostPort ? (
                          <a
                            href={`http://localhost:${dep.hostPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ray-btn-ghost text-xs px-2.5 py-1 text-white/70 hover:text-white flex items-center gap-1.5 font-mono"
                          >
                            <span>:{dep.hostPort}</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                          </a>
                        ) : null}

                        {dep.status === "failed" && (
                          <button
                            onClick={() => setTroubleshootDep(dep)}
                            className="ray-btn-ghost text-xs px-2.5 py-1 text-red-400 hover:text-red-300 border-red-500/20 hover:border-red-500/40 flex items-center gap-1"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
                            <span>AI Fix</span>
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedLogsDep(dep)}
                          className="w-7 h-7 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] text-white/40 hover:text-white flex items-center justify-center transition-colors"
                          title="View deployment logs"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center border border-dashed border-white/[0.08] rounded-xl">
                <p className="text-sm text-white/70 font-medium">No deployments yet</p>
                <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
                  Connect GitHub repositories or upload local projects to initiate automated deployment.
                </p>
                <Link
                  href="/deployments"
                  className="ray-btn-primary text-xs px-3.5 py-1.5 mt-3.5 inline-flex items-center gap-1.5"
                >
                  <span>New deployment</span>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Section (5 cols) ───────────────────────────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Server Status Deep Dive */}
          <div className="ray-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    Server Status
                  </h2>
                  <span className="ray-badge-online">ONLINE</span>
                </div>
                <p className="text-xs text-white/40 mt-0.5 font-normal">
                  Localhost server telemetry and hardware saturation.
                </p>
              </div>

              <Link
                href="/servers/localhost"
                className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors font-mono"
              >
                <span>{server?.ip}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
            </div>

            {/* Server Specs Header */}
            <div className="p-3.5 rounded-xl border border-white/[0.05] bg-black/40 mb-4">
              <div className="flex items-center justify-between text-xs text-white/80 font-mono mb-1">
                <span className="font-semibold text-white">{server?.os}</span>
                <span className="text-white/40">{server?.arch}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-white/40 font-mono">
                <span className="truncate max-w-[200px]" title={server?.cpuModel}>
                  {server?.cpuModel} ({server?.cpusCount} cores)
                </span>
                <span className="text-emerald-400">↑ {server?.uptime}</span>
              </div>
            </div>

            {/* Hardware Utilization Bars */}
            <div className="flex flex-col gap-3.5">
              {/* CPU Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-white/60 font-medium">CPU Utilization</span>
                  <span className="font-mono text-white text-xs">{server?.cpu ?? 0}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, server?.cpu || 0)}%`,
                      backgroundColor: (server?.cpu || 0) > 85 ? "#ef4444" : (server?.cpu || 0) > 65 ? "#eab308" : "#22c55e",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-white/30 font-mono mt-1">
                  <span>Load averages</span>
                  <span>{server?.loadAvg ? server.loadAvg.join(", ") : "0.0, 0.0, 0.0"}</span>
                </div>
              </div>

              {/* Memory Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-white/60 font-medium">Memory Allocation</span>
                  <span className="font-mono text-white text-xs">{server?.memory ?? 0}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, server?.memory || 0)}%`,
                      backgroundColor: (server?.memory || 0) > 85 ? "#ef4444" : (server?.memory || 0) > 65 ? "#eab308" : "#22c55e",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-white/30 font-mono mt-1">
                  <span>RAM Usage</span>
                  <span>{server?.memoryFormatted || "N/A"}</span>
                </div>
              </div>

              {/* Disk Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-white/60 font-medium">Storage Capacity</span>
                  <span className="font-mono text-white text-xs">{server?.disk ?? 0}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, server?.disk || 0)}%`,
                      backgroundColor: (server?.disk || 0) > 90 ? "#ef4444" : (server?.disk || 0) > 75 ? "#eab308" : "#22c55e",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-white/30 font-mono mt-1">
                  <span>Disk Used</span>
                  <span>{server?.diskFormatted || "N/A"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Monitor Alerts & Logs */}
          <div className="ray-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    Monitor Alerts
                  </h2>
                  {(monitor?.undismissedAlertsCount || 0) > 0 && (
                    <span className="ray-badge text-amber-400 border-amber-500/30 bg-amber-500/10">
                      {monitor?.undismissedAlertsCount} pending
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/40 mt-0.5 font-normal">
                  Live runtime anomalies, warnings, and log stream findings.
                </p>
              </div>

              <Link
                href="/monitor"
                className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Open monitor</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </Link>
            </div>

            {/* Alert List */}
            {monitor?.recentAlerts && monitor.recentAlerts.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {monitor.recentAlerts.slice(0, 4).map((alert) => {
                  const colors = severityColors[alert.severity] || severityColors.info;
                  return (
                    <div
                      key={alert.id}
                      className="p-3 rounded-xl border border-white/[0.05] bg-white/[0.015] hover:border-white/10 transition-all flex items-start justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded font-bold"
                            style={{
                              color: colors.text,
                              backgroundColor: colors.bg,
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {alert.severity}
                          </span>
                          <span className="text-[11px] font-mono text-white/60 truncate">
                            {alert.projectName}
                          </span>
                          <span className="text-[10px] text-white/30 font-mono ml-auto">
                            {formatTimeAgo(alert.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">
                          {alert.message}
                        </p>
                      </div>

                      {/* Dismiss Action */}
                      <button
                        onClick={() => handleDismissAlert(alert.id)}
                        disabled={dismissingAlertId === alert.id}
                        className="w-6 h-6 rounded-md hover:bg-white/[0.08] text-white/30 hover:text-white flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer mt-0.5"
                        title="Dismiss alert"
                      >
                        {dismissingAlertId === alert.id ? (
                          <SpinIcon size={10} />
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-7 text-center border border-dashed border-white/[0.08] rounded-xl">
                <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-xs text-white/70 font-medium">All systems normal</p>
                <p className="text-[11px] text-white/40 mt-0.5">
                  No active warnings or critical log traces detected.
                </p>
              </div>
            )}

            {/* Monitored Projects Mini Strip */}
            {monitor?.projects && monitor.projects.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.04]">
                <span className="ray-eyebrow block mb-2">Monitored Targets</span>
                <div className="grid grid-cols-2 gap-2">
                  {monitor.projects.map((proj) => (
                    <Link
                      key={proj.id}
                      href={`/projects/${proj.id}`}
                      className="p-2 rounded-lg bg-black/40 border border-white/[0.05] hover:border-white/10 transition-colors flex items-center justify-between"
                    >
                      <span className="text-xs font-mono text-white/70 truncate mr-2">
                        {proj.name}
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Launchpad Shortcuts */}
          <div className="ray-card p-5">
            <span className="ray-eyebrow block mb-3">Ray Command Shortcuts</span>
            <div className="grid grid-cols-2 gap-2.5">
              <Link
                href="/chat"
                className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.04] transition-all flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/70 group-hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </div>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 group-hover:text-white transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div>
                  <span className="text-xs font-semibold text-white block">Ray AI Chat</span>
                  <span className="text-[10px] text-white/40">Ask agent to code or deploy</span>
                </div>
              </Link>

              <button
                onClick={handleOpenTerminal}
                className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.04] transition-all flex flex-col justify-between text-left group cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/70 group-hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                  </div>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 group-hover:text-white transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div>
                  <span className="text-xs font-semibold text-white block">Terminal</span>
                  <span className="text-[10px] text-white/40">Open system bash shell</span>
                </div>
              </button>

              <Link
                href="/projects"
                className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.04] transition-all flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/70 group-hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  </div>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 group-hover:text-white transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div>
                  <span className="text-xs font-semibold text-white block">Projects</span>
                  <span className="text-[10px] text-white/40">Inspect codebase workspace</span>
                </div>
              </Link>

              <Link
                href="/cicd"
                className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.04] transition-all flex flex-col justify-between group"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-white/70 group-hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30 group-hover:text-white transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div>
                  <span className="text-xs font-semibold text-white block">CI / CD</span>
                  <span className="text-[10px] text-white/40">Automation workflows</span>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Build Logs Modal ────────────────────────────────────────────────── */}
      {selectedLogsDep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setSelectedLogsDep(null)}
        >
          <div
            className="ray-panel w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] animate-fade-in-scale"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-white">
                  {selectedLogsDep.name}
                </span>
                <span className="ray-badge">{selectedLogsDep.status}</span>
              </div>
              <button
                onClick={() => setSelectedLogsDep(null)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-black/90 font-mono text-xs text-white/80 leading-relaxed whitespace-pre-wrap select-text">
              {selectedLogsDep.buildLogs || "No build logs recorded for this deployment."}
            </div>
          </div>
        </div>
      )}

      {/* ─── AI Diagnosis Modal ──────────────────────────────────────────────── */}
      {troubleshootDep && (
        <DeployDiagnosisModal
          isOpen={Boolean(troubleshootDep)}
          onClose={() => setTroubleshootDep(null)}
          deploymentId={troubleshootDep.id}
          deploymentName={troubleshootDep.name}
          buildLogs={troubleshootDep.buildLogs || ""}
          onRedeployStarted={() => {
            fetchDashboardData();
          }}
          onRedeploySuccess={() => {
            fetchDashboardData();
          }}
        />
      )}
    </div>
  );
}
