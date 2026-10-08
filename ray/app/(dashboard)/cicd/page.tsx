"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { validateGitRepoUrl, supportsGitHubPush } from "@/lib/git-url";
import { validateTcpPort } from "@/lib/port-validator";

interface PipelineItem {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  autoDeploy: boolean;
  port: number;
  dockerfilePath?: string;
  status: "idle" | "running" | "success" | "failed";
  lastRunAt?: string | null;
  framework?: string;
  frameworkSlug?: string;
  language?: string;
  icon?: string;
  colorClasses?: string;
  isDocker?: boolean;
  runs?: any[];
}

interface CicdStats {
  totalPipelines: number;
  automatedCount: number;
  totalRuns: number;
  successRate: number;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function CicdPage() {
  const router = useRouter();
  const [pipelines, setPipelines] = useState<PipelineItem[]>([]);
  const [stats, setStats] = useState<CicdStats>({
    totalPipelines: 0,
    automatedCount: 0,
    totalRuns: 0,
    successRate: 100,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoUrlError, setRepoUrlError] = useState<string | null>(null);
  const [branch, setBranch] = useState("main");
  const [port, setPort] = useState(3000);
  const [portError, setPortError] = useState<string | null>(null);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  const openCreateModal = () => {
    setCreateError("");
    setRepoUrlError(null);
    setPortError(null);
    setShowCreateModal(true);
  };

  const fetchPipelines = useCallback(async () => {
    try {
      const res = await fetch("/api/cicd");
      if (res.ok) {
        const data = await res.json();
        setPipelines(data.pipelines || []);
        if (data.stats) setStats(data.stats);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPipelines();
    const interval = setInterval(fetchPipelines, 6000);
    return () => clearInterval(interval);
  }, [fetchPipelines]);

  const handleTriggerRun = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setTriggeringId(id);
    setTriggerError(null);
    try {
      const res = await fetch(`/api/cicd/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Trigger failed (${res.status})`);
      }
      fetchPipelines();
    } catch (err: unknown) {
      setTriggerError(err instanceof Error ? err.message : "Failed to trigger pipeline run");
    } finally {
      setTriggeringId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError("Pipeline name is required");
      return;
    }

    const validation = validateGitRepoUrl(repoUrl);
    if (!validation.valid) {
      setRepoUrlError(validation.error || "Please enter a valid HTTPS Git repository URL");
      return;
    }
    setRepoUrlError(null);

    const portValidation = validateTcpPort(port);
    if (!portValidation.valid) {
      setPortError(portValidation.error || "Port must be an integer between 1 and 65535");
      return;
    }
    setPortError(null);

    setSubmitting(true);
    setCreateError("");
    try {
      const res = await fetch("/api/cicd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          repoUrl: validation.normalizedUrl || repoUrl.trim(),
          branch: branch.trim() || "main",
          port: portValidation.port,
          autoDeploy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create pipeline");
      setShowCreateModal(false);
      setName("");
      setRepoUrl("");
      setRepoUrlError(null);
      setPort(3000);
      setPortError(null);
      fetchPipelines();
      router.push(`/cicd/${data.pipeline.id}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create pipeline");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = pipelines.filter((pipe) =>
    pipe.name.toLowerCase().includes(search.toLowerCase()) ||
    pipe.repoUrl.toLowerCase().includes(search.toLowerCase()) ||
    (pipe.framework && pipe.framework.toLowerCase().includes(search.toLowerCase())) ||
    pipe.branch.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-jersey text-3xl text-white tracking-wide">CI/CD Pipelines</h1>
          <p className="text-xs text-white/50 mt-1 font-normal">
            Build and deploy from Git repositories. GitHub supports push triggers; external Git sources can run on demand.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="ray-btn-primary flex items-center gap-1.5 text-xs px-3.5 py-2 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Pipeline</span>
        </button>
      </div>

      {/* Top Overview Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        <div className="rounded-2xl p-4 bg-[#0c0c0c] border border-white/[0.08] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-white/40 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Pipelines</span>
            <Icon icon="lucide:git-branch" width={14} height={14} />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{stats.totalPipelines}</div>
        </div>

        <div className="rounded-2xl p-4 bg-[#0c0c0c] border border-white/[0.08] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-white/40 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Automated Triggers</span>
            <Icon icon="lucide:zap" width={14} height={14} className="text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{stats.automatedCount} active</div>
        </div>

        <div className="rounded-2xl p-4 bg-[#0c0c0c] border border-white/[0.08] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-white/40 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Builds</span>
            <Icon icon="lucide:play-circle" width={14} height={14} />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{stats.totalRuns} runs</div>
        </div>

        <div className="rounded-2xl p-4 bg-[#0c0c0c] border border-white/[0.08] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-white/40 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Success Rate</span>
            <Icon icon="lucide:check-circle-2" width={14} height={14} className="text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight text-emerald-400">{stats.successRate}%</div>
        </div>
      </div>

      {triggerError && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between gap-3 shadow-lg shadow-rose-950/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon icon="lucide:alert-circle" width={16} height={16} className="shrink-0 text-rose-400" />
            <span className="font-medium">{triggerError}</span>
          </div>
          <button
            type="button"
            onClick={() => setTriggerError(null)}
            className="text-white/40 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Dismiss"
          >
            <Icon icon="lucide:x" width={14} height={14} />
          </button>
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
            placeholder="Search pipelines by name, repo, or stack..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0e0e0e] border border-white/[0.08] focus:border-white/20 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-lg py-2 pl-9 pr-4 transition-all"
          />
        </div>
        <span className="text-xs font-medium text-white/40">
          {filtered.length} pipeline{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Pipeline Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-white/40">
          <SpinIcon /><span className="text-xs font-medium">Loading pipelines...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border border-white/[0.08] bg-[#0c0c0c] flex flex-col items-center justify-center text-center shadow-lg">
          <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/60">
            <Icon icon="lucide:workflow" width={22} height={22} />
          </div>
          <p className="font-sans font-bold text-sm text-white mb-1">No CI/CD pipelines configured</p>
          <p className="text-xs text-white/40 max-w-sm mb-4">
            Start from Git sources to review project setup, then run your deployment pipeline.
          </p>
          <button
            onClick={openCreateModal}
            className="ray-btn-primary text-xs px-3.5 py-2 cursor-pointer"
          >
            Create Pipeline
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((pipe) => {
            const isRunning = pipe.status === "running";
            const isSuccess = pipe.status === "success";
            const isFailed = pipe.status === "failed";
            const latestRun = pipe.runs?.[0];

            return (
              <div
                key={pipe.id}
                onClick={() => router.push(`/cicd/${pipe.id}`)}
                className="group cursor-pointer rounded-2xl p-4.5 border border-white/[0.08] hover:border-white/20 bg-[#0c0c0c] hover:bg-[#101010] transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg"
              >
                <div className="flex items-start md:items-center gap-3.5 min-w-0">
                  {/* Technology Icon */}
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm group-hover:border-white/20 transition-all">
                    <Icon icon={pipe.icon || (pipe.isDocker ? "logos:docker-icon" : "logos:nodejs-icon")} width={24} height={24} className="shrink-0" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-sans font-bold text-sm text-white tracking-tight">
                        {pipe.name}
                      </h3>

                      {/* 1. Framework badge (First) */}
                      {pipe.framework && (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                            pipe.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                          }`}
                        >
                          <Icon icon={pipe.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                          <span>{pipe.framework.toLowerCase()}</span>
                        </span>
                      )}

                      {/* 2. Docker badge (Second) */}
                      {pipe.isDocker && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300">
                          <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                          <span>docker</span>
                        </span>
                      )}

                      {/* 3. Pipeline status badge (Third, without dots) */}
                      {isSuccess ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.1] border border-emerald-500/25 text-[10.5px] font-mono text-emerald-300">
                          <Icon icon="lucide:check-circle-2" width={11} height={11} className="text-emerald-400" />
                          <span>success</span>
                        </span>
                      ) : isRunning ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-500/[0.1] border border-sky-500/25 text-[10.5px] font-mono text-sky-300">
                          <SpinIcon size={10} />
                          <span>running…</span>
                        </span>
                      ) : isFailed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-500/[0.15] border border-red-500/30 text-[10.5px] font-mono text-red-300">
                          <Icon icon="lucide:alert-triangle" width={11} height={11} className="text-red-400" />
                          <span>failed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[10.5px] font-mono text-white/50">
                          <span>idle</span>
                        </span>
                      )}

                      {/* 4. Branch & Port badge (Fourth) */}
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/70">
                        <Icon icon="lucide:git-branch" width={11} height={11} className="text-white/40" />
                        <span>{pipe.branch}</span>
                        <span className="text-white/30">:{pipe.port}</span>
                      </span>

                      {/* 5. Webhook AutoDeploy Badge */}
                      {pipe.autoDeploy && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/[0.08] border border-amber-500/20 text-[10px] font-mono text-amber-300">
                          <Icon icon="lucide:zap" width={10} height={10} className="text-amber-400" />
                          <span>webhook</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] font-mono text-white/40 mt-1 truncate">
                      <span className="truncate">{pipe.repoUrl}</span>
                      {latestRun && (
                        <span className="hidden sm:inline text-white/30">
                          · Last run: {latestRun.commitHash?.slice(0, 7) || "manual"} ({new Date(latestRun.createdAt).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Actions */}
                <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => handleTriggerRun(e, pipe.id)}
                    disabled={triggeringId === pipe.id || isRunning}
                    className="ray-btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5 cursor-pointer disabled:opacity-40"
                    title="Trigger a new build run for this repository"
                  >
                    {triggeringId === pipe.id ? (
                      <SpinIcon size={12} />
                    ) : (
                      <Icon icon="lucide:play" width={12} height={12} />
                    )}
                    <span>{triggeringId === pipe.id ? "Running…" : "Trigger Run"}</span>
                  </button>

                  <Link
                    href={`/cicd/${pipe.id}`}
                    className="ray-btn-primary flex items-center gap-1 text-xs px-3 py-1.5 cursor-pointer"
                  >
                    <span>View Pipeline</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Pipeline Modal - Full Viewport Coverage */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in font-sans"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl p-6 bg-[#0c0c0c] border border-white/[0.12] shadow-2xl">
            <h2 className="font-jersey text-2xl text-white tracking-wide mb-1">New CI/CD Pipeline</h2>
            <p className="text-xs text-white/50 mb-5 font-normal">
              Connect an HTTPS Git repository. Save private access credentials in Settings → Git sources.
            </p>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                  Pipeline / Application Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. web-app, backend-api"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#141414] border border-white/10 focus:border-white/25 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-lg py-2 px-3 transition-all"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider">
                    Git Repository URL
                  </label>
                  <span className="text-[10px] text-white/30 font-mono">https://github.com/owner/repo</span>
                </div>
                <input
                  type="text"
                  required
                  placeholder="https://github.com/username/repository"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    if (repoUrlError) setRepoUrlError(null);
                  }}
                  onBlur={() => {
                    if (repoUrl.trim()) {
                      const v = validateGitRepoUrl(repoUrl);
                      if (!v.valid) {
                        setRepoUrlError(v.error || "Invalid HTTPS Git repository URL");
                      } else {
                        setRepoUrlError(null);
                      }
                    }
                  }}
                  className={`w-full bg-[#141414] border ${
                    repoUrlError ? "border-rose-500/60 focus:border-rose-500" : "border-white/10 focus:border-white/25"
                  } focus:outline-none text-xs font-mono text-white placeholder:text-white/30 rounded-lg py-2 px-3 transition-all`}
                />
                {repoUrlError && (
                  <p className="text-[11px] text-rose-400 mt-1.5 flex items-center gap-1.5 font-sans">
                    <Icon icon="lucide:alert-circle" width={13} height={13} className="shrink-0 text-rose-400" />
                    <span>{repoUrlError}</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                    Target Branch
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full bg-[#141414] border border-white/10 focus:border-white/25 focus:outline-none text-xs font-mono text-white placeholder:text-white/30 rounded-lg py-2 px-3 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                    Host Port
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      setPort(val as any);
                      if (portError) {
                        const check = validateTcpPort(val);
                        if (check.valid) setPortError(null);
                      }
                    }}
                    onBlur={() => {
                      const check = validateTcpPort(port);
                      if (!check.valid) {
                        setPortError(check.error || "Port must be an integer between 1 and 65535");
                      } else {
                        setPortError(null);
                      }
                    }}
                    className={`w-full bg-[#141414] border text-xs font-mono text-white placeholder:text-white/30 rounded-lg py-2 px-3 transition-all focus:outline-none ${
                      portError
                        ? "border-rose-500/60 focus:border-rose-500 text-rose-200"
                        : "border-white/10 focus:border-white/25"
                    }`}
                    placeholder="3000"
                  />
                  {portError && (
                    <p className="text-[11px] text-rose-400 mt-1.5 flex items-center gap-1">
                      <Icon icon="lucide:alert-circle" width={12} height={12} />
                      <span>{portError}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <input
                  type="checkbox"
                  id="autoDeployCheckbox"
                  checked={autoDeploy && supportsGitHubPush(repoUrl)}
                  disabled={!supportsGitHubPush(repoUrl)}
                  onChange={(e) => setAutoDeploy(e.target.checked)}
                  className="rounded bg-[#141414] border-white/20 text-white focus:ring-0 cursor-pointer"
                />
                <label htmlFor="autoDeployCheckbox" className="text-xs text-white/80 cursor-pointer select-none">
                  Enable GitHub webhook deployment on <code className="text-[11px] text-white">git push</code>
                </label>
              </div>

              {createError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <Icon icon="lucide:alert-circle" width={14} height={14} className="shrink-0 text-rose-400" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="ray-btn-ghost flex-1 py-2 text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ray-btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {submitting && <SpinIcon />}
                  <span>Create Pipeline</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
