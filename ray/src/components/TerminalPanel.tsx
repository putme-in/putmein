"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parsePlanChecklist } from "@/lib/plan-checklist";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import DeploymentNodeGraph, { DeployStepState } from "./DeploymentNodeGraph";
import { StateSpinner } from "./StateSpinner";
import { getPrimaryProjectUrl } from "@/lib/domains";
import { Icon } from "@iconify/react";

/* ── Types ────────────────────────────────────────── */
export interface ToolLine {
  type: "tool-start" | "tool-output" | "tool-end";
  tool?: string;
  cmd?: string;
  delta?: string;
  exit?: number;
  user?: string;
  host?: string;
  id: string;
}

export interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onWidthChange: (w: number) => void;
}

export type ToolTab = "plan" | "terminal" | "deploy" | "monitor";

export interface PlanItem {
  id: string;
  title: string;
  content: string;
  checklist: Array<{ text: string; done: boolean }>;
  status: "pending" | "in_progress" | "completed";
  createdAt: number;
}

type LogEntry =
  | { kind: "cmd"; cmd: string; user: string; host: string; id: string }
  | { kind: "output"; text: string; id: string }
  | { kind: "status"; exit: number; user: string; host: string; id: string };

interface MonitorProjectItem {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  logPaths?: string;
  logCommand?: string;
  runCommand?: string | null;
  status: string;
  enabled: boolean;
  memory?: string | null;
  memoryStatus?: string | null;
  managedPid?: number | null;
  managedLogFile?: string | null;
  _count?: { alerts: number };
}

interface MonitorAlertItem {
  id: string;
  projectId: string;
  severity: "info" | "warn" | "error" | "critical" | "vulnerable";
  message: string;
  rawLog: string;
  dismissed: boolean;
  createdAt: string;
}

interface LogFileResult {
  path: string;
  content?: string;
  error?: string;
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
  containerId?: string | null;
  containerName?: string | null;
  imageName?: string | null;
  hostPort?: number | null;
  status: string;
  buildLogs?: string | null;
  deployUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ──────────────────────────────────────── */
function fmtLoginDate(): string {
  const d = new Date();
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `Last login: ${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} on ttys000`;
}

const severityColor: Record<string, string> = {
  critical: "#ef4444",
  error: "#f97316",
  warn: "#eab308",
  info: "#22c55e",
  vulnerable: "#a855f7",
};

/* ── Component ────────────────────────────────────── */
export default function TerminalPanel({
  isOpen,
  onClose,
  width,
  onWidthChange,
}: TerminalPanelProps) {
  // Always provide all first-class tools: Plan, Terminal, Deploy, and Monitor
  const [activatedTools, setActivatedTools] = useState<ToolTab[]>(["plan", "terminal", "deploy", "monitor"]);
  const [activeTab, setActiveTab] = useState<ToolTab>("terminal");
  const [activePlan, setActivePlan] = useState<PlanItem | null>(null);

  // Terminal state
  const [log, setLog] = useState<LogEntry[]>([]);
  const sysUserRef = useRef("user");
  const sysHostRef = useRef("localhost");
  const [prompt, setPrompt] = useState({ user: "user", host: "localhost" });
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const terminalBottomAnchorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const bannerRef = useRef("");

  // Monitor logs state
  const [projects, setProjects] = useState<MonitorProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [monitorSubTab, setMonitorSubTab] = useState<"logs" | "memory" | "alerts">("logs");
  const [logFiles, setLogFiles] = useState<LogFileResult[]>([]);
  const [selectedLogPath, setSelectedLogPath] = useState<string>("");
  const [monitorLogsLoading, setMonitorLogsLoading] = useState(false);
  const [alerts, setAlerts] = useState<MonitorAlertItem[]>([]);
  const [detectedPort, setDetectedPort] = useState<number | null>(null);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [memory, setMemory] = useState<string | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const [analyzingMemory, setAnalyzingMemory] = useState(false);
  const monitorLogsScrollRef = useRef<HTMLPreElement>(null);

  // Deploy state
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [deploySubTab, setDeploySubTab] = useState<"pipeline" | "list" | "github">("list");
  const [deployLoading, setDeployLoading] = useState(false);
  const [activeDeployStream, setActiveDeployStream] = useState<{
    steps: DeployStepState[];
    buildLogs: string;
    isDeploying: boolean;
    projectName: string;
    deployUrl?: string;
  } | null>(null);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubPat, setGithubPat] = useState("");
  const [githubUser, setGithubUser] = useState<{ username?: string; avatarUrl?: string; webhookSecret?: string; connected: boolean } | null>(null);
  const [githubRepos, setGithubRepos] = useState<{ id: number; name: string; fullName: string; cloneUrl: string; defaultBranch: string }[]>([]);
  const [connectingGh, setConnectingGh] = useState(false);
  const deployLogsScrollRef = useRef<HTMLPreElement>(null);
  const deployListScrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom states
  const [showTerminalScrollBottom, setShowTerminalScrollBottom] = useState(false);
  const [showMonitorScrollBottom, setShowMonitorScrollBottom] = useState(false);
  const [showDeployScrollBottom, setShowDeployScrollBottom] = useState(false);
  const isTerminalUserScrolledUpRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const isMonitorUserScrolledUpRef = useRef(false);
  const isDeployUserScrolledUpRef = useRef(false);

  // AI-managed terminal notice state
  const [showAiNotice, setShowAiNotice] = useState(false);
  const aiNoticeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerAiNotice = useCallback(() => {
    setShowAiNotice(true);
    if (aiNoticeTimeoutRef.current) clearTimeout(aiNoticeTimeoutRef.current);
    aiNoticeTimeoutRef.current = setTimeout(() => setShowAiNotice(false), 2500);
  }, []);

