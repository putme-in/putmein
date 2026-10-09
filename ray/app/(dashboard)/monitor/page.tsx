"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getPrimaryProjectUrl } from "@/lib/domains";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface MonitorProject {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  logPaths: string;
  logCommand?: string;
  intervalSec: number;
  enabled: boolean;
  status: "discovering" | "active" | "paused" | "error";
  lastChecked?: string;
  createdAt: string;
  memory?: string | null;
  memoryStatus?: string | null;
  _count?: { alerts: number };
}

interface MonitorAlert {
  id: string;
  projectId: string;
  severity: "info" | "warn" | "error" | "critical";
  message: string;
  rawLog: string;
  dismissed: boolean;
  createdAt: string;
  project?: { name: string };
}

interface LogFile {
  path: string;
  content: string;
  error?: string;
}

// ─── Project Type Detection ────────────────────────────────────────────────────

type ProjectType =
  | "Next.js"
  | "Node.js"
  | "Vite / React"
  | "HTML / Static"
  | "Go"
  | "Python"
  | "Docker"
  | "Rails"
  | "Rust"
  | "PHP"
  | "Java"
  | "Unknown";

const projectTypeColors: Record<ProjectType, string> = {
  "Next.js": "#0070f3",
  "Node.js": "#339933",
  "Vite / React": "#61dafb",
  "HTML / Static": "#f97316",
  "Go": "#00add8",
  "Python": "#3776ab",
  "Docker": "#2496ed",
  "Rails": "#cc0000",
  "Rust": "#ce412b",
  "PHP": "#777bb4",
  "Java": "#f89820",
  "Unknown": "rgba(255,255,255,0.25)",
};

function detectProjectType(logPaths: unknown, memory?: string | null): ProjectType {
  const paths = (typeof logPaths === "string" ? logPaths : Array.isArray(logPaths) ? logPaths.join(" ") : "").toLowerCase();
  const mem = (memory || "").toLowerCase();

  if (mem.includes("next.js") || mem.includes("nextjs") || paths.includes(".next")) return "Next.js";
  if (mem.includes("vite") || mem.includes("react") || paths.includes("vite")) return "Vite / React";
  if (mem.includes("python") || paths.includes(".py") || paths.includes("uvicorn") || paths.includes("gunicorn") || mem.includes("django") || mem.includes("flask") || mem.includes("fastapi")) return "Python";
  if (mem.includes("golang") || mem.includes("go module") || paths.includes(".go") || mem.includes("go.mod")) return "Go";
  if (mem.includes("rust") || paths.includes("target/debug") || paths.includes("cargo") || mem.includes("cargo")) return "Rust";
  if (mem.includes("rails") || mem.includes("ruby on rails") || paths.includes("rails") || mem.includes("gemfile")) return "Rails";
  if (mem.includes("php") || paths.includes(".php") || paths.includes("laravel") || mem.includes("laravel")) return "PHP";
  if (mem.includes("java") || paths.includes(".jar") || paths.includes("spring") || mem.includes("spring boot") || mem.includes("pom.xml")) return "Java";
  if (mem.includes("html") || mem.includes("static") || mem.includes("css") || paths.includes(".html") || paths.includes("index.html") || mem.includes("nginx")) return "HTML / Static";
  if (mem.includes("node") || mem.includes("express") || paths.includes("node_modules") || paths.includes(".npm") || mem.includes("npm") || mem.includes("javascript") || mem.includes("typescript")) return "Node.js";
  if (mem.includes("docker") || paths.includes("docker") || paths.includes("container")) return "Docker";
  return "Unknown";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const severityColor: Record<string, string> = {
  critical: "#ef4444", error: "#f97316", warn: "#eab308", info: "#22c55e",
};
const severityBg: Record<string, string> = {
  critical: "rgba(239,68,68,0.08)", error: "rgba(249,115,22,0.08)",
  warn: "rgba(234,179,8,0.08)", info: "rgba(34,197,94,0.08)",
};
const statusDot: Record<string, string> = {
  active: "#22c55e", discovering: "#eab308", paused: "rgba(255,255,255,0.2)", error: "#ef4444",
};
const statusLabel: Record<string, string> = {
  active: "Active", discovering: "Discovering", paused: "Paused", error: "Error",
};

function formatTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function parseLogPaths(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
      if (typeof parsed === "string" && parsed.trim()) return [parsed.trim()];
    } catch {
      if (raw.trim()) return [raw.trim()];
    }
  }
  return [];
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const XIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);
const ChevronIcon = ({ deg = 0 }: { deg?: number }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: `rotate(${deg}deg)`, transition: "transform 200ms" }}>
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);
const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);
const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);
const LinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);
const PlusIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const RefreshIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

