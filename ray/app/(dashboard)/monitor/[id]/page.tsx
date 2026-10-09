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
  runCommand?: string | null;
  managedPid?: number | null;
  intervalSec: number;
  enabled: boolean;
  status: "discovering" | "active" | "paused" | "error";
  lastChecked?: string;
  createdAt: string;
  memory?: string | null;
  memoryStatus?: string | null;
  managedLogFile?: string | null;
}

interface MonitorAlert {
  id: string;
  projectId: string;
  severity: "info" | "warn" | "error" | "critical" | "vulnerable";
  message: string;
  rawLog: string;
  dismissed: boolean;
  createdAt: string;
}

interface LogFile {
  path: string;
  content: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const severityColor: Record<string, string> = {
  critical: "#ef4444", error: "#f97316", warn: "#eab308", info: "#22c55e", vulnerable: "#a855f7",
};
const severityBg: Record<string, string> = {
  critical: "rgba(239,68,68,0.07)", error: "rgba(249,115,22,0.07)",
  warn: "rgba(234,179,8,0.07)", info: "rgba(34,197,94,0.07)", vulnerable: "rgba(168,85,247,0.07)",
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
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

const ChevronIcon = ({ deg = 0 }: { deg?: number }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ transform: `rotate(${deg}deg)`, transition: "transform 200ms" }}>
    <polyline points="9 18 15 12 9 6"/>
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

const SparklesIcon = ({ size = 13, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
  </svg>
);

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

// ─── Alert Row ────────────────────────────────────────────────────────────────

function AlertRow({ alert, onDismiss }: { alert: MonitorAlert; onDismiss: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl transition-all duration-200"
      style={{ background: severityBg[alert.severity] || "rgba(255,255,255,0.03)", border: `1px solid ${severityColor[alert.severity] || "rgba(255,255,255,0.06)"}22` }}>
      <div className="flex items-start gap-3 p-3.5">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: severityColor[alert.severity] || "#fff" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: severityColor[alert.severity] }}>{alert.severity}</span>
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>{formatTime(alert.createdAt)}</span>
              </div>
              <p className="text-sm text-white leading-snug">{alert.message}</p>
            </div>
            <button onClick={() => onDismiss(alert.id)} className="text-[10px] px-2 py-1 rounded-md transition-colors flex-shrink-0"
              style={{ color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.04)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>
              Dismiss
            </button>
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

// ─── Log File Viewer ─────────────────────────────────────────────────────────

function LogFileViewer({ projectId, logPath, autoOpen = false }: { projectId: string; logPath: string; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [lineCount, setLineCount] = useState(100);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (lines: number = lineCount) => {
    setLoading(true); setHasError(false);
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/logs?lines=${lines}`);
      if (!res.ok) { setHasError(true); setLoading(false); return; }
      const data = await res.json();
      const file = (data.logs as LogFile[])?.find((f) => f.path === logPath);
      if (file?.error || !file?.content) {
        // Silently mark as unavailable — don't show an error
        setContent("");
        setHasError(true);
      } else {
        setContent(file.content);
      }
    } catch {
      setHasError(true);
    } finally { setLoading(false); }
  }, [projectId, logPath, lineCount]);

  useEffect(() => {
    if (open && !content && !loading && !hasError) load();
  }, [open, content, loading, hasError, load]);

  useEffect(() => {
    if (open && content && bottomRef.current) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [content, open]);

  // Don't render at all if there's an error (file unreadable, doesn't exist, etc.)
  if (hasError && !open) return null;

  const filename = logPath.split("/").pop() || logPath;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      {/* Header — use div, not button, to avoid button-in-button hydration error */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(!open); }}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors text-left cursor-pointer select-none"
        style={{ background: open ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = open ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)")}>
        <div className="flex items-center gap-2.5 min-w-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span className="text-sm font-medium text-white">{filename}</span>
          <span className="text-[11px] truncate hidden sm:block" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>{logPath}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {open && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); const next = lineCount === 100 ? 500 : 100; setLineCount(next); load(next); }}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
                {lineCount === 100 ? "Show 500" : "Show 100"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); load(); }}
                className="text-[10px] px-2 py-0.5 rounded transition-colors"
                style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
                ↻ Refresh
              </button>
            </>
          )}
          <ChevronIcon deg={open ? 90 : 0} />
        </div>
      </div>

      {/* Content */}
      {open && (
        <div style={{ background: "#030303", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8" style={{ color: "rgba(255,255,255,0.3)" }}>
              <SpinIcon /><span className="text-xs">Loading logs…</span>
            </div>
          ) : !content ? (
            <p className="text-xs px-4 py-4" style={{ color: "rgba(255,255,255,0.3)" }}>No content available yet.</p>
          ) : (
            <pre className="text-[12px] leading-[1.6] overflow-auto p-4"
              style={{ color: "rgba(255,255,255,0.65)", fontFamily: "var(--font-mono)", maxHeight: "500px" }}>
              {content}
              <div ref={bottomRef} />
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Terminal Pane ─────────────────────────────────────────────────────────────

function TerminalPane({
  projectId,
  logFile,
  isLive,
  detectedPort,
  effectiveUrl,
  onDiagnose,
}: {
  projectId: string;
  logFile: string;
  isLive: boolean;
  detectedPort?: number | null;
  effectiveUrl?: string | null;
  onDiagnose?: (logs: string) => void;
}) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const bottomRef = useRef<HTMLPreElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/logs?lines=500`);
      if (res.ok) {
        const data = await res.json();
        interface LogFileItem { path: string; content?: string; error?: string; }
        const logs = (data.logs as LogFileItem[]) || [];
        const file = logs.find((f) => f.path === logFile) || logs[0];
        if (file?.content !== undefined) {
          setContent(file.content);
          setLastUpdated(new Date());
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [projectId, logFile]);

  // Auto-scroll to bottom when content updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollTop = bottomRef.current.scrollHeight;
    }
  }, [content]);

  // Initial load
  useEffect(() => { fetchLog(); }, [fetchLog]);

  // Poll every 2s when live
  useEffect(() => {
    if (!isLive) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(fetchLog, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, fetchLog]);

  const filename = logFile.split("/").pop() || logFile;
  const hasErrorSignature = !isLive && !!content && (
    /command not found|code 127|npm error|cannot find module|eaddrinuse|exit code|lifecycle script|failed with error|sh: next/i.test(content)
  );

  return (
    <div className="rounded-xl overflow-hidden flex flex-col gap-0" style={{ border: "1px solid var(--color-card-border)", background: "#030303" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="text-xs font-medium text-white truncate" style={{ fontFamily: "var(--font-mono)" }}>{filename}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {effectiveUrl && (
            <a
              href={effectiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{
                background: "rgba(34,197,94,0.12)",
                color: "#22c55e",
                border: "1px solid rgba(34,197,94,0.25)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(34,197,94,0.22)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(34,197,94,0.12)";
                e.currentTarget.style.color = "#22c55e";
              }}
              title="Open in new tab">
              <LinkIcon /> Open {detectedPort ? `(:${detectedPort})` : ""}
            </a>
          )}
          {onDiagnose && (
            <button
              onClick={() => onDiagnose(content)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.75)",
                border: "1px solid var(--color-card-border)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.color = "rgba(255,255,255,0.75)";
              }}
              title="Diagnose startup failure with Ray AI">
              <SparklesIcon size={12} color="#fff" />
              AI Troubleshoot
            </button>
          )}
          {isLive && <span className="text-[10px]" style={{ color: "rgba(34,197,94,0.7)" }}>Auto-refresh every 2s</span>}
          {lastUpdated && !isLive && (
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchLog}
            className="text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Inline AI Failure Banner if error detected in logs */}
      {hasErrorSignature && (
        <div
          className="mx-3 mt-3 p-3 rounded-xl flex items-center justify-between gap-3 animate-fade-in"
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-card-border)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-card-border)" }}
            >
              <SparklesIcon size={13} color="#fff" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">Startup failure detected in logs</p>
              <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
                Ray AI can analyze the crash trace, resolve missing dependencies, and auto-run the project.
              </p>
            </div>
          </div>
          {onDiagnose && (
            <button
              onClick={() => onDiagnose(content)}
              className="ray-btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0"
            >
              <SparklesIcon size={12} color="#000" />
              Diagnose & Fix
            </button>
          )}
        </div>
      )}

      {loading && !content ? (
        <div className="flex items-center justify-center gap-2 py-12" style={{ color: "rgba(255,255,255,0.3)" }}>
          <SpinIcon /><span className="text-xs">Loading…</span>
        </div>
      ) : !content ? (
        <p className="text-xs px-4 py-6" style={{ color: "rgba(255,255,255,0.3)" }}>No output yet. The process may still be starting…</p>
      ) : (
        <pre
          ref={bottomRef}
          className="text-[12px] leading-[1.55] p-4 overflow-auto"
          style={{ color: "rgba(255,255,255,0.78)", fontFamily: "var(--font-mono)", maxHeight: "62vh", minHeight: "240px" }}>
          {content}
        </pre>
      )}
    </div>
  );
}

// ─── AI Diagnosis Modal ────────────────────────────────────────────────────────

interface DiagnosisData {
  summary: string;
  rootCause: string;
  fixSteps: string[];
  commands: string[];
  startCommand: string;
  canAutoFix: boolean;
}

function DiagnosisModal({
  projectId,
  projectName,
  command,
  logs,
  onClose,
  onFixed,
}: {
  projectId: string;
  projectName: string;
  command: string;
  logs: string;
  onClose: () => void;
  onFixed: (spawned?: { pid: number; logFile?: string; port?: number; url?: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState<DiagnosisData | null>(null);
  const [diagError, setDiagError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixLogs, setFixLogs] = useState("");
  const [fixError, setFixError] = useState("");

  const runDiagnosis = useCallback(async () => {
    setLoading(true);
    setDiagError("");
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, logs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Diagnosis failed");
      setDiagnosis(data.diagnosis);
    } catch (err: unknown) {
      setDiagError(err instanceof Error ? err.message : "Failed to diagnose");
    } finally {
      setLoading(false);
    }
  }, [projectId, command, logs]);

  useEffect(() => {
    runDiagnosis();
  }, [runDiagnosis]);

  const handleApplyFix = async () => {
    if (!diagnosis) return;
    setFixing(true);
    setFixError("");
    setFixLogs("Initiating remediation…\n");
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: diagnosis.commands,
          startCommand: diagnosis.startCommand,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFixLogs(data.logs || "");
        throw new Error(data.error || "Fix failed to complete");
      }
      setFixLogs(data.logs || "Completed successfully.");
      setTimeout(() => {
        onFixed(data.spawned);
      }, 1000);
    } catch (err: unknown) {
      setFixError(err instanceof Error ? err.message : "Fix execution failed");
    } finally {
      setFixing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md animate-fade-in p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !fixing) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 animate-fade-in-scale flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-card-border)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.95)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--color-card-border)",
              }}
            >
              <SparklesIcon size={15} color="#fff" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Ray AI Troubleshooter</h2>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                Diagnosing startup and runtime issues for <span className="text-white font-medium">{projectName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={fixing}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-white/40 hover:text-white"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-card-border)" }}>
              <SpinIcon size={18} />
            </div>
            <p className="text-sm font-medium text-white mt-2">Analyzing Project & Crash Trace…</p>
            <p className="text-xs max-w-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              Inspecting directory dependencies, package manifests, and terminal failure logs.
            </p>
          </div>
        ) : diagError ? (
          <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <p className="text-xs text-red-400 font-semibold mb-1">Diagnosis Failed</p>
            <p className="text-xs text-red-300/80 mb-3">{diagError}</p>
            <button
              onClick={runDiagnosis}
              className="ray-btn-ghost text-xs px-3 py-1.5"
            >
              Retry Diagnosis
            </button>
          </div>
        ) : diagnosis ? (
          <div className="flex flex-col gap-3.5">
            {/* Problem Summary */}
            <div
              className="p-3.5 rounded-xl flex items-start gap-3"
              style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.18)",
              }}
            >
              <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#ef4444" }} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Problem Identified</p>
                <p className="text-sm font-medium text-white mt-0.5">{diagnosis.summary}</p>
              </div>
            </div>

            {/* Root Cause */}
            <div
              className="p-3.5 rounded-xl"
              style={{
                background: "var(--color-card)",
                border: "1px solid var(--color-card-border)",
              }}
            >
              <p className="ray-eyebrow mb-1.5">Root Cause Analysis</p>
              <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.7)" }}>
                {diagnosis.rootCause}
              </p>
            </div>

            {/* Recommended Fix Steps */}
            <div
              className="p-3.5 rounded-xl flex flex-col gap-2.5"
              style={{
                background: "var(--color-card)",
                border: "1px solid var(--color-card-border)",
              }}
            >
              <p className="ray-eyebrow">Recommended Remediation Plan</p>
              <ul className="flex flex-col gap-1.5">
                {diagnosis.fixSteps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                      style={{ background: "rgba(255,255,255,0.08)", color: "#ffffff", border: "1px solid var(--color-card-border)" }}>
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>

              {/* Commands preview */}
              {diagnosis.commands.length > 0 && (
                <div className="rounded-lg p-2.5 overflow-x-auto mt-1" style={{ background: "#030303", border: "1px solid var(--color-card-border)" }}>
                  <p className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>Commands to execute</p>
                  {diagnosis.commands.map((c, i) => (
                    <div key={i} className="text-xs text-white/90 font-mono flex items-center gap-1.5">
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>$</span> {c}
                    </div>
                  ))}
                  {diagnosis.startCommand && (
                    <div className="text-xs text-white/60 font-mono flex items-center gap-1.5 mt-1 pt-1 border-t border-white/5">
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>$</span> {diagnosis.startCommand} (start server)
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Fix Logs stream if fixing */}
            {(fixing || fixLogs) && (
              <div className="rounded-xl p-3 overflow-hidden flex flex-col gap-2" style={{ background: "#030303", border: "1px solid var(--color-card-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white flex items-center gap-2">
                    {fixing && <SpinIcon size={12} />}
                    {fixing ? "Executing Fix…" : "Fix Execution Result"}
                  </span>
                </div>
                <pre className="text-[11px] font-mono leading-relaxed p-2 rounded max-h-48 overflow-y-auto" style={{ color: "rgba(255,255,255,0.8)", background: "var(--color-card)" }}>
                  {fixLogs}
                </pre>
              </div>
            )}

            {fixError && (
              <div className="p-3 rounded-lg text-xs text-red-400" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {fixError}
              </div>
            )}
          </div>
        ) : null}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t mt-1" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <button
            onClick={onClose}
            disabled={fixing}
            className="ray-btn-ghost text-xs px-4 py-2"
          >
            {fixing ? "Running…" : "Close"}
          </button>

          {diagnosis?.canAutoFix && (
            <button
              onClick={handleApplyFix}
              disabled={fixing || loading}
              className="ray-btn-primary text-xs px-4 py-2 flex items-center gap-2"
            >
              {fixing ? <SpinIcon size={13} /> : <SparklesIcon size={13} color="#000" />}
              {fixing ? "Applying Fix…" : "Apply Fix & Run Project"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ project, onClose, onSaved }: { project: MonitorProject; onClose: () => void; onSaved: (updated: Partial<MonitorProject>) => void }) {
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
        body: JSON.stringify({ name: name.trim(), projectUrl: projectUrl.trim() || null, logCommand: logCommand.trim() || null, intervalSec }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      onSaved({ name: name.trim(), projectUrl: projectUrl.trim() || null, logCommand: logCommand.trim() || undefined, intervalSec });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl p-6 animate-fade-in-scale"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-card-border)", boxShadow: "0 0 60px rgba(0,0,0,0.9)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">Edit Project</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg"
            style={{ color: "rgba(255,255,255,0.3)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
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

// ─── Project Detail Page ──────────────────────────────────────────────────────

export default function MonitorProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState<string>("");
  const [project, setProject] = useState<MonitorProject | null>(null);
  const [logPaths, setLogPaths] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<MonitorAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertFilter, setAlertFilter] = useState<"all" | "critical" | "vulnerable" | "error" | "warn" | "info">("all");
  const [activeTab, setActiveTab] = useState<"alerts" | "logs" | "memory" | "terminal">("alerts");
  const [showEdit, setShowEdit] = useState(false);
  // Memory state
  const [memory, setMemory] = useState<string | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<string>("pending");
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  // Live log add state
  const [addingLogPath, setAddingLogPath] = useState(false);
  const [newLogPath, setNewLogPath] = useState("");
  const [savingLogPath, setSavingLogPath] = useState(false);
  const [logPathError, setLogPathError] = useState("");
  // Run & Container state
  type RunningProcess = { pid: number; command: string; runtime: string; logFile: string; port?: number; url?: string };
  interface DockerContainerInfo {
    id: string;
    name: string;
    image: string;
    status: string;
    ports: string;
    port?: number;
    url?: string;
  }
  const [runProcesses, setRunProcesses] = useState<RunningProcess[]>([]);
  const [suggestedCommand, setSuggestedCommand] = useState("");
  const [managedPid, setManagedPid] = useState<number | null>(null);
  const [managedLogFile, setManagedLogFile] = useState<string | null>(null);
  const [dockerContainer, setDockerContainer] = useState<DockerContainerInfo | null>(null);
  const [containerActionLoading, setContainerActionLoading] = useState(false);
  const [detectedPort, setDetectedPort] = useState<number | null>(null);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [runCommand, setRunCommand] = useState("");
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  // AI Diagnose state
  const [showDiagnose, setShowDiagnose] = useState(false);
  const [diagnoseLogs, setDiagnoseLogs] = useState("");

  const handleOpenDiagnose = (logs?: string) => {
    setDiagnoseLogs(logs || "");
    setShowDiagnose(true);
  };

  const handleDiagnoseFixed = (spawned?: { pid: number; logFile?: string; port?: number; url?: string }) => {
    setShowDiagnose(false);
    if (spawned?.pid) {
      setManagedPid(spawned.pid);
      if (spawned.logFile) setManagedLogFile(spawned.logFile);
      if (spawned.port) {
        setDetectedPort(spawned.port);
        setDetectedUrl(spawned.url || `http://localhost:${spawned.port}`);
      }
    }
    setActiveTab("terminal");
    if (id) {
      fetchProject(id);
      fetchRunInfo(id);
    }
  };

  // Resolve params
  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const fetchProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch("/api/monitor/projects");
      if (res.ok) {
        const data = await res.json();
        const found = (data.projects as MonitorProject[])?.find((p) => p.id === projectId);
        if (found) {
          setProject(found);
          setLogPaths(parseLogPaths(found.logPaths));
        } else router.replace("/monitor");
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [router]);

  const fetchAlerts = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/monitor/alerts?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchProject(id);
    fetchAlerts(id);
    const interval = setInterval(() => { fetchProject(id); fetchAlerts(id); }, 15000);
    return () => clearInterval(interval);
  }, [id, fetchProject, fetchAlerts]);

  // Fetch memory when memory tab is opened
  const fetchMemory = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/memory`);
      if (res.ok) {
        const data = await res.json();
        setMemory(data.memory || null);
        setMemoryStatus(data.memoryStatus || "pending");
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (activeTab === "memory" && id) fetchMemory(id);
  }, [activeTab, id, fetchMemory]);

  const saveMemory = async () => {
    if (!id) return;
    setSavingMemory(true);
    try {
      await fetch(`/api/monitor/projects/${id}/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: memoryDraft, memoryStatus: "done" }),
      });
      setMemory(memoryDraft);
      setEditingMemory(false);
    } catch { /* silent */ }
    finally { setSavingMemory(false); }
  };

  // Fetch run info for the Run button & Docker container detection
  const fetchRunInfo = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/run`);
      if (res.ok) {
        const data = await res.json();
        const procs = (data.processes || []) as RunningProcess[];
        setRunProcesses(procs);
        setSuggestedCommand(data.suggestedCommand || "");
        setManagedPid(data.managedPid || null);
        setManagedLogFile(data.managedLogFile || null);
        setDockerContainer(data.container || null);

        if (data.managedPort) {
          setDetectedPort(data.managedPort);
          setDetectedUrl(data.managedUrl || `http://localhost:${data.managedPort}`);
        } else if (data.container?.port) {
          setDetectedPort(data.container.port);
          setDetectedUrl(data.container.url || `http://localhost:${data.container.port}`);
        } else if (procs.length > 0) {
          const withPort = procs.find((p) => p.port && p.port > 0);
          if (withPort?.port) {
            setDetectedPort(withPort.port);
            setDetectedUrl(withPort.url || `http://localhost:${withPort.port}`);
          }
        } else if (!data.managedPid && !data.container) {
          setDetectedPort(null);
          setDetectedUrl(null);
        }
        if (data.managedPid) setRunCommand("");
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!id) return;
    fetchRunInfo(id);
    const interval = setInterval(() => fetchRunInfo(id), (managedPid || dockerContainer) ? 3000 : 12000);
    return () => clearInterval(interval);
  }, [id, managedPid, dockerContainer, fetchRunInfo]);

  const handleRun = async (killPid?: number) => {
    if (!id) return;
    setRunning(true); setRunError("");
    try {
      const cmd = runCommand || suggestedCommand || "npm run dev";
      const res = await fetch(`/api/monitor/projects/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spawn", command: cmd, killPid: killPid || 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run");
      setManagedPid(data.pid);
      setManagedLogFile(data.logFile || null);
      if (data.port) {
        setDetectedPort(data.port);
        setDetectedUrl(data.url || `http://localhost:${data.port}`);
      }
      setShowRunConfirm(false);
      // Auto-switch to Terminal tab
      setActiveTab("terminal");
      // Refresh project to get new logCommand and process info
      fetchProject(id);
      fetchRunInfo(id);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : "Failed");
    } finally { setRunning(false); }
  };

  const handleStop = async () => {
    if (!id) return;
    setRunning(true);
    try {
      await fetch(`/api/monitor/projects/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          killPid: managedPid || 0,
          containerName: dockerContainer?.name,
        }),
      });
      setManagedPid(null);
      setManagedLogFile(null);
      setDockerContainer(null);
      setDetectedPort(null);
      setDetectedUrl(null);
      fetchRunInfo(id);
    } catch { /* silent */ }
    finally { setRunning(false); }
  };

  const handleRestartContainer = async () => {
    if (!id || !dockerContainer) return;
    setContainerActionLoading(true);
    try {
      await fetch(`/api/monitor/projects/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restart-container",
          containerName: dockerContainer.name,
        }),
      });
      fetchRunInfo(id);
    } catch { /* silent */ }
    finally { setContainerActionLoading(false); }
  };

  const handleDismiss = async (alertId: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    try { await fetch(`/api/monitor/alerts/${alertId}`, { method: "DELETE" }); }
    catch { if (id) fetchAlerts(id); }
  };

  const handleToggle = async () => {
    if (!project) return;
    const newEnabled = !project.enabled;
    setProject((p) => p ? { ...p, enabled: newEnabled, status: newEnabled ? "active" : "paused" } : p);
    try {
      await fetch(`/api/monitor/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
    } catch { if (id) fetchProject(id); }
  };

  const handleAddLogPath = async () => {
    const path = newLogPath.trim();
    if (!path || !project) return;
    if (logPaths.includes(path)) { setLogPathError("Already added."); return; }
    setSavingLogPath(true); setLogPathError("");
    try {
      const res = await fetch(`/api/monitor/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addLogPath: path }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      setLogPaths((prev) => [...prev, path]);
      setNewLogPath(""); setAddingLogPath(false);
    } catch (err: unknown) {
      setLogPathError(err instanceof Error ? err.message : "Failed");
    } finally { setSavingLogPath(false); }
  };

  const handleDismissAll = async () => {
    const visibleIds = filteredAlerts.map((a) => a.id);
    setAlerts((prev) => prev.filter((a) => !visibleIds.includes(a.id)));
    try {
      await Promise.all(visibleIds.map((aid) => fetch(`/api/monitor/alerts/${aid}`, { method: "DELETE" })));
    } catch { if (id) fetchAlerts(id); }
  };

  if (loading || !project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <SpinIcon />
      </div>
    );
  }

  const filteredAlerts = alertFilter === "all" ? alerts : alerts.filter((a) => a.severity === alertFilter);
  const criticalCount = alerts.filter((a) => a.severity === "critical" || a.severity === "vulnerable").length;
  const errorCount = alerts.filter((a) => a.severity === "error").length;
  const warnCount = alerts.filter((a) => a.severity === "warn").length;
  const dotColor = statusDot[project.status] || "rgba(255,255,255,0.2)";
  const projectType = detectProjectType(project.logPaths, project.memory);
  const typeColor = projectTypeColors[projectType];
  const activeLogFile = managedLogFile || project.managedLogFile || (dockerContainer ? `docker:${dockerContainer.name}` : (logPaths[0] || null));
  const effectiveUrl = getPrimaryProjectUrl(project.projectUrl, detectedPort) || detectedUrl || (detectedPort ? `http://localhost:${detectedPort}` : null);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      {/* Back + Header */}
      <div className="mb-6 animate-fade-in">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs mb-4 transition-colors"
          style={{ color: "rgba(255,255,255,0.35)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to Monitor
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-3 h-3 rounded-full" style={{ background: dotColor, boxShadow: project.status === "active" ? `0 0 12px ${dotColor}88` : "none" }} />
              {project.status === "active" && <div className="absolute inset-0 rounded-full animate-ping" style={{ background: dotColor, opacity: 0.3 }} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-jersey text-3xl text-white tracking-wide leading-tight">{project.name}</h1>
                {projectType !== "Unknown" && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                    style={{ background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}28` }}>
                    {projectType}
                  </span>
                )}
                {dockerContainer && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded flex items-center gap-1.5"
                    style={{ background: "rgba(36,150,237,0.12)", color: "#38bdf8", border: "1px solid rgba(36,150,237,0.25)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Docker Container
                  </span>
                )}
                {detectedPort && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                    style={{ background: "rgba(0,112,243,0.12)", color: "#38bdf8", border: "1px solid rgba(0,112,243,0.25)" }}>
                    Port :{detectedPort}
                  </span>
                )}
              </div>
              <p className="text-xs mt-1 truncate" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{project.projectPath}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Status badge */}
            <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg"
              style={{ background: `${dotColor}18`, color: dotColor, border: `1px solid ${dotColor}28` }}>
              {statusLabel[project.status] || project.status}
            </span>

            {/* Link button */}
            {effectiveUrl && (
              <a href={effectiveUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)", textDecoration: "none" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(34,197,94,0.2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#22c55e"; e.currentTarget.style.background = "rgba(34,197,94,0.1)"; }}
                title={`Open ${effectiveUrl}`}>
                <LinkIcon /> Open {detectedPort ? `(:${detectedPort})` : ""}
              </a>
            )}

            {/* Run / Stop button — supports Host Process & Docker Container */}
            {managedPid ? (
              <>
                <button onClick={() => setActiveTab("terminal")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: activeTab === "terminal" ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.07)", color: "rgba(34,197,94,0.8)", border: "1px solid rgba(34,197,94,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(34,197,94,0.15)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = activeTab === "terminal" ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.07)"; }}>
                  <span className="flex w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
                  Terminal
                </button>
                <button onClick={handleStop} disabled={running}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(239,68,68,0.1)", color: "rgba(239,68,68,0.8)", border: "1px solid rgba(239,68,68,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(239,68,68,0.8)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}>
                  {running ? <SpinIcon /> : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>}
                  Stop (PID {managedPid}{detectedPort ? ` · :${detectedPort}` : ""})
                </button>
              </>
            ) : dockerContainer ? (
              <>
                <button onClick={() => setActiveTab("terminal")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: activeTab === "terminal" ? "rgba(36,150,237,0.18)" : "rgba(36,150,237,0.08)", color: "#38bdf8", border: "1px solid rgba(36,150,237,0.25)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(36,150,237,0.18)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = activeTab === "terminal" ? "rgba(36,150,237,0.18)" : "rgba(36,150,237,0.08)"; }}>
                  <span className="flex w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
                  Docker Terminal
                </button>
                <button onClick={handleStop} disabled={running}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(239,68,68,0.1)", color: "rgba(239,68,68,0.8)", border: "1px solid rgba(239,68,68,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(239,68,68,0.8)"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}>
                  {running ? <SpinIcon /> : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>}
                  Stop Container ({dockerContainer.port ? `:${dockerContainer.port}` : dockerContainer.name})
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenDiagnose()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.75)",
                    border: "1px solid var(--color-card-border)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.color = "#fff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.75)";
                  }}
                  title="Diagnose project startup issues with Ray AI"
                >
                  <SparklesIcon size={12} color="#fff" />
                  AI Troubleshoot
                </button>
                <button
                  onClick={() => {
                    if (runProcesses.length > 0) { setShowRunConfirm(true); }
                    else { handleRun(); }
                  }}
                  disabled={running}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(34,197,94,0.1)", color: "rgba(34,197,94,0.8)", border: "1px solid rgba(34,197,94,0.2)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#22c55e"; e.currentTarget.style.background = "rgba(34,197,94,0.2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(34,197,94,0.8)"; e.currentTarget.style.background = "rgba(34,197,94,0.1)"; }}>
                  {running ? <SpinIcon /> : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                  Run
                </button>
              </div>
            )}

            {/* Toggle — settings-page style */}
            <button
              onClick={handleToggle}
              title={project.enabled ? "Pause monitoring" : "Resume monitoring"}
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

            {/* Edit */}
            <button onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid var(--color-card-border)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6 animate-fade-in" style={{ animationDelay: "40ms" }}>
        {[
          { label: "Status", value: statusLabel[project.status] || project.status, color: dotColor },
          { label: "Interval", value: `${project.intervalSec}s`, color: "#fff" },
          { label: "Log Sources", value: String(logPaths.length), color: "#fff" },
          { label: "Active Alerts", value: String(alerts.length), color: alerts.length > 0 ? "#f97316" : "#22c55e" },
        ].map((stat) => (
          <div key={stat.label} className="ray-card p-4" style={{ background: "var(--color-card)" }}>
            <div className="text-xl font-bold mb-1" style={{ color: stat.color }}>{stat.value}</div>
            <div className="ray-eyebrow">{stat.label}</div>
          </div>
        ))}
      </div>

      {project.lastChecked && (
        <p className="text-[11px] mb-5" style={{ color: "rgba(255,255,255,0.2)" }}>Last checked {formatTime(project.lastChecked)}</p>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 animate-fade-in" style={{ animationDelay: "60ms" }}>
        {[
          { id: "alerts", label: "Alerts", count: alerts.length },
          { id: "logs", label: "Live Logs", count: logPaths.length },
          { id: "memory", label: "Memory", count: 0, badge: memoryStatus === "analyzing" ? "…" : memoryStatus === "done" && memory ? "✓" : (project.memoryStatus === "pending" || project.memoryStatus === "analyzing") ? "…" : "" },
          {
            id: "terminal",
            label: dockerContainer ? "Docker Terminal" : "Terminal",
            count: 0,
            live: !!managedPid || !!dockerContainer,
            badge: dockerContainer ? "Docker" : "",
          },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as "alerts" | "logs" | "memory" | "terminal")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: activeTab === tab.id ? "rgba(255,255,255,0.07)" : "transparent", border: `1px solid ${activeTab === tab.id ? "rgba(255,255,255,0.1)" : "transparent"}`, color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.35)" }}>
            {"live" in tab && tab.live && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: "#22c55e" }} />
            )}
            {tab.label}
            {tab.count > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: activeTab === tab.id ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)", color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.3)" }}>
                {tab.count}
              </span>
            )}
            {"badge" in tab && tab.badge && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: tab.badge === "Docker" ? "rgba(36,150,237,0.15)" : "rgba(34,197,94,0.1)", color: tab.badge === "Docker" ? "#38bdf8" : "#22c55e", border: `1px solid ${tab.badge === "Docker" ? "rgba(36,150,237,0.25)" : "rgba(34,197,94,0.2)"}` }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Run confirm dialog */}
      {showRunConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--color-card)", border: "1px solid var(--color-card-border)", boxShadow: "0 0 60px rgba(0,0,0,0.9)" }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Process already running</p>
                <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{runProcesses.length} process{runProcesses.length !== 1 ? "es" : ""} detected</p>
              </div>
            </div>
            {runProcesses.slice(0, 2).map((p) => (
              <div key={p.pid} className="mb-2 rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-xs text-white">PID {p.pid} <span style={{ color: "rgba(255,255,255,0.35)" }}>({p.runtime})</span></div>
                <div className="text-[10px] truncate mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)" }}>{p.command}</div>
              </div>
            ))}
            <p className="text-xs mt-3 mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>Ray will kill the existing process and restart it, capturing all output to a log file.</p>
            <div className="mb-3">
              <label className="ray-eyebrow mb-1 block">Start command</label>
              <input className="ray-input font-mono text-xs w-full" value={runCommand || suggestedCommand} onChange={(e) => setRunCommand(e.target.value)} placeholder="npm run dev" />
            </div>
            {runError && <p className="text-xs text-red-400 mb-3">{runError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowRunConfirm(false)} className="ray-btn-ghost flex-1">Cancel</button>
              <button onClick={() => handleRun(runProcesses[0]?.pid)} disabled={running} className="ray-btn-primary flex-1 flex items-center justify-center gap-1.5">
                {running && <SpinIcon />}
                Kill & Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts tab */}
      {activeTab === "alerts" && (
        <div className="animate-fade-in">
          {alerts.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {[
                  { id: "all", label: "All" },
                  { id: "critical", label: "Critical", count: criticalCount },
                  { id: "vulnerable", label: "Vulnerable", count: alerts.filter((a) => a.severity === "vulnerable").length },
                  { id: "error", label: "Error", count: errorCount },
                  { id: "warn", label: "Warning", count: warnCount },
                  { id: "info", label: "Info" },
                ].map((f) => (
                  <button key={f.id} onClick={() => setAlertFilter(f.id as typeof alertFilter)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: alertFilter === f.id ? "rgba(255,255,255,0.08)" : "transparent", border: `1px solid ${alertFilter === f.id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}`, color: alertFilter === f.id ? "#fff" : "rgba(255,255,255,0.35)" }}>
                    {f.count !== undefined && f.count > 0 && (
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: severityColor[f.id] }} />
                    )}
                    {f.label}
                  </button>
                ))}
              </div>
              {filteredAlerts.length > 0 && (
                <button onClick={handleDismissAll} className="text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
                  Dismiss all
                </button>
              )}
            </div>
          )}
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center ray-card" style={{ background: "var(--color-card)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-white mb-1">All clear</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                No active {alertFilter !== "all" ? `"${alertFilter}" ` : ""}alerts for this project
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredAlerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onDismiss={handleDismiss} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Logs tab */}
      {activeTab === "logs" && (
        <div className="animate-fade-in">
          {/* Log command info */}
          {project.logCommand && (
            <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
              <p className="ray-eyebrow mb-1">Active Log Command</p>
              <code className="text-xs" style={{ color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)" }}>{project.logCommand}</code>
            </div>
          )}

          {/* Add Log Path */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-white">{logPaths.length} log source{logPaths.length !== 1 ? "s" : ""}</p>
            <button onClick={() => { setAddingLogPath(!addingLogPath); setLogPathError(""); setNewLogPath(""); }}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg transition-all"
              style={{ background: addingLogPath ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid var(--color-card-border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.5)")}>
              <PlusIcon /> Add Log Path
            </button>
          </div>

          {addingLogPath && (
            <div className="mb-4 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-card-border)" }}>
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
                <button onClick={handleAddLogPath} disabled={savingLogPath || !newLogPath.trim()}
                  className="ray-btn-primary flex items-center gap-1 text-xs px-3">
                  {savingLogPath ? <SpinIcon /> : <PlusIcon />} Add
                </button>
              </div>
              {logPathError && <p className="text-[11px] text-red-400 mt-1.5">{logPathError}</p>}
            </div>
          )}

          {/* Capture tip */}
          {logPaths.length === 0 && !project.logCommand && (
            <div className="rounded-xl px-4 py-4 mb-4" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}>
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5" style={{ color: "#eab308" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                Tip: Capture your terminal output
              </p>
              <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
                To monitor logs from a running <code style={{ fontFamily: "var(--font-mono)" }}>npm run dev</code>, redirect its output:
              </p>
              <pre className="text-[11px] rounded-lg p-3" style={{ background: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.65)", fontFamily: "var(--font-mono)" }}>
                {`npm run dev 2>&1 | tee /tmp/${project.name.replace(/\s+/g, "-").toLowerCase()}.log`}
              </pre>
              <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.35)" }}>Then use <strong>Add Log Path</strong> above to add that file, or set a custom log command via <strong>Edit</strong>.</p>
            </div>
          )}

          {logPaths.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center ray-card" style={{ background: "var(--color-card)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-card-border)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-white mb-1">No log files yet</p>
              <p className="text-xs max-w-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Brain will scan on the next check interval. Use <strong>Add Log Path</strong> to add manually.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {logPaths.map((path, i) => (
                <LogFileViewer key={path} projectId={project.id} logPath={path} autoOpen={i === 0 && logPaths.length === 1} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Memory tab */}
      {activeTab === "memory" && (
        <div className="animate-fade-in">
          <div className="ray-card p-6" style={{ background: "var(--color-card)" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/>
                </svg>
                <span className="ray-eyebrow">Project Memory</span>
                {memoryStatus === "analyzing" && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    <SpinIcon /> Analyzing…
                  </span>
                )}
              </div>
              {!editingMemory && memory && (
                <button onClick={() => { setMemoryDraft(memory); setEditingMemory(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "1px solid var(--color-card-border)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}>
                  Edit
                </button>
              )}
            </div>

            {memoryStatus === "pending" || (!memory && memoryStatus !== "error") ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
                </div>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>Memory pending</p>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>AI will analyze this project when Brain is online</p>
              </div>
            ) : memoryStatus === "error" ? (
              <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)" }}>
                <p className="text-xs" style={{ color: "rgba(239,68,68,0.7)" }}>{memory}</p>
                <button onClick={() => id && fetchMemory(id)} className="text-xs mt-2 underline" style={{ color: "rgba(255,255,255,0.3)" }}>Retry</button>
              </div>
            ) : editingMemory ? (
              <div>
                <textarea
                  value={memoryDraft}
                  onChange={(e) => setMemoryDraft(e.target.value)}
                  rows={20}
                  className="ray-input w-full font-mono text-xs leading-relaxed resize-y"
                  style={{ minHeight: 300 }}
                />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setEditingMemory(false)} className="ray-btn-ghost flex-1">Cancel</button>
                  <button onClick={saveMemory} disabled={savingMemory} className="ray-btn-primary flex-1 flex items-center justify-center gap-1.5">
                    {savingMemory && <SpinIcon />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <pre className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.7)", fontFamily: "inherit" }}>
                {memory}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* Terminal tab — live output from managed process or Docker container */}
      {activeTab === "terminal" && (
        <div className="animate-fade-in">
          {/* Docker Container Banner */}
          {dockerContainer && (
            <div className="mb-3 p-3.5 rounded-xl flex items-center justify-between gap-3 animate-fade-in"
              style={{ background: "var(--color-card)", border: "1px solid var(--color-card-border)" }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(36,150,237,0.12)", border: "1px solid rgba(36,150,237,0.25)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#2496ed"><path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.186.185.186m0 2.716h2.118a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.186.185.186m-2.954 0h2.119a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185H8.075a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m-2.955 0h2.119a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185H5.12a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m14.771 4.972c-.547-.38-1.579-.475-2.427-.475-.152 0-.301.004-.447.012-.396-2.585-2.613-3.692-2.613-3.692s-.98 1.092-1.516 2.378c-.286-.062-.591-.097-.912-.097H2.888A2.888 2.888 0 000 14.364c0 3.237 2.008 6.549 5.86 6.549 4.608 0 7.893-2.68 9.382-6.386 1.487.11 3.51-.237 4.707-1.127.35-.26.547-.63.547-1.048 0-.414-.194-.783-.54-.122"/></svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-white font-mono">{dockerContainer.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"
                      style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {dockerContainer.status || "Running"}
                    </span>
                    {dockerContainer.port && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                        style={{ background: "rgba(0,112,243,0.12)", color: "#38bdf8", border: "1px solid rgba(0,112,243,0.25)" }}>
                        Port :{dockerContainer.port}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-mono)" }}>
                    Image: {dockerContainer.image} {dockerContainer.ports ? `· ${dockerContainer.ports}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleRestartContainer} disabled={containerActionLoading}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", border: "1px solid var(--color-card-border)" }}>
                  {containerActionLoading ? <SpinIcon size={11} /> : "Restart Container"}
                </button>
                <button onClick={handleStop} disabled={running}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                  Stop
                </button>
              </div>
            </div>
          )}

          {activeLogFile ? (
            <div>
              {/* Header (when no container banner or for host process) */}
              {!dockerContainer && (
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {managedPid ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg"
                          style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
                          Running · PID {managedPid}
                        </span>
                        {detectedPort && (
                          <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg"
                            style={{ background: "rgba(0,112,243,0.12)", color: "#38bdf8", border: "1px solid rgba(0,112,243,0.25)" }}>
                            Port :{detectedPort}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] px-2.5 py-1 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid var(--color-card-border)" }}>
                        Process stopped
                      </span>
                    )}
                    <span className="text-[10px] truncate max-w-xs" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "var(--font-mono)" }}>
                      {activeLogFile}
                    </span>
                  </div>
                </div>
              )}
              {/* Stream the log file — autoOpen, poll-enabled, tall terminal */}
              <TerminalPane projectId={project.id} logFile={activeLogFile} isLive={!!managedPid || !!dockerContainer} detectedPort={detectedPort} effectiveUrl={effectiveUrl} onDiagnose={handleOpenDiagnose} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center ray-card" style={{ background: "var(--color-card)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-card-border)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round">
                  <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
              </div>
              <p className="text-sm font-medium text-white mb-1">No process or container running</p>
              <p className="text-xs max-w-xs mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>Click <strong>Run</strong> in the header to start your project or <strong>AI Troubleshoot</strong> to diagnose startup problems.</p>
              <button
                onClick={() => handleOpenDiagnose()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.8)",
                  border: "1px solid var(--color-card-border)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                  e.currentTarget.style.color = "rgba(255,255,255,0.8)";
                }}
              >
                <SparklesIcon size={12} color="#fff" />
                AI Troubleshoot
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showDiagnose && project && (
        <DiagnosisModal
          projectId={project.id}
          projectName={project.name}
          command={project.runCommand || suggestedCommand || "npm run dev"}
          logs={diagnoseLogs}
          onClose={() => setShowDiagnose(false)}
          onFixed={handleDiagnoseFixed}
        />
      )}

      {showEdit && project && (
        <EditModal
          project={project}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => setProject((p) => p ? { ...p, ...updated } : p)}
        />
      )}
    </div>
  );
}
