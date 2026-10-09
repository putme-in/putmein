"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "restarting";
  ports: string;
  port?: number;
  url?: string;
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

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function ContainersPage() {
  const router = useRouter();
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch("/api/containers");
      if (res.ok) {
        const data = await res.json();
        setContainers(data.containers || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 6000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  const handleAction = async (id: string, action: "start" | "stop" | "restart" | "remove") => {
    setActionLoading(`${id}-${action}`);
    try {
      await fetch(`/api/containers/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      fetchContainers();
    } catch { /* silent */ }
    finally { setActionLoading(null); }
  };

  const filtered = containers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.image.toLowerCase().includes(search.toLowerCase()) ||
    (c.framework && c.framework.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-jersey text-3xl text-white tracking-wide">Containers</h1>
          <p className="text-xs text-white/50 mt-1 font-normal">
            Inspect Docker containers, live streaming logs, resource utilization, and lifecycle controls.
          </p>
        </div>
        <button
          onClick={fetchContainers}
          className="ray-btn-ghost flex items-center gap-1.5 text-xs px-3.5 py-1.5 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>Refresh</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search containers by name, image, or stack…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-card-border focus:border-white/20 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-lg py-2 pl-9 pr-4 transition-all"
          />
        </div>
        <span className="text-xs font-medium text-white/40">
          {filtered.length} container{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Container Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-white/40">
          <SpinIcon /><span className="text-xs font-medium">Loading Docker containers…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border border-card-border bg-card flex flex-col items-center justify-center text-center shadow-lg">
          <div className="w-12 h-12 rounded-2xl mb-3 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/60">
            <Icon icon="logos:docker-icon" width={24} height={24} />
          </div>
          <p className="font-sans font-bold text-sm text-white mb-1">No Docker containers found</p>
          <p className="text-xs text-white/40 max-w-sm mb-4">
            Deploy a container from AI Chat or start a Docker container on your system.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const isRunning = c.state === "running";
            return (
              <div
                key={c.id}
                onClick={() => router.push(`/containers/${c.id}`)}
                className="group cursor-pointer rounded-2xl p-5 border border-card-border hover:border-white/20 bg-card hover:bg-card transition-all duration-200 flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm group-hover:border-white/20 transition-all">
                        <Icon icon={c.icon || "logos:docker-icon"} width={24} height={24} className="shrink-0" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-sans font-bold text-sm text-white truncate font-mono group-hover:text-white">
                          {c.name}
                        </h3>
                        <p className="font-mono text-[11px] text-white/40 truncate mt-0.5">
                          {c.image}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition-all">
                      →
                    </span>
                  </div>

                  {/* Separate Badges with Iconify (Framework 1st, Docker 2nd, State 3rd, Port 4th) */}
                  <div className="flex items-center gap-1.5 flex-wrap my-3">
                    {/* 1. Framework / Inner Stack Badge (1st) */}
                    {c.framework && c.framework !== "Docker" && (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                          c.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                        }`}
                      >
                        <Icon icon={c.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                        <span>{c.framework.toLowerCase()}</span>
                      </span>
                    )}

                    {/* 2. Docker Badge (2nd) */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300">
                      <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                      <span>docker</span>
                    </span>

                    {/* 3. State / Status Badge (No bullet dot) */}
                    <span
                      className={`inline-flex items-center gap-1.5 text-[10.5px] font-mono font-bold px-2.5 py-0.5 rounded-md ${
                        isRunning
                          ? "bg-emerald-500/[0.1] border border-emerald-500/25 text-emerald-300"
                          : "bg-red-500/[0.12] border border-red-500/25 text-red-300"
                      }`}
                    >
                      <Icon
                        icon={isRunning ? "lucide:check-circle-2" : "lucide:stop-circle"}
                        width={11}
                        height={11}
                        className={isRunning ? "text-emerald-400" : "text-red-400"}
                      />
                      <span>{c.status || c.state}</span>
                    </span>

                    {/* 4. Port Badge */}
                    {c.port && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[11px] font-mono text-blue-300">
                        <Icon icon="lucide:radio" width={11} height={11} className="text-blue-400/80" />
                        <span>:{c.port}</span>
                      </span>
                    )}

                    {/* 5. Resource Metrics */}
                    {c.cpu && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.07] text-white/50">
                        <Icon icon="lucide:cpu" width={10} height={10} className="text-white/40" />
                        <span>{c.cpu}</span>
                      </span>
                    )}
                    {c.memory && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.07] text-white/50">
                        <Icon icon="lucide:hard-drive" width={10} height={10} className="text-white/40" />
                        <span>{c.memory}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                  <Link
                    href={`/containers/${c.id}`}
                    className="bg-white text-black font-bold text-xs px-3 py-1.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Terminal & Logs</span>
                  </Link>

                  <div className="flex items-center gap-1.5">
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-emerald-400 hover:text-white hover:bg-emerald-500/20 transition-all cursor-pointer"
                        title={`Open ${c.url}`}
                      >
                        <Icon icon="lucide:external-link" width={12} height={12} />
                      </a>
                    )}
                    {isRunning ? (
                      <>
                        <button
                          onClick={() => handleAction(c.id, "restart")}
                          disabled={!!actionLoading}
                          className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer disabled:opacity-40"
                          title="Restart Container"
                        >
                          {actionLoading === `${c.id}-restart` ? <SpinIcon size={11} /> : <Icon icon="lucide:rotate-cw" width={12} height={12} />}
                        </button>
                        <button
                          onClick={() => handleAction(c.id, "stop")}
                          disabled={!!actionLoading}
                          className="w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/25 transition-all cursor-pointer disabled:opacity-40"
                          title="Stop Container"
                        >
                          {actionLoading === `${c.id}-stop` ? <SpinIcon size={11} /> : <Icon icon="lucide:square" width={11} height={11} />}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction(c.id, "start")}
                        disabled={!!actionLoading}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/25 transition-all cursor-pointer disabled:opacity-40"
                        title="Start Container"
                      >
                        {actionLoading === `${c.id}-start` ? <SpinIcon size={11} /> : <Icon icon="lucide:play" width={12} height={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