// ─── Add Project Modal ────────────────────────────────────────────────────────

function AddProjectModal({ onClose, onAdded }: { onClose: () => void; onAdded: (projectId: string) => void }) {
  const [name, setName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [logCommand, setLogCommand] = useState("");
  const [intervalSec, setIntervalSec] = useState(30);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !projectPath.trim()) { setError("Project name and path are required."); return; }
    setAdding(true); setError("");
    try {
      const res = await fetch("/api/monitor/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          projectPath: projectPath.trim(),
          projectUrl: projectUrl.trim() || undefined,
          logCommand: logCommand.trim() || undefined,
          intervalSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add project");
      onAdded(data.project?.id || "");
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    } finally { setAdding(false); }
  };

  const intervalOptions = [{ label: "10s", value: 10 }, { label: "30s", value: 30 }, { label: "1m", value: 60 }, { label: "5m", value: 300 }];

  return (
    <div
      className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl p-6 bg-card border border-card-border shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-semibold text-lg">Add Project to Monitor</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
            <XIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Project Name</label>
            <input className="ray-input" placeholder="my-api-server" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Project Path</label>
            <input className="ray-input" placeholder="/home/user/projects/my-api" value={projectPath} onChange={(e) => setProjectPath(e.target.value)} />
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              Brain will discover logs and analyze the project automatically.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Project URL <span style={{ color: "rgba(255,255,255,0.2)" }}>(optional)</span></label>
            <input className="ray-input" placeholder="http://localhost:3000" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Custom Log Command <span style={{ color: "rgba(255,255,255,0.2)" }}>(optional)</span></label>
            <input className="ray-input font-mono text-sm" placeholder="journalctl -u my-api -n 100 --no-pager" value={logCommand} onChange={(e) => setLogCommand(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Check Interval</label>
            <div className="flex flex-wrap gap-2">
              {intervalOptions.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setIntervalSec(opt.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: intervalSec === opt.value ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${intervalSec === opt.value ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}`, color: intervalSec === opt.value ? "#fff" : "rgba(255,255,255,0.4)" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="ray-btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={adding} className="ray-btn-primary flex-1 flex items-center justify-center gap-2">
              {adding && <SpinIcon />}
              {adding ? "Adding…" : "Start Monitoring"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Project Modal ───────────────────────────────────────────────────────

function EditProjectModal({ project, onClose, onSaved }: { project: MonitorProject; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [projectUrl, setProjectUrl] = useState(project.projectUrl || "");
  const [logCommand, setLogCommand] = useState(project.logCommand || "");
  const [intervalSec, setIntervalSec] = useState(project.intervalSec);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const intervalOptions = [{ label: "10s", value: 10 }, { label: "30s", value: 30 }, { label: "1m", value: 60 }, { label: "5m", value: 300 }];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/monitor/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          projectUrl: projectUrl.trim() || null,
          logCommand: logCommand.trim() || null,
          intervalSec,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      onSaved(); onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl p-6 bg-card border border-card-border shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-semibold text-lg">Edit Project</h2>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{project.projectPath}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
            <XIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Project Name</label>
            <input className="ray-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Project URL <span style={{ color: "rgba(255,255,255,0.2)" }}>(optional)</span></label>
            <input className="ray-input" placeholder="http://localhost:3000" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Custom Log Command <span style={{ color: "rgba(255,255,255,0.2)" }}>(optional)</span></label>
            <input className="ray-input font-mono text-sm" placeholder="journalctl -u my-api -n 100 --no-pager" value={logCommand} onChange={(e) => setLogCommand(e.target.value)} />
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>Leave blank to use auto-discovered log files.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="ray-eyebrow">Check Interval</label>
            <div className="flex flex-wrap gap-2">
              {intervalOptions.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setIntervalSec(opt.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: intervalSec === opt.value ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${intervalSec === opt.value ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}`, color: intervalSec === opt.value ? "#fff" : "rgba(255,255,255,0.4)" }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="ray-btn-ghost flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="ray-btn-primary flex-1 flex items-center justify-center gap-2">
              {saving && <SpinIcon />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



// ─── Alert Row ────────────────────────────────────────────────────────────────

function AlertRow({ alert, onDismiss, showProject = true }: { alert: MonitorAlert; onDismiss: (id: string) => void; showProject?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl transition-all duration-200"
      style={{ background: severityBg[alert.severity] || "rgba(255,255,255,0.03)", border: `1px solid ${severityColor[alert.severity] || "rgba(255,255,255,0.06)"}18` }}>
      <div className="flex items-start gap-3 p-3">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: severityColor[alert.severity] || "#fff" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: severityColor[alert.severity] }}>{alert.severity}</span>
                {showProject && alert.project?.name && (
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono)" }}>{alert.project.name}</span>
                )}
              </div>
              <p className="text-sm text-white leading-snug">{alert.message}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>{formatTime(alert.createdAt)}</span>
              <button onClick={() => onDismiss(alert.id)} className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{ color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.04)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>
                Dismiss
              </button>
            </div>
          </div>
          {alert.rawLog && (
            <button onClick={() => setExpanded(!expanded)} className="mt-1.5 text-[10px] flex items-center gap-1 transition-colors" style={{ color: "rgba(255,255,255,0.3)" }}>
              <ChevronIcon deg={expanded ? 90 : 0} />
              {expanded ? "Hide" : "View"} raw log
            </button>
          )}
          {expanded && alert.rawLog && (
            <pre className="mt-2 text-[11px] leading-relaxed overflow-x-auto rounded-lg p-3"
              style={{ background: "rgba(0,0,0,0.5)", border: "1px solid var(--color-card-border)", color: "rgba(255,255,255,0.6)", fontFamily: "var(--font-mono)", maxHeight: "200px" }}>
              {alert.rawLog}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Live Log Viewer ──────────────────────────────────────────────────────────

function LiveLogViewer({ projectId, logPath, onRemove }: { projectId: string; logPath: string; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/logs?lines=200`);
      if (!res.ok) throw new Error("Failed to load logs");
      const data = await res.json();
      const file = (data.logs as LogFile[])?.find((f) => f.path === logPath);
      if (file?.error) { setError(file.error); setContent(""); }
      else { setContent(file?.content || "(no content yet)"); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setLoading(false); }
  }, [projectId, logPath]);

  const toggleStream = () => {
    const next = !streaming;
    setStreaming(next);
    if (next) {
      load();
      streamTimerRef.current = setInterval(load, 3000);
    } else {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    }
  };

  useEffect(() => {
    return () => { if (streamTimerRef.current) clearInterval(streamTimerRef.current); };
  }, []);

  useEffect(() => {
    if (open && !content && !loading) load();
  }, [open, content, loading, load]);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [content, open]);

  const filename = logPath.split("/").pop() || logPath;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-2.5 transition-colors"
        style={{ background: open ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = open ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)")}>
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: "rgba(255,255,255,0.4)" }}><FileIcon /></span>
          <span className="text-xs font-medium text-white truncate" title={logPath}>{filename}</span>
          <span className="text-[10px] truncate hidden sm:block" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>{logPath}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {open && (
            <>
              <button onClick={(e) => { e.stopPropagation(); toggleStream(); }}
                className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                style={{
                  color: streaming ? "#22c55e" : "rgba(255,255,255,0.4)",
                  background: streaming ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${streaming ? "rgba(34,197,94,0.2)" : "transparent"}`,
                }}>
                {streaming ? (
                  <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />Live</>
                ) : "Stream"}
              </button>
              <button onClick={(e) => { e.stopPropagation(); load(); }}
                className="text-[10px] px-2 py-0.5 rounded transition-colors flex items-center gap-1"
                style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
                <RefreshIcon />
              </button>
            </>
          )}
          {onRemove && (
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="w-5 h-5 flex items-center justify-center rounded transition-colors"
              style={{ color: "rgba(255,255,255,0.2)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
              title="Remove log path">
              <XIcon size={10} />
            </button>
          )}
          <span style={{ color: "rgba(255,255,255,0.3)" }}><ChevronIcon deg={open ? 90 : 0} /></span>
        </div>
      </button>
      {open && (
        <div style={{ background: "#050505", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {loading && !content ? (
            <div className="flex items-center justify-center py-6">
              <span style={{ color: "rgba(255,255,255,0.3)" }}><SpinIcon /></span>
            </div>
          ) : error ? (
            <p className="text-xs px-4 py-3" style={{ color: "#f97316" }}>⚠ {error}</p>
          ) : (
            <pre className="text-[11px] leading-relaxed overflow-x-auto p-4"
              style={{ color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", maxHeight: "300px", overflowY: "auto" }}>
              {content}
              <div ref={bottomRef} />
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Project Detail Drawer ────────────────────────────────────────────────────

function ProjectDetailDrawer({
  project,
  onClose,
  onEdit,
  onDismissAlert,
  onLogPathAdded,
}: {
  project: MonitorProject;
  onClose: () => void;
  onEdit: () => void;
  onDismissAlert: (id: string) => void;
  onLogPathAdded: () => void;
}) {
  const [alerts, setAlerts] = useState<MonitorAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [logPaths, setLogPaths] = useState<string[]>(parseLogPaths(project.logPaths));
  const [addingLogPath, setAddingLogPath] = useState(false);
  const [newLogPath, setNewLogPath] = useState("");
  const [savingLogPath, setSavingLogPath] = useState(false);
  const [logPathError, setLogPathError] = useState("");

  const projectType = detectProjectType(project.logPaths, project.memory);
  const typeColor = projectTypeColors[projectType];

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitor/alerts?projectId=${project.id}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch { /* silent */ }
    finally { setLoadingAlerts(false); }
  }, [project.id]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleDismiss = async (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    onDismissAlert(alertId);
    try { await fetch(`/api/monitor/alerts/${alertId}`, { method: "DELETE" }); } catch { fetchAlerts(); }
  };

  const handleAddLogPath = async () => {
    const path = newLogPath.trim();
    if (!path) return;
    if (logPaths.includes(path)) { setLogPathError("This log path is already added."); return; }
    setSavingLogPath(true); setLogPathError("");
    try {
      const res = await fetch(`/api/monitor/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addLogPath: path }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      setLogPaths((prev) => [...prev, path]);
      setNewLogPath("");
      setAddingLogPath(false);
      onLogPathAdded();
    } catch (err: unknown) {
      setLogPathError(err instanceof Error ? err.message : "Failed to add log path");
    } finally { setSavingLogPath(false); }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-[200] w-screen h-screen bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full z-[201] flex flex-col overflow-hidden"
        style={{ width: "min(540px, 95vw)", background: "#060606", borderLeft: "1px solid rgba(255,255,255,0.08)", boxShadow: "-40px 0 80px rgba(0,0,0,0.7)" }}>
        {/* Drawer header */}
        <div className="flex items-start justify-between p-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: statusDot[project.status], boxShadow: project.status === "active" ? `0 0 10px ${statusDot[project.status]}88` : "none" }} />
              {project.status === "active" && <div className="absolute inset-0 rounded-full animate-ping" style={{ background: statusDot[project.status], opacity: 0.3 }} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-white font-semibold text-base truncate">{project.name}</h2>
                {/* Project type badge */}
                {projectType !== "Unknown" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}28` }}>
                    {projectType}
                  </span>
                )}
              </div>
              <p className="text-[11px] truncate mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{project.projectPath}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-3 flex-shrink-0">
            {/* Link button */}
            {project.projectUrl && (
              <a href={getPrimaryProjectUrl(project.projectUrl) || project.projectUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid var(--color-card-border)", textDecoration: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
                title="Open project URL">
                <LinkIcon /> Open
              </a>
            )}
            <button onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid var(--color-card-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}>
              <EditIcon /> Edit
            </button>
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "rgba(255,255,255,0.3)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
              <XIcon />
            </button>
          </div>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
          {/* Meta info */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Status", value: statusLabel[project.status] || project.status, color: statusDot[project.status] },
              { label: "Interval", value: `Every ${project.intervalSec}s`, color: "#fff" },
              { label: "Alerts", value: String(alerts.length), color: alerts.length > 0 ? "#f97316" : "#22c55e" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-card-border)" }}>
                <div className="text-sm font-bold mb-1" style={{ color: item.color }}>{item.value}</div>
                <div className="ray-eyebrow">{item.label}</div>
              </div>
            ))}
          </div>

          {project.lastChecked && (
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>Last checked {formatTime(project.lastChecked)}</p>
          )}

          {/* Memory status */}
          {(project.memoryStatus === "pending" || project.memoryStatus === "analyzing") && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)" }}>
              <SpinIcon size={13} />
              <p className="text-xs" style={{ color: "rgba(234,179,8,0.8)" }}>AI is analyzing this project to build its memory…</p>
            </div>
          )}
          {project.memoryStatus === "done" && project.memory && (
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
              <p className="ray-eyebrow mb-2">Project Memory</p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>{project.memory.slice(0, 400)}{project.memory.length > 400 ? "…" : ""}</p>
            </div>
          )}

          {/* Alerts section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Alerts</h3>
              {alerts.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {alerts.length} active
                </span>
              )}
            </div>
            {loadingAlerts ? (
              <div className="flex flex-col gap-2">
                {[1, 2].map((i) => <div key={i} className="h-14 rounded-xl animate-shimmer" style={{ background: "rgba(255,255,255,0.03)" }} />)}
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 rounded-xl" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.1)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" className="mb-2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <p className="text-xs font-medium" style={{ color: "#22c55e" }}>All clear — no active alerts</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {alerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} onDismiss={handleDismiss} showProject={false} />
                ))}
              </div>
            )}
          </div>

          {/* Live Logs section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Live Logs</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{logPaths.length} source{logPaths.length !== 1 ? "s" : ""}</span>
                <button
                  onClick={() => { setAddingLogPath(!addingLogPath); setLogPathError(""); setNewLogPath(""); }}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-all"
                  style={{ background: addingLogPath ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid var(--color-card-border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}>
                  <PlusIcon /> Add Path
                </button>
              </div>
            </div>

            {/* Add log path inline form */}
            {addingLogPath && (
              <div className="mb-3 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
                <p className="ray-eyebrow mb-2">Add Log File Path</p>
                <div className="flex gap-2">
                  <input
                    className="ray-input flex-1 font-mono text-xs"
                    placeholder="/var/log/myapp/app.log"
                    value={newLogPath}
                    onChange={(e) => setNewLogPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddLogPath(); if (e.key === "Escape") { setAddingLogPath(false); setNewLogPath(""); } }}
                    autoFocus
                  />
                  <button
                    onClick={handleAddLogPath}
                    disabled={savingLogPath || !newLogPath.trim()}
                    className="ray-btn-primary flex items-center gap-1 text-xs px-3">
                    {savingLogPath ? <SpinIcon size={11} /> : <PlusIcon />}
                    Add
                  </button>
                </div>
                {logPathError && <p className="text-[11px] text-red-400 mt-1.5">{logPathError}</p>}
              </div>
            )}

            {logPaths.length === 0 ? (
              <div className="py-6 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No log files discovered yet. Use "Add Path" to add manually, or wait for the next scan.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {logPaths.map((path) => (
                  <LiveLogViewer key={path} projectId={project.id} logPath={path} />
                ))}
              </div>
            )}

            {project.logCommand && (
              <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
                <p className="ray-eyebrow mb-1">Custom Log Command</p>
                <code className="text-xs" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)" }}>{project.logCommand}</code>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  onToggle,
  onEdit,
  onClick,
}: {
  project: MonitorProject;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (project: MonitorProject) => void;
  onClick: (project: MonitorProject) => void;
}) {
  const logPathsArr = parseLogPaths(project.logPaths);
  const projectType = detectProjectType(project.logPaths, project.memory);
  const typeColor = projectTypeColors[projectType];

  return (
    <div
      className="ray-card p-4 flex flex-col gap-3 cursor-pointer group"
      onClick={() => onClick(project)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: statusDot[project.status] || "rgba(255,255,255,0.2)", boxShadow: project.status === "active" ? `0 0 8px ${statusDot[project.status]}66` : "none" }} />
            {project.status === "active" && <div className="absolute inset-0 rounded-full animate-ping" style={{ background: statusDot[project.status], opacity: 0.4 }} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white truncate group-hover:text-white/90 transition-colors">{project.name}</h3>
              {/* Project type badge */}
              {projectType !== "Unknown" && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}28` }}>
                  {projectType}
                </span>
              )}
              {(project._count?.alerts ?? 0) > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {project._count?.alerts} alert{(project._count?.alerts ?? 0) > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-[11px] truncate mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{project.projectPath}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded"
            style={{ background: `${statusDot[project.status]}18`, color: statusDot[project.status], border: `1px solid ${statusDot[project.status]}28` }}>
            {statusLabel[project.status] || project.status}
          </span>

          {/* Link button */}
          {project.projectUrl && (
            <a href={getPrimaryProjectUrl(project.projectUrl) || project.projectUrl} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.2)", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
              title={project.projectUrl}>
              <LinkIcon />
            </a>
          )}

          {/* Edit */}
          <button onClick={() => onEdit(project)}
            className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
            style={{ color: "rgba(255,255,255,0.2)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
            title="Edit project">
            <EditIcon />
          </button>

          {/* Toggle */}
          <button
            onClick={() => onToggle(project.id, !project.enabled)}
            title={project.enabled ? "Pause" : "Resume"}
            style={{
              position: "relative",
              flexShrink: 0,
              width: 36,
              height: 20,
              borderRadius: 10,
              border: "none",
              outline: "none",
              cursor: "pointer",
              background: project.enabled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.12)",
              transition: "background 180ms",
            }}>
            <span style={{
              position: "absolute",
              top: 3,
              left: project.enabled ? 19 : 3,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: project.enabled ? "#111" : "rgba(255,255,255,0.6)",
              transition: "left 180ms, background 180ms",
            }} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
        <span>Every {project.intervalSec}s</span>
        {project.lastChecked && <span>Last checked {formatTime(project.lastChecked)}</span>}
        <span>{logPathsArr.length} log source{logPathsArr.length !== 1 ? "s" : ""}</span>
        {/* Memory status indicator */}
        {(project.memoryStatus === "pending" || project.memoryStatus === "analyzing") && (
          <span className="flex items-center gap-1" style={{ color: "rgba(234,179,8,0.6)" }}>
            <SpinIcon size={10} /> Analyzing…
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
          Click to view details <ChevronIcon deg={0} />
        </span>
      </div>

      {logPathsArr.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {logPathsArr.slice(0, 4).map((path, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded truncate max-w-[200px]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-card-border)", color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}
              title={path}>
              {path.split("/").pop()}
            </span>
          ))}
          {logPathsArr.length > 4 && (
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>+{logPathsArr.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Monitor Page ─────────────────────────────────────────────────────────

export default function MonitorPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<MonitorProject[]>([]);
  const [alerts, setAlerts] = useState<MonitorAlert[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "alerts">("projects");
  const [alertFilter, setAlertFilter] = useState<"all" | "critical" | "error" | "warn" | "info">("all");
  const [editingProject, setEditingProject] = useState<MonitorProject | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/projects");
      if (res.ok) { const data = await res.json(); setProjects(data.projects || []); }
    } catch { /* silent */ }
    finally { setLoadingProjects(false); }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/alerts?dismissed=false");
      if (res.ok) { const data = await res.json(); setAlerts(data.alerts || []); }
    } catch { /* silent */ }
    finally { setLoadingAlerts(false); }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchAlerts();
    const interval = setInterval(() => { fetchProjects(); fetchAlerts(); }, 15000);
    return () => clearInterval(interval);
  }, [fetchProjects, fetchAlerts]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, enabled, status: enabled ? "active" : "paused" } : p));
    try { await fetch(`/api/monitor/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }); }
    catch { fetchProjects(); }
  };

  // Remove project from list only after successful deletion (called by DeleteProjectModal)
  const handleProjectDeleted = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleDismissAlert = async (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    try { await fetch(`/api/monitor/alerts/${alertId}`, { method: "DELETE" }); }
    catch { fetchAlerts(); }
  };

  const filteredAlerts = alertFilter === "all" ? alerts : alerts.filter((a) => a.severity === alertFilter);
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const errorCount = alerts.filter((a) => a.severity === "error").length;
  const warnCount = alerts.filter((a) => a.severity === "warn").length;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {/* Header */}
      <div className="mb-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-jersey text-4xl text-white tracking-wide mb-1">Monitor</h1>
            <p className="text-sm" style={{ color: "#52525b" }}>24/7 log analysis and anomaly detection for your projects</p>
          </div>
          <button onClick={() => setShowAddModal(true)} className="ray-btn-primary flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Project
          </button>
        </div>
      </div>

      {/* Stats */}
      {(projects.length > 0 || alerts.length > 0) && (
        <div className="grid grid-cols-4 gap-3 mb-6 animate-fade-in" style={{ animationDelay: "50ms" }}>
          {[
            { label: "Monitored", value: projects.length, color: "#fff" },
            { label: "Active", value: projects.filter((p) => p.status === "active").length, color: "#22c55e" },
            { label: "Alerts", value: alerts.length, color: alerts.length > 0 ? "#f97316" : "#fff" },
            { label: "Critical", value: criticalCount, color: criticalCount > 0 ? "#ef4444" : "#fff" },
          ].map((stat) => (
            <div key={stat.label} className="ray-card p-4">
              <div className="text-2xl font-bold mb-1" style={{ color: stat.color }}>{stat.value}</div>
              <div className="ray-eyebrow">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      {projects.length > 0 && (
        <div className="flex items-center gap-1 mb-5 animate-fade-in" style={{ animationDelay: "80ms" }}>
          {[
            { id: "projects", label: "Projects", count: projects.length },
            { id: "alerts", label: "Alerts", count: alerts.length },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as "projects" | "alerts")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ background: activeTab === tab.id ? "rgba(255,255,255,0.07)" : "transparent", border: `1px solid ${activeTab === tab.id ? "rgba(255,255,255,0.1)" : "transparent"}`, color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.35)" }}>
              {tab.label}
              {tab.count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: activeTab === tab.id ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)", color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.3)" }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Projects tab */}
      {(activeTab === "projects" || projects.length === 0) && (
        <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
          {loadingProjects ? (
            <div className="flex flex-col gap-3">
              {[1, 2].map((i) => <div key={i} className="h-28 rounded-xl animate-shimmer" style={{ background: "rgba(255,255,255,0.03)" }} />)}
            </div>
          ) : projects.length === 0 ? (
            <div className="ray-card flex flex-col items-center justify-center py-16 text-center" style={{ background: "var(--color-card)" }}>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--color-card-border)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
              </div>
              <h2 className="text-white font-semibold text-base mb-2">No projects monitored yet</h2>
              <p className="text-sm mb-6 max-w-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                Add a project path and the AI will automatically discover log files, detect running processes, and flag anomalies 24/7.
              </p>
              <button onClick={() => setShowAddModal(true)} className="ray-btn-primary">Add your first project</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onToggle={handleToggle}
                  onEdit={(p) => setEditingProject(p)}
                  onClick={(p) => router.push(`/monitor/${p.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alerts tab */}
      {activeTab === "alerts" && projects.length > 0 && (
        <div className="animate-fade-in" style={{ animationDelay: "100ms" }}>
          {alerts.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              {[
                { id: "all", label: "All" },
                { id: "critical", label: "Critical", count: criticalCount },
                { id: "error", label: "Error", count: errorCount },
                { id: "warn", label: "Warning", count: warnCount },
                { id: "info", label: "Info" },
              ].map((f) => (
                <button key={f.id} onClick={() => setAlertFilter(f.id as typeof alertFilter)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: alertFilter === f.id ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${alertFilter === f.id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}`, color: alertFilter === f.id ? "#fff" : "rgba(255,255,255,0.35)" }}>
                  {f.count !== undefined && f.count > 0 && <div className="w-1.5 h-1.5 rounded-full" style={{ background: severityColor[f.id] }} />}
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {loadingAlerts ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl animate-shimmer" style={{ background: "rgba(255,255,255,0.03)" }} />)}
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-white mb-1">All clear</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                No active alerts {alertFilter !== "all" ? `with severity "${alertFilter}"` : ""}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredAlerts.map((alert) => <AlertRow key={alert.id} alert={alert} onDismiss={handleDismissAlert} />)}
            </div>
          )}
        </div>
      )}

      {/* Modals & Drawers */}
      {showAddModal && (
        <AddProjectModal onClose={() => setShowAddModal(false)} onAdded={(_id: string) => { fetchProjects(); fetchAlerts(); }} />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSaved={() => { fetchProjects(); }}
        />
      )}

    </div>
  );
}