  const handleTerminalKeyDown = useCallback((e: React.KeyboardEvent) => {
    // If copying, selecting all, or refreshing (Cmd+C, Cmd+A, Cmd+R), allow without alert
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    triggerAiNotice();
  }, [triggerAiNotice]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Login banner
  useEffect(() => {
    if (isOpen && !bannerRef.current) {
      bannerRef.current = fmtLoginDate();
    }
    if (!isOpen) bannerRef.current = "";
  }, [isOpen]);

  const getChatKey = useCallback((): string => {
    if (typeof window === "undefined") return "default";
    const path = window.location.pathname;
    if (path.startsWith("/chat/")) {
      return path.split("/")[2] || "default";
    }
    return "default";
  }, []);

  const ALL_TOOLS: ToolTab[] = ["plan", "terminal", "deploy", "monitor"];

  // Restore active tools & tab when chat/session changes
  const restoreTabsForSession = useCallback((sid?: string) => {
    const key = sid || getChatKey();
    try {
      const saved = localStorage.getItem(`ray_tabs_${key}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.activeTab && (ALL_TOOLS as string[]).includes(parsed.activeTab)) {
          setActiveTab(parsed.activeTab);
        }
      }
    } catch { /* ignore */ }
    setActivatedTools(ALL_TOOLS);
  }, [getChatKey]);

  // Load on mount and on route change
  useEffect(() => {
    restoreTabsForSession();
  }, [restoreTabsForSession]);

  // Listen to session switch events
  useEffect(() => {
    const handleSessionSwitch = (e: Event) => {
      const sid = (e as CustomEvent<{ sessionId: string }>).detail?.sessionId;
      restoreTabsForSession(sid);
    };
    window.addEventListener("ray:session-switched", handleSessionSwitch);
    return () => window.removeEventListener("ray:session-switched", handleSessionSwitch);
  }, [restoreTabsForSession]);

  // Listen to live plan update events from chat
  useEffect(() => {
    const handlePlanUpdate = (e: Event) => {
      const detail = (e as CustomEvent<{ title?: string; content?: string; checklist?: string[]; status?: "pending" | "in_progress" | "completed" }>).detail;
      if (!detail) return;
      const parsed = parsePlanChecklist(detail.content || "");
      const items = parsed.length ? parsed.map(item => ({ text: item.text, done: item.completed })) : (detail.checklist || []).map(t => ({ text: t, done: /^\[x\]/i.test(t) }));
      const newPlan: PlanItem = {
        id: Math.random().toString(36).substring(2, 9),
        title: detail.title || "Implementation Plan",
        content: detail.content || "",
        checklist: items,
        status: items.length > 0 && items.every(item => item.done) ? "completed" : detail.status || "pending",
        createdAt: Date.now(),
      };
      setActivePlan(newPlan);
      setActiveTab("plan");
    };
    window.addEventListener("ray:plan-updated", handlePlanUpdate);
    const handleProceedPlan = () => {
      setActivePlan((prev) => (prev ? { ...prev, status: "in_progress" } : null));
    };
    window.addEventListener("ray:proceed-plan", handleProceedPlan);
    return () => {
      window.removeEventListener("ray:plan-updated", handlePlanUpdate);
      window.removeEventListener("ray:proceed-plan", handleProceedPlan);
    };
  }, []);

  const handleProceedWithPlan = () => {
    if (!activePlan || activePlan.status !== "pending") return;
    setActivePlan((prev) => (prev ? { ...prev, status: "in_progress" } : null));
    window.dispatchEvent(
      new CustomEvent("ray:proceed-plan", {
        detail: { title: activePlan.title },
      })
    );
  };

  // Save tabs per session whenever activeTab changes
  const saveTabsForSession = useCallback((tools: ToolTab[], tab: ToolTab) => {
    const key = getChatKey();
    try {
      localStorage.setItem(`ray_tabs_${key}`, JSON.stringify({ activatedTools: tools, activeTab: tab }));
    } catch { /* ignore */ }
  }, [getChatKey]);

  /* ── Activate a tool tab dynamically ── */
  const activateTool = useCallback((tool: ToolTab) => {
    setActiveTab(tool);
    saveTabsForSession(ALL_TOOLS, tool);
  }, [saveTabsForSession]);

  const handleTabChange = useCallback((tool: ToolTab) => {
    setActiveTab(tool);
    saveTabsForSession(ALL_TOOLS, tool);
  }, [saveTabsForSession]);

  /* ── Scroll Handlers & Helpers ── */
  const handleTerminalScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    const el = terminalScrollRef.current;
    if (!el || el.clientHeight <= 0) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 45) {
      isTerminalUserScrolledUpRef.current = true;
      setShowTerminalScrollBottom(true);
    } else if (distanceFromBottom <= 20) {
      isTerminalUserScrolledUpRef.current = false;
      setShowTerminalScrollBottom(false);
    }
  }, []);

  const handleTerminalWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < -2) {
      // Direct user gesture upward
      isTerminalUserScrolledUpRef.current = true;
      setShowTerminalScrollBottom(true);
    }
  }, []);

  const scrollToTerminalBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = terminalScrollRef.current;
    isTerminalUserScrolledUpRef.current = false;
    setShowTerminalScrollBottom(false);
    if (!el) return;

    isAutoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    if (terminalBottomAnchorRef.current) {
      terminalBottomAnchorRef.current.scrollIntoView({ behavior, block: "end" });
    }

    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 60);
      });
    });
  }, []);

  const updateMonitorScrollState = useCallback(() => {
    const el = monitorLogsScrollRef.current;
    if (!el || el.clientHeight <= 0) return;
    if (el.scrollHeight <= el.clientHeight + 15) {
      setShowMonitorScrollBottom(false);
      isMonitorUserScrolledUpRef.current = false;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isScrolledUp = distanceFromBottom > 60;
    setShowMonitorScrollBottom(isScrolledUp);
    isMonitorUserScrolledUpRef.current = isScrolledUp;
  }, []);

  const handleMonitorScroll = useCallback(() => {
    updateMonitorScrollState();
  }, [updateMonitorScrollState]);

  const scrollToMonitorBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    isMonitorUserScrolledUpRef.current = false;
    setShowMonitorScrollBottom(false);
    const el = monitorLogsScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, []);

  const updateDeployScrollState = useCallback(() => {
    const el = deployLogsScrollRef.current || deployListScrollRef.current;
    if (!el || el.clientHeight <= 0) return;
    if (el.scrollHeight <= el.clientHeight + 15) {
      setShowDeployScrollBottom(false);
      isDeployUserScrolledUpRef.current = false;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isScrolledUp = distanceFromBottom > 60;
    setShowDeployScrollBottom(isScrolledUp);
    isDeployUserScrolledUpRef.current = isScrolledUp;
  }, []);

  const handleDeployScroll = useCallback(() => {
    updateDeployScrollState();
  }, [updateDeployScrollState]);

  const scrollToDeployBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    isDeployUserScrolledUpRef.current = false;
    setShowDeployScrollBottom(false);
    const el = deployLogsScrollRef.current || deployListScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, []);

  /* ── Tool event listener (Terminal) ── */
  useEffect(() => {
    let setupEvent = false;
    const handler = (e: Event) => {
      const ev = (e as CustomEvent<ToolLine>).detail;
      if (ev.type === "tool-start") setupEvent = ev.tool === "deployment_setup";
      if (setupEvent) return;
      const uid = `${ev.type}-${Date.now()}-${Math.random()}`;

      if (ev.type === "tool-start") {
        if (ev.user) { sysUserRef.current = ev.user; setPrompt((p) => ({ ...p, user: ev.user! })); }
        if (ev.host) { sysHostRef.current = ev.host; setPrompt((p) => ({ ...p, host: ev.host! })); }

        // New tool starts — reset any scroll-up lock so live output tracks automatically
        isTerminalUserScrolledUpRef.current = false;
        setShowTerminalScrollBottom(false);

        setLog((prev) => [
          ...prev,
          { kind: "cmd", cmd: ev.cmd ?? ev.tool ?? "exec", user: ev.user ?? sysUserRef.current, host: ev.host ?? sysHostRef.current, id: uid },
        ]);
        activateTool("terminal");
        setTimeout(() => scrollToTerminalBottom("auto"), 20);
      } else if (ev.type === "tool-output" && ev.delta) {
        setLog((prev) => [...prev, { kind: "output", text: ev.delta!, id: uid }]);
      } else if (ev.type === "tool-end") {
        setLog((prev) => [
          ...prev,
          { kind: "status", exit: ev.exit ?? 0, user: sysUserRef.current, host: sysHostRef.current, id: uid },
        ]);
      }
    };

    window.addEventListener("ray:tool-event", handler);
    return () => window.removeEventListener("ray:tool-event", handler);
  }, [activateTool, scrollToTerminalBottom]);

  /* ── Clear Terminal ── */
  const handleClearTerminal = () => {
    setLog([]);
    bannerRef.current = "";
    isTerminalUserScrolledUpRef.current = false;
    setShowTerminalScrollBottom(false);
  };

  useEffect(() => {
    window.addEventListener("ray:terminal-clear", handleClearTerminal);
    return () => window.removeEventListener("ray:terminal-clear", handleClearTerminal);
  }, []);

  /* ── Sync Terminal History from Active Session ── */
  useEffect(() => {
    const handleSyncHistory = (e: Event) => {
      const toolBlocks = (e as CustomEvent<{
        toolBlocks: Array<{
          id: string;
          tool: string;
          cmd: string;
          status: string;
          output: string;
          exit?: number;
        }>;
      }>).detail?.toolBlocks;

      if (!toolBlocks || toolBlocks.length === 0) return;

      const newEntries: LogEntry[] = [];
      toolBlocks.filter(b => b.tool !== "deployment_setup").forEach((b, idx) => {
        const uId = b.id || `sync-${idx}-${Date.now()}`;
        newEntries.push({
          kind: "cmd",
          cmd: b.cmd || b.tool || "exec",
          user: sysUserRef.current,
          host: sysHostRef.current,
          id: `${uId}-cmd`,
        });
        if (b.output) {
          newEntries.push({
            kind: "output",
            text: b.output,
            id: `${uId}-out`,
          });
        }
        newEntries.push({
          kind: "status",
          exit: b.exit ?? 0,
          user: sysUserRef.current,
          host: sysHostRef.current,
          id: `${uId}-status`,
        });
      });

      setLog(newEntries);
      isTerminalUserScrolledUpRef.current = false;
      setShowTerminalScrollBottom(false);
      scrollToTerminalBottom("auto");
      setTimeout(() => scrollToTerminalBottom("auto"), 40);
      setTimeout(() => scrollToTerminalBottom("auto"), 120);
      setTimeout(() => scrollToTerminalBottom("auto"), 250);
    };

    window.addEventListener("ray:sync-terminal-history", handleSyncHistory);
    return () => window.removeEventListener("ray:sync-terminal-history", handleSyncHistory);
  }, [scrollToTerminalBottom]);

  /* ── Load Terminal History for Active Session ── */
  useEffect(() => {
    const sid = getChatKey();
    if (!sid || sid === "default") return;

    let cancelled = false;

    // First request from ChatInterface if messages are in memory
    window.dispatchEvent(new CustomEvent("ray:request-terminal-sync"));

    // Also fetch directly from session API to guarantee history availability
    fetch(`/api/sessions/${sid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.session?.messages) return;
        const allBlocks: any[] = [];
        for (const m of data.session.messages) {
          let toolBlocks = undefined;
          const metaMatch = m.content?.match(/^<!-- rayAssistantMeta:([\s\S]*?) -->/);
          if (metaMatch) {
            try {
              const meta = JSON.parse(metaMatch[1]);
              if (Array.isArray(meta.toolBlocks)) toolBlocks = meta.toolBlocks;
            } catch { /* ignore */ }
          }
          if (toolBlocks && toolBlocks.length > 0) {
            allBlocks.push(...toolBlocks);
          }
        }
        if (allBlocks.length > 0 && !cancelled) {
          window.dispatchEvent(
            new CustomEvent("ray:sync-terminal-history", { detail: { toolBlocks: allBlocks } })
          );
        }
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, [getChatKey]);

  /* ── Follow to latest when panel opens or active tab switches ── */
  useEffect(() => {
    if (isOpen) {
      if (activeTab === "terminal") {
        isTerminalUserScrolledUpRef.current = false;
        setShowTerminalScrollBottom(false);
        const scrollBottom = () => {
          scrollToTerminalBottom("auto");
        };
        scrollBottom();
        const t1 = setTimeout(scrollBottom, 50);
        const t2 = setTimeout(scrollBottom, 150);
        const t3 = setTimeout(scrollBottom, 300);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      } else if (activeTab === "monitor") {
        isMonitorUserScrolledUpRef.current = false;
        setShowMonitorScrollBottom(false);
        const scrollBottom = () => {
          scrollToMonitorBottom("auto");
        };
        scrollBottom();
        const t1 = setTimeout(scrollBottom, 50);
        const t2 = setTimeout(scrollBottom, 150);
        const t3 = setTimeout(scrollBottom, 300);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      } else if (activeTab === "deploy") {
        isDeployUserScrolledUpRef.current = false;
        setShowDeployScrollBottom(false);
        const scrollBottom = () => {
          scrollToDeployBottom("auto");
        };
        scrollBottom();
        const t1 = setTimeout(scrollBottom, 50);
        const t2 = setTimeout(scrollBottom, 150);
        const t3 = setTimeout(scrollBottom, 300);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
        };
      }
    }
  }, [isOpen, activeTab, width, scrollToTerminalBottom, scrollToMonitorBottom, scrollToDeployBottom]);

  /* ── Auto-scroll Terminal on Log Updates ─── */
  useEffect(() => {
    if (activeTab === "terminal" && isOpen) {
      const el = terminalScrollRef.current;
      if (!el) return;

      if (!isTerminalUserScrolledUpRef.current) {
        isAutoScrollingRef.current = true;
        el.scrollTop = el.scrollHeight;
        if (terminalBottomAnchorRef.current) {
          terminalBottomAnchorRef.current.scrollIntoView({ behavior: "auto", block: "end" });
        }
        requestAnimationFrame(() => {
          if (!isTerminalUserScrolledUpRef.current && el) {
            el.scrollTop = el.scrollHeight;
          }
          setTimeout(() => {
            isAutoScrollingRef.current = false;
          }, 40);
        });
      } else {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (dist > 45) {
          setShowTerminalScrollBottom(true);
        }
      }
    }
  }, [log, activeTab, isOpen]);

  /* ── ResizeObserver to keep terminal pinned to bottom on container size changes ── */
  useEffect(() => {
    const el = terminalScrollRef.current;
    if (!el || activeTab !== "terminal") return;

    const ro = new ResizeObserver(() => {
      if (!isTerminalUserScrolledUpRef.current && el.clientHeight > 0) {
        el.scrollTop = el.scrollHeight;
      } else if (isTerminalUserScrolledUpRef.current && el.clientHeight > 0) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        setShowTerminalScrollBottom(dist > 45);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab]);



  /* ── Open Monitor Project Event ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string; projectName?: string; subTab?: "logs" | "memory" | "alerts" }>).detail;
      if (detail?.projectId) setSelectedProjectId(detail.projectId);
      if (detail?.subTab) setMonitorSubTab(detail.subTab);
      activateTool("monitor");
    };
    window.addEventListener("ray:open-monitor-project", handler);
    return () => window.removeEventListener("ray:open-monitor-project", handler);
  }, [activateTool]);

  /* ── Fetch Deployments (Auto-sync with active Docker containers) ── */
  const fetchDeployments = useCallback(async () => {
    setDeployLoading(true);
    try {
      const res = await fetch("/api/deployments");
      if (res.ok) {
        const data = await res.json();
        const deps: DeploymentItem[] = data.deployments || [];
        setDeployments(deps);
        if (deps.length > 0 && !selectedDeploymentId) {
          setSelectedDeploymentId(deps[0].id);
        }
      }
    } catch { /* silent */ }
    finally { setDeployLoading(false); }
  }, [selectedDeploymentId]);

  /* ── Open Deploy Event (Manual / Upload) ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; projectPath?: string; sourceType?: string; repoUrl?: string; branch?: string }>).detail;
      activateTool("deploy");
      setDeploySubTab("pipeline");
      if (detail?.name && detail?.projectPath) {
        triggerDeployment({
          name: detail.name,
          projectPath: detail.projectPath,
          sourceType: detail.sourceType,
          repoUrl: detail.repoUrl,
          branch: detail.branch,
        });
      }
    };
    window.addEventListener("ray:open-deploy", handler);
    return () => window.removeEventListener("ray:open-deploy", handler);
  }, [activateTool]);

  /* ── AI Deploy Stream Events from Chat ── */
  useEffect(() => {
    const handleStart = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string; projectPath?: string }>).detail;
      const projectName = detail?.name || "Application";
      setActiveDeployStream({
        projectName,
        steps: [
          { step: "source_check", status: "running", message: `Validating project source for ${projectName}...` },
          { step: "dockerize", status: "pending", message: "Analyzing framework & generating container spec" },
          { step: "building", status: "pending", message: "Building Docker container image & layers" },
          { step: "launching", status: "pending", message: "Allocating host port & launching isolated container" },
          { step: "healthcheck", status: "pending", message: "Verifying container port & HTTP readiness" },
          { step: "monitoring", status: "pending", message: "Registering container into 24/7 log monitor" },
        ],
        buildLogs: "",
        isDeploying: true,
      });
      activateTool("deploy");
      setDeploySubTab("pipeline");
    };

    const handleOutput = (e: Event) => {
      const detail = (e as CustomEvent<{ delta?: string }>).detail;
      const delta = detail?.delta || "";
      if (!delta) return;

      setActiveDeployStream((prev) => {
        if (!prev) return null;
        const newLogs = (prev.buildLogs || "") + delta;
        const updatedSteps = [...prev.steps];

        const setStep = (stepName: string, status: "pending" | "running" | "success" | "error", message?: string, extra?: any) => {
          const idx = updatedSteps.findIndex((s) => s.step === stepName);
          if (idx >= 0) {
            updatedSteps[idx] = { ...updatedSteps[idx], status, message: message || updatedSteps[idx].message, ...extra };
          }
        };

        if (delta.includes("Validating project") || delta.includes("Source verified")) {
          setStep("source_check", delta.includes("verified") ? "success" : "running");
        }
        if (delta.includes("Generating Dockerfile") || delta.includes("Container spec") || delta.includes("Analyzing framework")) {
          setStep("source_check", "success");
          setStep("dockerize", delta.includes("configured") ? "success" : "running");
        }
        if (delta.includes("Building Docker image") || delta.includes("Step ") || delta.includes("Successfully built") || delta.includes("Successfully tagged")) {
          setStep("source_check", "success");
          setStep("dockerize", "success");
          setStep("building", (delta.includes("Successfully built") || delta.includes("Successfully tagged")) ? "success" : "running");
        }
        if (delta.includes("Allocating host port") || delta.includes("starting container") || delta.includes("Container running")) {
          setStep("building", "success");
          setStep("launching", delta.includes("Container running") ? "success" : "running");
        }
        if (delta.includes("Waiting for") || delta.includes("healthcheck") || delta.includes("healthy")) {
          setStep("launching", "success");
          setStep("healthcheck", delta.includes("healthy") ? "success" : "running");
        }
        if (delta.includes("24/7") || delta.includes("monitoring") || delta.includes("successfully deployed")) {
          setStep("healthcheck", "success");
          setStep("monitoring", "success");
        }

        const urlMatch = delta.match(/http:\/\/localhost:\d+/);
        const deployUrl = urlMatch ? urlMatch[0] : prev.deployUrl;

        return {
          ...prev,
          steps: updatedSteps,
          buildLogs: newLogs,
          deployUrl,
        };
      });
    };

    const handleEnd = () => {
      setActiveDeployStream((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          isDeploying: false,
          steps: prev.steps.map((s) => ({ ...s, status: s.status === "running" ? ("success" as const) : s.status })),
        };
      });
      fetchDeployments();
    };

    window.addEventListener("ray:tool-deploy-start", handleStart);
    window.addEventListener("ray:tool-deploy-output", handleOutput);
    window.addEventListener("ray:tool-deploy-end", handleEnd);
    return () => {
      window.removeEventListener("ray:tool-deploy-start", handleStart);
      window.removeEventListener("ray:tool-deploy-output", handleOutput);
      window.removeEventListener("ray:tool-deploy-end", handleEnd);
    };
  }, [activateTool, fetchDeployments]);

  /* ── Fetch GitHub Status & Repos ── */
  const fetchGithubStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/github");
      if (res.ok) {
        const data = await res.json();
        setGithubUser(data);
        if (data.repos) setGithubRepos(data.repos);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === "deploy") {
      fetchDeployments();
      fetchGithubStatus();
    }
  }, [isOpen, activeTab, fetchDeployments, fetchGithubStatus]);

  /* ── Trigger a Deployment ── */
  const triggerDeployment = async (params: {
    name: string;
    projectPath: string;
    sourceType?: string;
    repoUrl?: string;
    branch?: string;
  }) => {
    setActiveDeployStream({
      steps: [
        { step: "source_check", status: "running", message: `Preparing ${params.name}...` },
      ],
      buildLogs: "",
      isDeploying: true,
      projectName: params.name,
    });

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setActiveDeployStream((prev) => ({
          steps: prev ? [...prev.steps, { step: "failed", status: "error", message: errText || "Deployment failed" }] : [],
          buildLogs: errText,
          isDeploying: false,
          projectName: params.name,
        }));
        fetchDeployments();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const ev = JSON.parse(trimmed.slice(6));
              setActiveDeployStream((prev) => {
                const existingSteps = prev ? [...prev.steps] : [];
                const stepIdx = existingSteps.findIndex((s) => s.step === ev.step);
                if (stepIdx >= 0) {
                  existingSteps[stepIdx] = ev;
                } else {
                  existingSteps.push(ev);
                }

                let newLogs = prev?.buildLogs || "";
                if (ev.logDelta) newLogs += ev.logDelta;

                return {
                  steps: existingSteps,
                  buildLogs: newLogs,
                  isDeploying: ev.step !== "complete" && ev.step !== "failed",
                  projectName: params.name,
                  deployUrl: ev.url || prev?.deployUrl,
                };
              });
            } catch { /* silent parse error */ }
          }
        }
      }
    } catch (err) {
      setActiveDeployStream((prev) => ({
        steps: prev ? [...prev.steps, { step: "failed", status: "error", message: (err as Error).message }] : [],
        buildLogs: (err as Error).message,
        isDeploying: false,
        projectName: params.name,
      }));
    } finally {
      fetchDeployments();
    }
  };

  /* ── Connect GitHub PAT ── */
  const handleConnectGithub = async () => {
    if (!githubPat.trim()) return;
    setConnectingGh(true);
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: githubPat }),
      });
      if (res.ok) {
        setShowGithubModal(false);
        setGithubPat("");
        fetchGithubStatus();
      }
    } catch { /* silent */ }
    finally { setConnectingGh(false); }
  };

  /* ── Container Actions (Restart, Stop) ── */
  const handleContainerAction = async (id: string, action: "restart" | "stop") => {
    try {
      const res = await fetch(`/api/deploy/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        fetchDeployments();
      }
    } catch { /* silent */ }
  };

  /* ── Fetch Projects List (Monitor) ── */
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/projects");
      if (res.ok) {
        const data = await res.json();
        const projs: MonitorProjectItem[] = data.projects || [];
        setProjects(projs);
        if (projs.length > 0 && !selectedProjectId) {
          setSelectedProjectId(projs[0].id);
        }
      }
    } catch { /* silent */ }
  }, [selectedProjectId]);

  useEffect(() => {
    if (isOpen && activeTab === "monitor") fetchProjects();
  }, [isOpen, activeTab, fetchProjects]);

  /* ── Fetch Logs & Details for Selected Project ── */
  const fetchProjectLogs = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setMonitorLogsLoading(true);
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/logs?lines=300`);
      if (res.ok) {
        const data = await res.json();
        const logs: LogFileResult[] = data.logs || [];
        setLogFiles(logs);
        if (logs.length > 0 && (!selectedLogPath || !logs.some((l) => l.path === selectedLogPath))) {
          setSelectedLogPath(logs[0].path);
        }
      }
    } catch { /* silent */ }
    finally { setMonitorLogsLoading(false); }
  }, [selectedLogPath]);

  const fetchProjectAlerts = useCallback(async (projectId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/monitor/alerts?projectId=${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchProjectMemory = useCallback(async (projectId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/memory`);
      if (res.ok) {
        const data = await res.json();
        setMemory(data.memory || null);
        setMemoryStatus(data.memoryStatus || "pending");
      }
    } catch { /* silent */ }
  }, []);

  const fetchProjectRunInfo = useCallback(async (projectId: string) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/monitor/projects/${projectId}/run`);
      if (res.ok) {
        const data = await res.json();
        if (data.port) {
          setDetectedPort(data.port);
          setDetectedUrl(data.url || `http://localhost:${data.port}`);
        } else {
          setDetectedPort(null);
          setDetectedUrl(null);
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (selectedProject && isOpen && activeTab === "monitor") {
      fetchProjectLogs(selectedProject.id);
      fetchProjectAlerts(selectedProject.id);
      fetchProjectMemory(selectedProject.id);
      fetchProjectRunInfo(selectedProject.id);
    }
  }, [selectedProject?.id, isOpen, activeTab, fetchProjectLogs, fetchProjectAlerts, fetchProjectMemory, fetchProjectRunInfo]);

  // Live polling for monitor logs if active
  useEffect(() => {
    if (!isOpen || activeTab !== "monitor" || !selectedProject) return;
    const interval = setInterval(() => {
      fetchProjectLogs(selectedProject.id);
      fetchProjectRunInfo(selectedProject.id);
    }, 3000);
    return () => clearInterval(interval);
  }, [isOpen, activeTab, selectedProject?.id, fetchProjectLogs, fetchProjectRunInfo]);

  // Auto-scroll monitor logs
  const activeLogContent = logFiles.find((f) => f.path === selectedLogPath)?.content || "";
  useEffect(() => {
    if (monitorLogsScrollRef.current && !isMonitorUserScrolledUpRef.current) {
      monitorLogsScrollRef.current.scrollTop = monitorLogsScrollRef.current.scrollHeight;
    }
  }, [activeLogContent]);

  // Reset monitor scroll when project or log file changes
  useEffect(() => {
    isMonitorUserScrolledUpRef.current = false;
    setShowMonitorScrollBottom(false);
    setTimeout(() => {
      scrollToMonitorBottom("auto");
    }, 50);
  }, [selectedProjectId, selectedLogPath, scrollToMonitorBottom]);

  // Auto-scroll deploy build logs
  useEffect(() => {
    if (deployLogsScrollRef.current && !isDeployUserScrolledUpRef.current) {
      deployLogsScrollRef.current.scrollTop = deployLogsScrollRef.current.scrollHeight;
    }
  }, [activeDeployStream?.buildLogs]);

  // Trigger memory analysis
  const handleAnalyzeMemory = async () => {
    if (!selectedProject || analyzingMemory) return;
    setAnalyzingMemory(true);
    try {
      const res = await fetch(`/api/monitor/projects/${selectedProject.id}/memory`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setMemory(data.memory || null);
        setMemoryStatus(data.memoryStatus || "done");
      }
    } catch { /* silent */ }
    finally { setAnalyzingMemory(false); }
  };

  /* ── Drag to resize ───────────────────────────── */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startW: width };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startX - ev.clientX;
        onWidthChange(Math.max(320, Math.min(1000, dragRef.current.startW + delta)));
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, onWidthChange]
  );

  /* ── Is a command currently running (terminal) ── */
  const isRunning = (() => {
    let r = false;
    for (const l of log) {
      if (l.kind === "cmd") r = true;
      if (l.kind === "status") r = false;
    }
    return r;
  })();

  /* ── Prompt component ─────────────────────────── */
  const Prompt = ({ u, h, children }: { u: string; h: string; children?: React.ReactNode }) => (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 0 }}>
      <span style={{ color: "#4ade80", fontWeight: 600 }}>{u}@{h}</span>
      <span style={{ color: "rgba(255,255,255,0.4)" }}>&nbsp;~&nbsp;</span>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>%&nbsp;</span>
      {children}
    </span>
  );

  /* ── Render one terminal log entry ────────────── */
  const renderTerminalEntry = (entry: LogEntry, idx: number) => {
    if (entry.kind === "cmd") {
      return (
        <div key={entry.id} style={{ marginTop: idx === 0 ? 6 : 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            <Prompt u={entry.user} h={entry.host}>
              <span style={{ color: "#e2e8f0", wordBreak: "break-all" }}>{entry.cmd}</span>
            </Prompt>
          </div>
        </div>
      );
    }

    if (entry.kind === "output") {
      return (
        <div key={entry.id} style={{ marginTop: 1 }}>
          {entry.text.split("\n").map((line, i) => (
            <div
              key={i}
              style={{
                color: /^(error|err:|fatal|permission denied)/i.test(line.trim())
                  ? "#f87171"
                  : "rgba(215,224,233,0.85)",
                minHeight: line === "" ? "0.65em" : undefined,
                wordBreak: "break-all",
              }}
            >
              {line || "\u00a0"}
            </div>
          ))}
        </div>
      );
    }

    if (entry.kind === "status") {
      return (
        <div key={entry.id} style={{ marginTop: 4 }}>
          {entry.exit === 0 ? (
            <Prompt u={entry.user} h={entry.host} />
          ) : (
            <span style={{ color: "#f87171", fontSize: "11px" }}>exit {entry.exit}</span>
          )}
        </div>
      );
    }

    return null;
  };

  const effectiveUrl = detectedUrl || selectedProject?.projectUrl || null;

  /* ── Panel UI ─────────────────────────────────── */
  const panel = (
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden relative"
      style={{
        background: "#0c0c0c",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Dynamic Header: Always render all 3 first-class tabs (Terminal, Deployments, Monitor Logs) */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.07)", background: "#080808" }}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(["plan", "terminal", "deploy", "monitor"] as ToolTab[]).map((tool) => (
            <button
              key={tool}
              onClick={() => handleTabChange(tool)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all cursor-pointer font-sans"
              style={{
                background: activeTab === tool ? "rgba(255,255,255,0.08)" : "transparent",
                color: activeTab === tool ? "#ffffff" : "rgba(255,255,255,0.4)",
                border: activeTab === tool ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
              }}
            >
              {tool === "plan" && (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                  <span>Plan</span>
                  {activePlan && activePlan.status === "pending" && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </>
              )}
              {tool === "terminal" && (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  <span>Terminal</span>
                  {isRunning && <StateSpinner color="emerald" size="xs" />}
                </>
              )}
              {tool === "deploy" && (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                  </svg>
                  <span>Deployments</span>
                  {activeDeployStream?.isDeploying && <StateSpinner color="amber" size="xs" />}
                </>
              )}
              {tool === "monitor" && (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <span>Monitor Logs</span>
                  {projects.some((p) => p.status === "active") && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  )}
                </>
              )}
            </button>
          ))}
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2 font-sans">
          {activeTab === "terminal" && (
            <button
              onClick={handleClearTerminal}
              className="text-xs font-semibold px-2 py-1 rounded transition-colors text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
              title="Clear terminal output"
            >
              Clear
            </button>
          )}

          {activeTab === "monitor" && selectedProject && (
            <button
              onClick={() => {
                fetchProjectLogs(selectedProject.id);
                fetchProjectAlerts(selectedProject.id);
                fetchProjectRunInfo(selectedProject.id);
              }}
              className="text-xs font-semibold px-2 py-1 rounded transition-colors text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
              title="Refresh project logs"
            >
              ↻ Refresh
            </button>
          )}

          {activeTab === "deploy" && (
            <button
              onClick={() => fetchDeployments()}
              className="text-xs font-semibold px-2 py-1 rounded transition-colors text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
              title="Refresh deployments"
            >
              ↻ Refresh
            </button>
          )}

          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors text-white/30 hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close panel"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Tab 0: Plan View ── */}
      {activeTab === "plan" && (
        <div className="flex-1 min-h-0 flex flex-col p-4 bg-[#0c0c0c] overflow-y-auto space-y-4 font-sans">
          {activePlan ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between pb-3.5 border-b border-white/[0.06] gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-bold text-white tracking-tight truncate">{activePlan.title}</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono font-medium ${
                        activePlan.status === "pending"
                          ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      }`}
                    >
                      {activePlan.status === "pending" ? "Awaiting Approval" : activePlan.status === "completed" ? "Completed" : "In Progress"}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-white/40 leading-relaxed">
                    Review proposed steps and checklist before executing actions.
                  </p>
                </div>

                {activePlan.status === "pending" ? (
                  <button
                    type="button"
                    onClick={handleProceedWithPlan}
                    className="ray-btn-primary px-3.5 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer shrink-0 shadow-sm"
                  >
                    <Icon icon="lucide:play" width={12} height={12} className="fill-current" />
                    <span>Proceed with Plan</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono shrink-0 select-none">
                    <Icon icon="lucide:check" width={12} height={12} className="stroke-[2.5]" />
                    <span>Plan Approved</span>
                  </div>
                )}
              </div>

              {/* Checklist */}
              {activePlan.checklist.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold text-white/50 uppercase font-mono tracking-wider">Plan Checklist</h4>
                    <span className="text-[10px] font-mono text-white/40">
                      {activePlan.checklist.filter((i) => i.done).length} of {activePlan.checklist.length} done
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {activePlan.checklist.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setActivePlan((prev) => {
                            if (!prev) return null;
                            const updated = [...prev.checklist];
                            updated[idx] = { ...updated[idx], done: !updated[idx].done };
                            return { ...prev, checklist: updated };
                          });
                        }}
                        className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[#080808] hover:bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer select-none group"
                      >
                        <div
                          className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center border transition-all ${
                            item.done
                              ? "bg-white border-white text-black"
                              : "border-white/30 bg-white/[0.02] group-hover:border-white/50"
                          }`}
                        >
                          {item.done && (
                            <Icon icon="lucide:check" width={11} height={11} className="stroke-[3]" />
                          )}
                        </div>
                        <span className={`text-xs leading-relaxed transition-colors ${item.done ? "text-white/40 line-through" : "text-white/90"}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Plan Details */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold text-white/50 uppercase font-mono tracking-wider">Plan Details</h4>
                  <button
                    type="button"
                    onClick={() => {
                      if (activePlan.content) {
                        navigator.clipboard.writeText(activePlan.content);
                      }
                    }}
                    className="ray-btn-ghost text-[10.5px] font-mono px-2 py-0.5"
                  >
                    Copy
                  </button>
                </div>
                <div className="p-3.5 rounded-xl bg-[#080808] border border-white/[0.06] text-sm text-white/70 leading-relaxed [&_h3]:text-white [&_h3]:font-semibold [&_h3]:mt-5 [&_p]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:pl-5 [&_ol]:list-decimal [&_code]:bg-white/5 [&_code]:px-1 [&_pre]:overflow-x-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activePlan.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-white/30 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-white/30">
                <Icon icon="lucide:clipboard-list" width={22} height={22} />
              </div>
              <div>
                <p className="text-xs font-semibold text-white/60 mb-0.5">No Active Plan</p>
                <p className="text-[11.5px] text-white/40 max-w-xs leading-relaxed">
                  When you ask the AI to build or deploy in Plan Mode, the structured plan, checklists, and goals will appear here for review.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 1: Terminal View ── */}
      {activeTab === "terminal" && (
        <div
          tabIndex={0}
          onKeyDown={handleTerminalKeyDown}
          onClick={triggerAiNotice}
          className="flex-1 min-h-0 flex flex-col relative overflow-hidden bg-[#0c0c0c] outline-none cursor-default"
        >
          <div
            ref={terminalScrollRef}
            onScroll={handleTerminalScroll}
            onWheel={handleTerminalWheel}
            className="flex-1 min-h-0 overflow-y-auto"
            style={{
              padding: "12px 16px 24px",
              fontFamily: "var(--font-mono, 'Menlo', 'Monaco', monospace)",
              fontSize: "12.5px",
              lineHeight: "1.6",
            }}
          >
            {/* AI Managed Execution Banner */}
            <div className="mb-3.5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between gap-3 text-xs select-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-md bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/80 shrink-0">
                  <Icon icon="lucide:bot" width={13} height={13} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-white/90 text-[11.5px] flex items-center gap-1.5 font-sans">
                    <span>AI Agent Execution Stream</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <p className="text-[10.5px] text-white/40 truncate font-sans">
                    This terminal is used exclusively by the AI Agent for command execution.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.04] border border-white/10 text-white/50 shrink-0">
                AI Managed
              </span>
            </div>

            {bannerRef.current && (
              <div style={{ color: "rgba(255,255,255,0.35)", marginBottom: 2 }}>
                {bannerRef.current}
              </div>
            )}

            {log.length === 0 && (
              <div className="flex items-center gap-1">
                <Prompt u={prompt.user} h={prompt.host} />
                <span className="text-white/30 italic text-[11px] select-none ml-1">
                  [This terminal is used by AI — enter prompt in chat]
                </span>
              </div>
            )}

            {log.map((entry, idx) => renderTerminalEntry(entry, idx))}

            {isRunning && (
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: "0.85em",
                  background: "rgba(255,255,255,0.65)",
                  animation: "blink 1.1s step-end infinite",
                  verticalAlign: "middle",
                  borderRadius: 1,
                  marginLeft: 2,
                }}
              />
            )}
            <div ref={terminalBottomAnchorRef} style={{ height: 1, minHeight: 1 }} />
          </div>

          {/* Toast Notification when user tries to type in AI terminal */}
          {showAiNotice && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 animate-fade-in pointer-events-none">
              <div className="px-3.5 py-2 rounded-xl bg-[#141414] border border-white/20 text-white shadow-2xl flex items-center gap-2 text-xs font-sans">
                <Icon icon="lucide:bot" width={14} height={14} className="text-white/80 shrink-0" />
                <span>This terminal is used by AI. Please type your requests in the chat.</span>
              </div>
            </div>
          )}

          {/* Floating Scroll to Bottom Arrow Button for Terminal */}
          {showTerminalScrollBottom && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-fade-in pointer-events-auto">
              <button
                type="button"
                onClick={() => scrollToTerminalBottom("smooth")}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#181818]/95 hover:bg-[#262626] text-white border border-white/20 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer group select-none"
                title="Scroll to live feed"
                aria-label="Scroll to live feed"
              >
                {isRunning ? (
                  <StateSpinner color="emerald" size="xs" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />
                )}
                <span className="text-[11px] font-semibold tracking-tight text-white/90 group-hover:text-white font-sans">
                  {isRunning ? "Live Output" : "Scroll to Bottom"}
                </span>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="group-hover:translate-y-0.5 transition-transform text-white/90"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Monitor Logs View ── */}
      {activeTab === "monitor" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#0a0a0a] font-sans">
          {/* Project Selector Bar */}
          <div className="px-3 py-2.5 border-b border-white/[0.06] bg-[#080808] flex items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider flex-shrink-0 font-sans">Project:</span>
              <select
                value={selectedProject?.id || ""}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="bg-[#121212] text-xs font-semibold text-white px-2.5 py-1 rounded-lg border border-white/10 outline-none truncate flex-1 cursor-pointer hover:border-white/20 transition-colors font-sans"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#111] text-white">
                    {p.name} {p.status === "active" ? "● (Active)" : ""}
                  </option>
                ))}
                {projects.length === 0 && (
                  <option value="" disabled>No projects monitored</option>
                )}
              </select>
            </div>

            {selectedProject && (
              <Link
                href={`/monitor/${selectedProject.id}`}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-all flex items-center gap-1 flex-shrink-0 no-underline font-sans"
              >
                Open Monitor ↗
              </Link>
            )}
          </div>

          {selectedProject ? (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {/* Project Status Summary Strip */}
              <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-[#0a0a0a] flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-xs text-white tracking-tight truncate font-sans">{selectedProject.name}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider font-sans"
                    style={{
                      background: selectedProject.status === "active" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)",
                      color: selectedProject.status === "active" ? "#22c55e" : "rgba(255,255,255,0.5)",
                      border: `1px solid ${selectedProject.status === "active" ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.1)"}`,
                    }}
                  >
                    {selectedProject.status}
                  </span>
                  {detectedPort && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-sky-300 bg-sky-500/15 border border-sky-500/30">
                      :{detectedPort}
                    </span>
                  )}
                </div>

                {effectiveUrl && (
                  <a
                    href={effectiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-emerald-400 hover:text-white px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 transition-colors no-underline flex items-center gap-1 font-sans"
                  >
                    Open URL ↗
                  </a>
                )}
              </div>

              {/* Sub-tabs inside Monitor Logs */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] bg-[#080808] flex-shrink-0">
                <div className="flex items-center gap-1 font-sans">
                  <button
                    onClick={() => setMonitorSubTab("logs")}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      color: monitorSubTab === "logs" ? "#fff" : "rgba(255,255,255,0.4)",
                      background: monitorSubTab === "logs" ? "rgba(255,255,255,0.08)" : "transparent",
                    }}
                  >
                    Live Logs
                  </button>
                  <button
                    onClick={() => setMonitorSubTab("memory")}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      color: monitorSubTab === "memory" ? "#fff" : "rgba(255,255,255,0.4)",
                      background: monitorSubTab === "memory" ? "rgba(255,255,255,0.08)" : "transparent",
                    }}
                  >
                    Memory
                  </button>
                  <button
                    onClick={() => setMonitorSubTab("alerts")}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5"
                    style={{
                      color: monitorSubTab === "alerts" ? "#fff" : "rgba(255,255,255,0.4)",
                      background: monitorSubTab === "alerts" ? "rgba(255,255,255,0.08)" : "transparent",
                    }}
                  >
                    Alerts
                    {alerts.length > 0 && (
                      <span className="text-[10px] font-bold px-1.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                        {alerts.length}
                      </span>
                    )}
                  </button>
                </div>

                {monitorSubTab === "logs" && logFiles.length > 1 && (
                  <select
                    value={selectedLogPath}
                    onChange={(e) => setSelectedLogPath(e.target.value)}
                    className="bg-[#121212] text-[11px] font-sans font-medium text-white/70 px-2 py-0.5 rounded-md border border-white/10 outline-none max-w-[140px] truncate"
                  >
                    {logFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path.split("/").pop() || f.path}
                      </option>
                    ))}
                  </select>
                )}

                {monitorSubTab === "memory" && (
                  <button
                    onClick={handleAnalyzeMemory}
                    disabled={analyzingMemory}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition-colors font-sans cursor-pointer"
                  >
                    {analyzingMemory ? "Analyzing…" : "Re-analyze"}
                  </button>
                )}
              </div>

              {/* Sub-tab 1: Logs Content */}
              {monitorSubTab === "logs" && (
                <div className="flex-1 min-h-0 flex flex-col bg-[#030303] overflow-hidden relative">
                  {monitorLogsLoading && !activeLogContent ? (
                    <div className="flex items-center justify-center py-16 text-white/30 text-xs gap-2 font-sans">
                      <span>Loading logs…</span>
                    </div>
                  ) : !activeLogContent ? (
                    <div className="p-6 text-center text-xs text-white/30 font-sans">
                      No logs available yet for this project.
                    </div>
                  ) : (
                    <>
                      <pre
                        ref={monitorLogsScrollRef}
                        onScroll={handleMonitorScroll}
                        className="flex-1 overflow-auto p-3 text-[12px] leading-[1.55] m-0"
                        style={{
                          fontFamily: "var(--font-mono, 'Menlo', monospace)",
                          color: "rgba(255,255,255,0.8)",
                        }}
                      >
                        {activeLogContent}
                      </pre>

                      {/* Floating Scroll to Bottom Arrow Button for Monitor Logs */}
                      {showMonitorScrollBottom && (
                        <div className="absolute bottom-4 right-4 z-40 animate-fade-in pointer-events-auto">
                          <button
                            onClick={() => scrollToMonitorBottom("smooth")}
                            className="w-9 h-9 rounded-full flex items-center justify-center bg-[#181818]/95 hover:bg-[#252525] text-white border border-white/20 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer group"
                            title="Scroll to live logs"
                            aria-label="Scroll to live logs"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="group-hover:translate-y-0.5 transition-transform text-white/90"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Sub-tab 2: Memory View */}
              {monitorSubTab === "memory" && (
                <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-[#080808] text-xs text-white/80 leading-relaxed font-sans font-medium whitespace-pre-wrap">
                  {memory || "No AI memory generated for this project yet."}
                </div>
              )}

              {/* Sub-tab 3: Alerts View */}
              {monitorSubTab === "alerts" && (
                <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2 bg-[#080808] font-sans">
                  {alerts.length === 0 ? (
                    <div className="text-center py-12 text-xs text-white/30 font-medium">
                      ✓ No active alerts detected for this project.
                    </div>
                  ) : (
                    alerts.map((a) => (
                      <div
                        key={a.id}
                        className="p-2.5 rounded-xl border flex flex-col gap-1 bg-[#0c0c0c]"
                        style={{ borderColor: `${severityColor[a.severity]}25` }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded font-sans"
                            style={{ color: severityColor[a.severity], background: `${severityColor[a.severity]}15` }}
                          >
                            {a.severity}
                          </span>
                          <span className="text-[10px] text-white/30 font-sans">{new Date(a.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-xs text-white/90 font-medium font-sans">{a.message}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 p-6 text-center text-white/35 text-xs font-sans">
              <p className="mb-3 font-medium">No monitored projects available.</p>
              <Link href="/monitor" className="ray-btn-primary text-xs px-3 py-1.5 no-underline font-bold">
                Add Project to Monitor
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 3: Visual Deploy View ── */}
      {activeTab === "deploy" && (() => {
        const currentDeployment = deployments.find((d) => d.id === selectedDeploymentId) || (activeDeployStream ? null : (deployments.length > 0 ? deployments[0] : null));
        const currentProjectName = activeDeployStream?.projectName || currentDeployment?.name || (deployments.length > 0 ? deployments[0].name : "Application");
        const currentSteps: DeployStepState[] = activeDeployStream?.steps || (currentDeployment ? [
          { step: "source_check", status: "success", message: `Source verified from ${currentDeployment.sourceType || "workspace"}` },
          { step: "dockerize", status: "success", message: `Container spec active (${currentDeployment.imageName || currentDeployment.name})` },
          { step: "building", status: "success", message: `Docker image compiled & tagged` },
          { step: "launching", status: "success", message: `Container ${currentDeployment.containerName || currentDeployment.name} running` },
          { step: "healthcheck", status: currentDeployment.status === "healthy" ? "success" : "pending", message: currentDeployment.hostPort ? `Healthcheck OK (port :${currentDeployment.hostPort})` : "Port binding active" },
          { step: "monitoring", status: currentDeployment.status === "healthy" ? "success" : "pending", message: "Live logging & metrics stream active" }
        ] : []);

        return (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#0a0a0a] font-sans">
            {/* Deploy Subtabs Bar */}
            <div className="px-3.5 py-2 border-b border-white/[0.06] bg-[#080808] flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-1 font-sans">
                <button
                  onClick={() => setDeploySubTab("pipeline")}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer font-sans"
                  style={{
                    background: deploySubTab === "pipeline" ? "rgba(255,255,255,0.08)" : "transparent",
                    color: deploySubTab === "pipeline" ? "#ffffff" : "rgba(255,255,255,0.4)",
                    border: deploySubTab === "pipeline" ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                  }}
                >
                  <span>Pipeline Flow</span>
                  {activeDeployStream?.isDeploying && (
                    <StateSpinner color="amber" size="xs" />
                  )}
                </button>

                <button
                  onClick={() => setDeploySubTab("list")}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer font-sans"
                  style={{
                    background: deploySubTab === "list" ? "rgba(255,255,255,0.08)" : "transparent",
                    color: deploySubTab === "list" ? "#ffffff" : "rgba(255,255,255,0.4)",
                    border: deploySubTab === "list" ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                  }}
                >
                  <span>Containers</span>
                  <span className="text-[10px] opacity-60">({deployments.length})</span>
                </button>

                <button
                  onClick={() => setDeploySubTab("github")}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer font-sans"
                  style={{
                    background: deploySubTab === "github" ? "rgba(255,255,255,0.08)" : "transparent",
                    color: deploySubTab === "github" ? "#ffffff" : "rgba(255,255,255,0.4)",
                    border: deploySubTab === "github" ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>GitHub</span>
                  {githubUser?.connected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </button>
              </div>

              {/* Top right quick selector for multiple containers */}
              <div className="flex items-center gap-1.5">
                {deploySubTab === "pipeline" && deployments.length > 1 && (
                  <select
                    value={currentDeployment?.id || ""}
                    onChange={(e) => setSelectedDeploymentId(e.target.value)}
                    className="bg-[#141414] text-xs font-semibold text-white/80 px-2.5 py-1 rounded-lg border border-white/10 outline-none cursor-pointer max-w-[130px] truncate font-sans"
                  >
                    {deployments.map((d) => (
                      <option key={d.id} value={d.id} className="bg-[#111] text-white">
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* SubTab 1: Node-Based Pipeline Flow */}
            {deploySubTab === "pipeline" && (
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {activeDeployStream || currentDeployment ? (
                  <DeploymentNodeGraph
                    projectName={currentProjectName}
                    steps={currentSteps}
                    isDeploying={activeDeployStream?.isDeploying || false}
                    deployUrl={activeDeployStream?.deployUrl || currentDeployment?.deployUrl}
                    hostPort={currentDeployment?.hostPort}
                    containerName={currentDeployment?.containerName}
                    buildLogs={activeDeployStream?.buildLogs || currentDeployment?.buildLogs}
                    onRestart={currentDeployment ? () => handleContainerAction(currentDeployment.id, "restart") : undefined}
                    onViewLogs={() => setDeploySubTab("list")}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 p-6 text-center text-white/35 text-xs font-sans">
                    <p className="mb-2 text-white/70 font-bold text-sm">No active deployment</p>
                    <p className="max-w-xs mb-4 text-white/40 leading-relaxed font-medium">
                      Select a running container from the Containers tab or start a deployment in chat to view its live pipeline flow.
                    </p>
                    <button
                      onClick={() => setDeploySubTab("list")}
                      className="ray-btn-primary text-xs px-3.5 py-1.5 cursor-pointer font-bold"
                    >
                      View Containers List
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SubTab 2: Containers & Deployments List */}
            {deploySubTab === "list" && (
              <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden font-sans">
                <div
                  ref={deployListScrollRef}
                  onScroll={handleDeployScroll}
                  className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-2.5"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white/50 uppercase tracking-wider font-sans">
                      Active Containers ({deployments.length})
                    </span>
                  </div>

                  {deployLoading && deployments.length === 0 ? (
                    <div className="text-center py-12 text-xs text-white/30 font-sans">Loading deployments…</div>
                  ) : deployments.length === 0 ? (
                    <div className="text-center py-12 text-white/35 text-xs flex flex-col items-center font-sans">
                      <p className="mb-2 font-semibold">No applications deployed yet.</p>
                      <p className="text-[11px] text-white/30 max-w-xs mb-3 font-medium">
                        Deploy projects via chat or GitHub to see node pipeline and real-time container metrics.
                      </p>
                      <button
                        onClick={() => setDeploySubTab("github")}
                        className="ray-btn-primary text-xs px-3 py-1.5 cursor-pointer font-bold"
                      >
                        Deploy from GitHub
                      </button>
                    </div>
                  ) : (
                    deployments.map((dep) => (
                      <div
                        key={dep.id}
                        onClick={() => {
                          setSelectedDeploymentId(dep.id);
                          setDeploySubTab("pipeline");
                        }}
                        className="p-3.5 rounded-2xl border border-white/[0.08] bg-[#0c0c0c] flex flex-col gap-2.5 transition-all hover:border-white/25 cursor-pointer group hover:bg-[#111111]"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-xs text-white truncate font-sans">{dep.name}</span>
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider font-sans"
                              style={{
                                background: dep.status === "healthy" ? "rgba(34,197,94,0.12)" : dep.status === "building" ? "rgba(234,179,8,0.12)" : "rgba(255,255,255,0.06)",
                                color: dep.status === "healthy" ? "#22c55e" : dep.status === "building" ? "#eab308" : "rgba(255,255,255,0.4)",
                                border: `1px solid ${dep.status === "healthy" ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.1)"}`,
                              }}
                            >
                              {dep.status}
                            </span>
                            {dep.hostPort && (
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded text-sky-300 bg-sky-500/15 border border-sky-500/30">
                                :{dep.hostPort}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {dep.deployUrl && (
                              <a
                                href={getPrimaryProjectUrl(dep.deployUrl, dep.hostPort) || dep.deployUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 rounded-lg bg-white text-black hover:bg-white/90 transition-colors no-underline font-bold"
                              >
                                Open ↗
                              </a>
                            )}
                            <button
                              onClick={() => handleContainerAction(dep.id, "restart")}
                              title="Restart container"
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer border border-white/10"
                            >
                              Restart
                            </button>
                          </div>
                        </div>

                        <div className="text-[11px] text-white/40 font-sans flex items-center justify-between font-medium">
                          <span className="truncate">{dep.containerName || dep.projectPath}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-white/40 group-hover:text-white transition-colors font-semibold">View Flow →</span>
                            <span>{new Date(dep.updatedAt).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Floating Scroll to Bottom Arrow for Deployments */}
                {showDeployScrollBottom && (
                  <div className="absolute bottom-4 right-4 z-40 animate-fade-in pointer-events-auto">
                    <button
                      onClick={() => scrollToDeployBottom("smooth")}
                      className="w-9 h-9 rounded-full flex items-center justify-center bg-[#181818]/95 hover:bg-[#252525] text-white border border-white/20 shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer group"
                      title="Scroll to latest container"
                      aria-label="Scroll to latest container"
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="group-hover:translate-y-0.5 transition-transform text-white/90"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SubTab 3: GitHub Repositories */}
            {deploySubTab === "github" && (
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3 font-sans">
                <div className="p-3.5 rounded-2xl border border-white/[0.08] bg-[#0c0c0c] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-white">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <div>
                      <div className="text-xs font-bold text-white font-sans">
                        {githubUser?.connected ? `@${githubUser.username}` : "GitHub Not Connected"}
                      </div>
                      <div className="text-[11px] text-white/40 font-medium font-sans">
                        {githubUser?.connected ? "Automated CI/CD enabled" : "Link PAT to deploy repos"}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowGithubModal(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white text-white hover:text-black transition-all cursor-pointer font-sans"
                  >
                    {githubUser?.connected ? "Settings" : "Link GitHub PAT"}
                  </button>
                </div>

                {githubUser?.connected && githubRepos.length > 0 ? (
                  <div className="flex flex-col gap-2 font-sans">
                    <span className="text-xs font-bold text-white/50 uppercase tracking-wider font-sans">
                      Available Repositories ({githubRepos.length})
                    </span>
                    {githubRepos.map((r) => (
                      <div key={r.id} className="p-3 rounded-2xl border border-white/[0.06] bg-[#0c0c0c] flex items-center justify-between hover:border-white/18 transition-colors">
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="text-xs font-bold text-white truncate font-sans">{r.name}</div>
                          <div className="text-[11px] text-white/40 truncate font-sans font-medium">{r.fullName} ({r.defaultBranch})</div>
                        </div>
                        <button
                          onClick={() => {
                            setDeploySubTab("pipeline");
                            triggerDeployment({ name: r.name, projectPath: "", sourceType: "github", repoUrl: r.cloneUrl, branch: r.defaultBranch });
                          }}
                          className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all flex-shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          Deploy
                        </button>
                      </div>
                    ))}
                  </div>
                ) : githubUser?.connected ? (
                  <div className="text-center py-8 text-xs text-white/35 font-sans">
                    No repositories found for this account.
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl border border-white/[0.06] bg-[#0c0c0c] text-center text-xs text-white/40 font-sans leading-relaxed">
                    Connect your GitHub account with a Personal Access Token to list and deploy repositories directly into Docker containers.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* GitHub PAT Modal */}
      {showGithubModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
        >
          <div className="ray-card w-full max-w-md p-6 flex flex-col gap-4 border border-white/10 bg-[#0c0c0c] rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Link GitHub Account</h3>
              <button
                onClick={() => setShowGithubModal(false)}
                className="text-white/40 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-white/60 leading-relaxed">
              Enter your GitHub Personal Access Token (PAT) with <code className="text-white bg-white/10 px-1 py-0.5 rounded">repo</code> scope to list repos and enable automatic redeployment on git push.
            </p>

            <input
              type="password"
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 text-xs rounded-lg bg-[#141414] border border-white/10 text-white outline-none font-mono"
            />

            {githubUser?.connected && (
              <div className="p-3 rounded-lg bg-black/40 border border-white/5 text-[11px] text-white/60 flex flex-col gap-1">
                <span className="font-semibold text-white">Webhook Secret:</span>
                <span className="font-mono text-[10px] text-emerald-400 select-all break-all">{githubUser.webhookSecret}</span>
                <span className="text-[10px] text-white/40 mt-1">Payload URL: <code className="text-white/60">http://your-domain/api/webhooks/github</code></span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => setShowGithubModal(false)}
                className="ray-btn-ghost text-xs px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleConnectGithub}
                disabled={connectingGh || !githubPat.trim()}
                className="ray-btn-primary text-xs px-4 py-1.5"
              >
                {connectingGh ? "Verifying…" : "Save & Connect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop View — rendered only on desktop screens */}
      {!isMobile && (
        <div
          className="hidden lg:flex flex-col flex-shrink-0 relative h-full min-h-0 overflow-hidden"
          style={{
            width: isOpen ? width : 0,
            minWidth: 0,
            flexShrink: 0,
            transition: isOpen ? "none" : "width 200ms ease",
          }}
          aria-hidden={!isOpen}
        >
          {/* Drag handle */}
          {isOpen && (
            <div
              onMouseDown={handleDragStart}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                cursor: "col-resize",
                zIndex: 20,
                transition: "background 120ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            />
          )}
          <div className="h-full min-h-0 flex flex-col overflow-hidden" style={{ width: width || 420, flexShrink: 0 }}>
            {panel}
          </div>
        </div>
      )}

      {/* Mobile View — rendered only on mobile screens when open */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
        >
          <div
            className="absolute right-0 top-0 bottom-0 flex flex-col overflow-hidden"
            style={{ width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            {panel}
          </div>
        </div>
      )}
    </>
  );
}
