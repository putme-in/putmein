"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DeploymentSetupFields from "@/components/DeploymentSetupFields";
import { defaultProjectSetup } from "@/lib/project-setup";
import ProjectSetupFields, { type ProjectSourceAnalysis } from "@/components/ProjectSetupFields";
import { Icon } from "@iconify/react";
import { getPrimaryProjectUrl } from "@/lib/domains";

interface ProjectItem {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  status: "discovering" | "active" | "paused" | "error";
  isDocker?: boolean;
  framework?: string;
  frameworkSlug?: string;
  language?: string;
  icon?: string;
  colorClasses?: string;
  container?: {
    id: string;
    name: string;
    status: string;
    port?: number;
    url?: string;
  } | null;
  deployment?: {
    id: string;
    name: string;
    status: "pending" | "building" | "deploying" | "healthy" | "failed" | "stopped";
    hostPort?: number | null;
    deployUrl?: string | null;
    containerName?: string | null;
    buildLogs?: string | null;
  } | null;
  memory?: string | null;
  memoryStatus?: string | null;
  intervalSec: number;
  createdAt: string;
  updatedAt: string;
  _count?: { alerts: number };
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const FolderIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const LinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [setup, setSetup] = useState(defaultProjectSetup);
  const [sourceAnalysis, setSourceAnalysis] = useState<ProjectSourceAnalysis | null>(null);
  const [appDirectory, setAppDirectory] = useState(".");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState("");

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 10000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const analyzeSource = async () => {
    setSubmitting(true);
    setAddError("");
    try {
      const res = await fetch("/api/deploy/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRoot: sourceAnalysis?.sourceRoot || newPath, appDirectory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not analyze project");
      setSourceAnalysis(data);
      setAppDirectory(data.appDirectory);
      if (!newName) setNewName(data.projectPath.split(/[\\/]/).filter(Boolean).pop() || "my-app");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not analyze project");
    } finally { setSubmitting(false); }
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceAnalysis) { await analyzeSource(); return; }
    if (!newName.trim() || submitting || appDirectory !== sourceAnalysis.appDirectory) return;
    setSubmitting(true);
    setAddError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, projectPath: sourceAnalysis.projectPath, projectUrl: setup.projectUrl, runCommand: setup.startCommand, setup: { ...setup, sourceRoot: sourceAnalysis.sourceRoot, appDirectory: sourceAnalysis.appDirectory } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add project");
      setShowAddModal(false);
      setNewName("");
      setNewPath("");
      setSetup(defaultProjectSetup());
      setSourceAnalysis(null);
      setAppDirectory(".");
      fetchProjects();
      router.push(`/projects/${data.project.id}`);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.projectPath.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-jersey text-3xl text-white tracking-wide">Projects</h1>
          <p className="text-xs text-white/50 mt-1 font-normal">
            Inspect workspace file structures, AI-curated project memories, and linked container & monitoring tools.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="ray-btn-primary flex items-center gap-1.5 text-xs px-3.5 py-2 cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Project</span>
        </button>
      </div>

      {/* Search Filter & Project Count */}
      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search projects by name or path..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0e0e0e] border border-white/[0.08] focus:border-white/20 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-lg py-2 pl-9 pr-4 transition-all"
          />
        </div>
        <span className="text-xs font-medium text-white/40">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-white/40">
          <SpinIcon /><span className="text-xs font-medium">Loading projects...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-2xl border border-white/[0.08] bg-[#0c0c0c] flex flex-col items-center justify-center text-center shadow-lg">
          <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/60">
            <FolderIcon />
          </div>
          <p className="font-sans font-bold text-sm text-white mb-1">No projects found</p>
          <p className="text-xs text-white/40 max-w-sm mb-4">
            Deploy a new application from AI Chat or click <strong>Add Project</strong> to inspect local folders.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="ray-btn-primary text-xs px-3.5 py-2 cursor-pointer"
          >
            Add Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const effectiveUrl = getPrimaryProjectUrl(proj.projectUrl, proj.container?.port) || (proj.container?.url) || (proj.container?.port ? `http://localhost:${proj.container.port}` : null);
            return (
              <div
                key={proj.id}
                onClick={() => router.push(`/projects/${proj.id}`)}
                className="group cursor-pointer rounded-2xl p-5 border border-white/[0.08] hover:border-white/20 bg-[#0c0c0c] hover:bg-[#111111] transition-all duration-200 flex flex-col justify-between shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm group-hover:border-white/20 transition-all">
                        <Icon icon={proj.icon || (proj.isDocker ? "logos:docker-icon" : "logos:nodejs-icon")} width={24} height={24} className="shrink-0" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-sans font-bold text-sm text-white truncate group-hover:text-white">
                          {proj.name}
                        </h3>
                        <p className="font-mono text-[11px] text-white/40 truncate mt-0.5">
                          {proj.projectPath}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition-all">
                      →
                    </span>
                  </div>

                  {/* Separate Badges with Iconify (Framework 1st, Docker 2nd) */}
                  <div className="flex items-center gap-1.5 flex-wrap my-3">
                    {/* 1. Framework / Inner Stack Badge */}
                    {proj.framework && (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                          proj.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                        }`}
                      >
                        <Icon icon={proj.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                        <span>{proj.framework.toLowerCase()}</span>
                      </span>
                    )}

                    {/* 2. Docker Badge (comes second) */}
                    {proj.isDocker && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300">
                        <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                        <span>docker</span>
                      </span>
                    )}

                    {/* 3. Deployment Badge */}
                    {proj.deployment ? (
                      proj.deployment.status === "healthy" ? (
                        <Link
                          href={`/deployments/${proj.deployment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.1] border border-emerald-500/25 text-[10.5px] font-mono text-emerald-300 hover:border-emerald-500/50 transition-colors cursor-pointer"
                          title="View Deployment Details"
                        >
                          <Icon icon="lucide:check-circle-2" width={11} height={11} className="text-emerald-400" />
                          <span>deployed</span>
                          {proj.deployment.hostPort && <span className="text-emerald-400/80">:{proj.deployment.hostPort}</span>}
                        </Link>
                      ) : proj.deployment.status === "building" || proj.deployment.status === "deploying" ? (
                        <Link
                          href={`/deployments/${proj.deployment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/[0.1] border border-amber-500/25 text-[10.5px] font-mono text-amber-300 hover:border-amber-500/50 transition-colors cursor-pointer"
                        >
                          <SpinIcon size={10} />
                          <span>deploying…</span>
                        </Link>
                      ) : proj.deployment.status === "failed" ? (
                        <Link
                          href={`/deployments/${proj.deployment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-red-500/[0.15] border border-red-500/30 text-[10.5px] font-mono text-red-300 hover:border-red-500/50 transition-colors cursor-pointer"
                          title="Deploy failed - click to inspect and troubleshoot"
                        >
                          <Icon icon="lucide:alert-triangle" width={11} height={11} className="text-red-400" />
                          <span>deploy failed</span>
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-[10.5px] font-mono text-white/50">
                          <Icon icon="lucide:circle-dot" width={10} height={10} className="text-white/40" />
                          <span>{proj.deployment.status}</span>
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.07] text-[10px] font-mono text-white/30">
                        <Icon icon="lucide:minus" width={9} height={9} className="text-white/30" />
                        <span>not deployed</span>
                      </span>
                    )}

                    {/* 4. Port / Domain Badge */}
                    {proj.container?.port ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[11px] font-mono text-blue-300">
                        <Icon icon="lucide:radio" width={11} height={11} className="text-blue-400/80" />
                        <span>:{proj.container.port}</span>
                      </span>
                    ) : proj.projectUrl ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-[11px] font-mono text-emerald-300 truncate max-w-[160px]">
                        <Icon icon="lucide:globe" width={11} height={11} className="text-emerald-400/80" />
                        <span>{(getPrimaryProjectUrl(proj.projectUrl) || proj.projectUrl).replace(/^https?:\/\//, "")}</span>
                      </span>
                    ) : null}

                    {/* 5. Synced Badge */}
                    {proj.memoryStatus === "done" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-purple-500/[0.08] border border-purple-500/20 text-[10.5px] font-mono text-purple-300">
                        <Icon icon="lucide:sparkles" width={11} height={11} className="text-purple-400" />
                        <span>synced</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-white/40 truncate">
                      {effectiveUrl ? effectiveUrl.replace(/^https?:\/\//, "") : "Local Workspace"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {effectiveUrl && (
                      <a
                        href={effectiveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                        title={`Open ${effectiveUrl}`}
                      >
                        <LinkIcon />
                      </a>
                    )}
                    {proj.deployment && (
                      <Link
                        href={`/deployments/${proj.deployment.id}`}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                        title="Go to Deployment & Build Logs"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                      </Link>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/monitor/${proj.id}`);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                      title="Go to Monitor & Live Logs"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Project Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6 bg-[#0e0e0e] border border-white/[0.12] shadow-2xl">
            <h2 className="font-semibold text-2xl text-white tracking-wide mb-1">Add Project</h2>
            <p className="text-xs text-white/50 mb-5 font-normal">
              Register a project root folder to inspect its file structure, track memory, and connect tools.
            </p>

            <form onSubmit={handleAddProject} className="flex flex-col gap-4">
              {!sourceAnalysis ? (
                <div>
                  <label htmlFor="existing-source-path" className="ray-eyebrow block mb-1.5">Project absolute path</label>
                  <input id="existing-source-path" required placeholder="/srv/projects/my-app" value={newPath}
                    onChange={event => setNewPath(event.target.value)} disabled={submitting}
                    className="ray-input font-mono text-xs" />
                </div>
              ) : (
                <ProjectSetupFields name={newName} onNameChange={setNewName} analysis={sourceAnalysis}
                  appDirectory={appDirectory} onDirectoryChange={setAppDirectory} onAnalyze={analyzeSource} busy={submitting}>
                  <DeploymentSetupFields value={setup} onChange={setSetup} existing />
                  <button type="button" className="ray-btn-ghost text-xs self-start" onClick={() => {
                    setSourceAnalysis(null); setSetup(defaultProjectSetup()); setAppDirectory("."); setAddError("");
                  }}>Change source path</button>
                </ProjectSetupFields>
              )}

              {addError && (
                <p className="text-xs text-red-400">{addError}</p>
              )}

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="ray-btn-ghost flex-1 py-2 text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || Boolean(sourceAnalysis && appDirectory !== sourceAnalysis.appDirectory)}
                  className="ray-btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {submitting && <SpinIcon />}
                  <span>{sourceAnalysis ? "Add Project" : "Next · Project setup"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
