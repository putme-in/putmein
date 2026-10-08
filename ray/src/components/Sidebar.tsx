"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { StateSpinner } from "./StateSpinner";

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Dashboard",
    matchPrefix: "/dashboard",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Chat",
    matchPrefix: "/chat",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    matchPrefix: "/projects",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/containers",
    label: "Containers",
    matchPrefix: "/containers",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    href: "/deployments",
    label: "Deployments",
    matchPrefix: "/deployments",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    href: "/cicd",
    label: "CI/CD",
    matchPrefix: "/cicd",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: "/security",
    label: "Security",
    matchPrefix: "/security",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    href: "/github",
    label: "Git",
    matchPrefix: "/github",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    ),
  },
  {
    href: "/incidents",
    label: "Incidents",
    matchPrefix: "/incidents",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18.6A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.4L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg>,
  },
  {
    href: "/monitor",
    label: "Monitor",
    matchPrefix: "/monitor",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: "/servers",
    label: "Servers",
    matchPrefix: "/servers",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
  },
  {
    href: "/terminal",
    label: "Terminal",
    matchPrefix: "/terminal",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    matchPrefix: "/settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

interface Session {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  createdAt?: string;
  _count: { messages: number };
}

interface TimelineGroup {
  label: string;
  sessions: Session[];
}

function groupSessionsByTimeline(sessions: Session[]): TimelineGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - oneDayMs;
  const sevenDaysAgo = startOfToday - 6 * oneDayMs;
  const thirtyDaysAgo = startOfToday - 29 * oneDayMs;

  const today: Session[] = [];
  const yesterday: Session[] = [];
  const past7Days: Session[] = [];
  const past30Days: Session[] = [];
  const olderByMonth: Record<string, Session[]> = {};

  for (const s of sessions) {
    const time = new Date(s.updatedAt || s.createdAt || Date.now()).getTime();
    if (time >= startOfToday) {
      today.push(s);
    } else if (time >= startOfYesterday) {
      yesterday.push(s);
    } else if (time >= sevenDaysAgo) {
      past7Days.push(s);
    } else if (time >= thirtyDaysAgo) {
      past30Days.push(s);
    } else {
      const d = new Date(time);
      const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!olderByMonth[yearMonth]) {
        olderByMonth[yearMonth] = [];
      }
      olderByMonth[yearMonth].push(s);
    }
  }

  const groups: TimelineGroup[] = [];
  if (today.length > 0) groups.push({ label: "Today", sessions: today });
  if (yesterday.length > 0) groups.push({ label: "Yesterday", sessions: yesterday });
  if (past7Days.length > 0) groups.push({ label: "7 Days", sessions: past7Days });
  if (past30Days.length > 0) groups.push({ label: "30 days", sessions: past30Days });

  const sortedMonths = Object.keys(olderByMonth).sort((a, b) => b.localeCompare(a));
  for (const ym of sortedMonths) {
    groups.push({ label: ym, sessions: olderByMonth[ym] });
  }

  return groups;
}

interface SidebarProps {
  user: { name: string; email: string; role: string };
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ user, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [monitorAlertCount, setMonitorAlertCount] = useState(0);
  const [monitorHasCritical, setMonitorHasCritical] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Search & Multi-select states
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isChatHistoryFull, setIsChatHistoryFull] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Background chat run tracking
  const [chatRuns, setChatRuns] = useState<Record<string, { status: "running" | "completed" | "error"; startedAt: number; completedAt?: number }>>({});
  const [completedShowUntil, setCompletedShowUntil] = useState<Record<string, number>>({});

  const isOnChat = pathname.startsWith("/chat");

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Restore collapsed state from localStorage on mount safely
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ray:sidebar-collapsed");
      if (saved !== null) {
        setIsCollapsed(saved === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ray:sidebar-collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl+B to collapse, Cmd/Ctrl+K or / to search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B" || e.key === "\\")) {
        e.preventDefault();
        toggleCollapse();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K") && isOnChat) {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        if (isSearchOpen) {
          setIsSearchOpen(false);
          setSearchQuery("");
        }
        if (isSelectMode) {
          setIsSelectMode(false);
          setSelectedSessionIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCollapse, isOnChat, isSearchOpen, isSelectMode]);

  // Fetch sessions when on chat route
  const fetchSessions = useCallback(async () => {
    if (!isOnChat) return;
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingSessions(false);
    }
  }, [isOnChat]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions, pathname]);

  // Expose refresh for chat page
  useEffect(() => {
    const handler = () => fetchSessions();
    window.addEventListener("ray:session-created", handler);
    return () => window.removeEventListener("ray:session-created", handler);
  }, [fetchSessions]);

  // Poll chat runner active status
  useEffect(() => {
    let isMounted = true;

    const fetchChatStatus = async () => {
      try {
        const res = await fetch("/api/chat/status");
        if (res.ok) {
          const data = await res.json();
          const runs = data.runs || {};
          if (!isMounted) return;

          setChatRuns((prevRuns) => {
            const now = Date.now();
            const newCompletedUntil: Record<string, number> = {};
            let hasNewCompletions = false;

            for (const [sid, run] of Object.entries(runs as Record<string, { status: string; startedAt: number; completedAt?: number }>)) {
              const prev = prevRuns[sid];
              if (run.status === "completed" && (prev?.status === "running" || (run.completedAt && now - run.completedAt < 6000))) {
                newCompletedUntil[sid] = now + 5000;
                hasNewCompletions = true;
              }
            }

            if (hasNewCompletions) {
              setCompletedShowUntil((prev) => ({ ...prev, ...newCompletedUntil }));
              fetchSessions();
            }

            return runs;
          });
        }
      } catch {
        // silent
      }
    };

    fetchChatStatus();
    const interval = setInterval(fetchChatStatus, 2500);

    const handleChatStatusEvent = () => fetchChatStatus();
    window.addEventListener("ray:chat-status-change", handleChatStatusEvent);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener("ray:chat-status-change", handleChatStatusEvent);
    };
  }, [fetchSessions]);

  // Clear expired checkmarks
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setCompletedShowUntil((prev) => {
        let hasExpired = false;
        const next: Record<string, number> = {};
        for (const [sid, until] of Object.entries(prev)) {
          if (now < until) {
            next[sid] = until;
          } else {
            hasExpired = true;
          }
        }
        return hasExpired ? next : prev;
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // Poll monitor alert count for sidebar badge
  useEffect(() => {
    const fetchAlertCount = async () => {
      try {
        const res = await fetch("/api/monitor/alerts?dismissed=false");
        if (res.ok) {
          const data = await res.json();
          const count = data.undismissedCount ?? 0;
          setMonitorAlertCount(count);
          const hasCritical = (data.alerts || []).some(
            (a: { severity: string }) => a.severity === "critical"
          );
          setMonitorHasCritical(hasCritical);
        }
      } catch {
        // silent
      }
    };
    fetchAlertCount();
    const interval = setInterval(fetchAlertCount, 30000);
    // Also listen for real-time alert events
    const handler = () => fetchAlertCount();
    window.addEventListener("ray:monitor-alert", handler);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ray:monitor-alert", handler);
    };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  const handleNewChat = () => {
    router.push("/chat");
    onMobileClose?.();
  };

  const currentSessionId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingSessionId(id);
  };

  const confirmDeleteSession = async () => {
    if (!deletingSessionId) return;
    const id = deletingSessionId;
    setDeletingSessionId(null);

    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (currentSessionId === id) {
        router.push("/chat");
      }
      fetchSessions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRenameStart = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingSessionId(id);
    setEditTitle(currentTitle);
  };

  const handleRenameSave = async (e?: React.MouseEvent | React.KeyboardEvent, id?: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!editingSessionId) return;
    const targetId = id || editingSessionId;
    const newTitle = editTitle.trim();
    
    setEditingSessionId(null);
    if (!newTitle) return;

    // Optimistic update
    setSessions((s) => s.map((session) => session.id === targetId ? { ...session, title: newTitle } : session));

    try {
      await fetch(`/api/sessions/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      fetchSessions();
    } catch {
      fetchSessions(); // revert on fail
    }
  };

  // Multi-select actions
  const toggleSessionSelect = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedSessionIds.size === filteredSessions.length) {
      setSelectedSessionIds(new Set());
    } else {
      setSelectedSessionIds(new Set(filteredSessions.map((s) => s.id)));
    }
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedSessionIds(new Set());
  };

  const confirmBatchDelete = async () => {
    if (selectedSessionIds.size === 0) return;
    setIsBatchDeleting(true);
    const idsToDelete = Array.from(selectedSessionIds);
    try {
      const res = await fetch("/api/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      if (res.ok) {
        if (currentSessionId && selectedSessionIds.has(currentSessionId)) {
          router.push("/chat");
        }
        setSelectedSessionIds(new Set());
        setIsSelectMode(false);
        setShowBatchDeleteConfirm(false);
        fetchSessions();
      }
    } catch (err) {
      console.error("Failed to delete sessions:", err);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const toggleSearch = () => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        setSearchQuery("");
      }
      return next;
    });
  };

  // Filtered & grouped sessions
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const timelineGroups = useMemo(() => {
    return groupSessionsByTimeline(filteredSessions);
  }, [filteredSessions]);

  const renderSidebar = (collapsed: boolean) => (
    <aside
      className="flex flex-col h-full select-none"
      style={{
        width: collapsed ? "68px" : "270px",
        background: "#000000",
        transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Top Header / Logo section */}
      {collapsed ? (
        <div
          className="flex flex-col items-center justify-center py-4 px-2 flex-shrink-0 relative"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <button
            onClick={toggleCollapse}
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150 group relative cursor-pointer"
            style={{
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
            title="Expand sidebar (⌘B)"
            aria-label="Expand sidebar"
          >
            {/* Default: Ray logo */}
            <div className="group-hover:hidden flex items-center justify-center">
              <Image
                src="/logo.svg"
                alt="Ray"
                width={30}
                height={30}
                className="w-[30px] h-[30px] object-contain"
                priority
              />
            </div>
            {/* Hover: Expand indicator */}
            <div className="hidden group-hover:flex items-center justify-center text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9 3 3-3 3" />
              </svg>
            </div>

            {/* Tooltip */}
            <div
              className="absolute left-full ml-3 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[100] shadow-xl"
              style={{
                background: "#111111",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "#ffffff",
                boxShadow: "0 4px 20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
              }}
            >
              Expand sidebar (⌘B)
            </div>
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2.5 px-4 pt-4 pb-3 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <Link href="/dashboard" className="flex items-center gap-2.5 group cursor-pointer">
            <div className="flex items-center justify-center flex-shrink-0 group-hover:opacity-80 transition-opacity">
              <Image
                src="/logo.svg"
                alt="Ray"
                width={30}
                height={30}
                className="w-[30px] h-[30px] object-contain"
                priority
              />
            </div>
            <span className="font-jersey text-white text-2xl tracking-wide leading-none group-hover:text-white/80 transition-colors">
              ray
            </span>
          </Link>
          <div className="ray-badge">BETA</div>

          {/* Action icons on top right */}
          <div className="ml-auto flex items-center gap-0.5">
            {isOnChat && (
              <button
                onClick={toggleSearch}
                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
                  isSearchOpen ? "text-white bg-white/10" : "text-white/40 hover:text-white hover:bg-white/5"
                }`}
                title="Search chats (⌘K)"
                aria-label="Search chats"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            )}
            {/* Desktop collapse toggle button */}
            <button
              onClick={toggleCollapse}
              className="w-7 h-7 hidden lg:flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all duration-150 cursor-pointer"
              title="Collapse sidebar (⌘B)"
              aria-label="Collapse sidebar"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m14 9-3 3 3 3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Navigation items */}
      <nav
        className={`flex flex-col gap-0.5 flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
          isChatHistoryFull && !collapsed && isOnChat
            ? "max-h-0 opacity-0 py-0 pointer-events-none -translate-y-2 scale-y-95"
            : `max-h-[600px] opacity-100 py-2.5 translate-y-0 scale-y-100 ${collapsed ? "px-2 items-center" : "px-2.5"}`
        }`}
        style={{
          transitionProperty: "max-height, opacity, padding, transform",
          transitionDuration: "300ms",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const isMonitor = item.href === "/monitor";

          if (collapsed) {
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onMobileClose}
                className={`w-10 h-10 rounded-lg flex items-center justify-center relative group transition-all duration-150 ${
                  isActive ? "ray-nav-active" : ""
                }`}
                style={
                  !isActive
                    ? { color: "rgba(255,255,255,0.35)", border: "1px solid transparent" }
                    : {}
                }
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
                aria-label={item.label}
              >
                {item.icon}

                {/* Chat running indicator in collapsed mode */}
                {item.href === "/chat" && Object.values(chatRuns).some((r) => r.status === "running") && (
                  <span className="absolute top-1.5 right-1.5 flex items-center justify-center">
                    <StateSpinner size="xs" color="emerald" />
                  </span>
                )}
                {item.href === "/chat" && !Object.values(chatRuns).some((r) => r.status === "running") && Object.keys(completedShowUntil).length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center animate-fade-in">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}

                {/* Monitor alert pip in collapsed mode */}
                {isMonitor && monitorAlertCount > 0 && (
                  <span
                    className="absolute top-2 right-2 w-2 h-2 rounded-full"
                    style={{
                      background: monitorHasCritical ? "#ef4444" : "#f97316",
                      boxShadow: `0 0 6px ${monitorHasCritical ? "#ef4444" : "#f97316"}`,
                      animation: monitorHasCritical ? "shimmerPulse 1.5s ease-in-out infinite" : "none",
                    }}
                  />
                )}

                {/* Floating Tooltip */}
                <div
                  className="absolute left-full ml-3 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[100] shadow-xl flex items-center gap-1.5"
                  style={{
                    background: "#111111",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "#ffffff",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
                  }}
                >
                  <span>{item.label}</span>
                  {isMonitor && monitorAlertCount > 0 && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.2 rounded"
                      style={{
                        background: monitorHasCritical ? "rgba(239,68,68,0.25)" : "rgba(249,115,22,0.25)",
                        color: monitorHasCritical ? "#ef4444" : "#f97316",
                        border: `1px solid ${monitorHasCritical ? "rgba(239,68,68,0.4)" : "rgba(249,115,22,0.4)"}`,
                      }}
                    >
                      {monitorAlertCount}
                    </span>
                  )}
                </div>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? "ray-nav-active" : ""}`}
              style={
                !isActive
                  ? { color: "rgba(255,255,255,0.35)", border: "1px solid transparent" }
                  : {}
              }
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.75)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.35)";
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }
              }}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
              {/* Chat running / completed indicator in expanded mode */}
              {item.href === "/chat" && Object.values(chatRuns).some((r) => r.status === "running") && (
                <span className="ml-auto flex items-center justify-center shrink-0" title="Chat generating response in background...">
                  <StateSpinner size="xs" color="emerald" />
                </span>
              )}
              {item.href === "/chat" && !Object.values(chatRuns).some((r) => r.status === "running") && Object.keys(completedShowUntil).length > 0 && (
                <span className="ml-auto flex items-center justify-center shrink-0 text-emerald-400 animate-fade-in" title="Chat completed">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
              {/* Monitor alert badge */}
              {isMonitor && monitorAlertCount > 0 && (
                <span
                  className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{
                    background: monitorHasCritical ? "rgba(239,68,68,0.2)" : "rgba(249,115,22,0.15)",
                    color: monitorHasCritical ? "#ef4444" : "#f97316",
                    border: `1px solid ${monitorHasCritical ? "rgba(239,68,68,0.3)" : "rgba(249,115,22,0.25)"}`,
                    animation: monitorHasCritical ? "shimmerPulse 1.5s ease-in-out infinite" : "none",
                  }}
                >
                  {monitorAlertCount > 9 ? "9+" : monitorAlertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Chat Sessions Panel — only on /chat routes */}
      {isOnChat && (
        <div className="flex-1 flex flex-col min-h-0" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {collapsed ? (
            /* Collapsed Chat View: Compact New Chat button */
            <div className="pt-3 px-2 flex flex-col items-center">
              <button
                onClick={handleNewChat}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150 relative group cursor-pointer"
                style={{
                  color: "rgba(255,255,255,0.45)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "#ffffff";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.18)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)";
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
                }}
                aria-label="New Chat"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>

                {/* Tooltip */}
                <div
                  className="absolute left-full ml-3 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[100] shadow-xl"
                  style={{
                    background: "#111111",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "#ffffff",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
                  }}
                >
                  New Chat
                </div>
              </button>
            </div>
          ) : (
            /* Expanded Chat View: DeepSeek-style Timeline History */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Prominent New chat pill button */}
              <div className="px-3 pt-3 pb-2 flex-shrink-0">
                <button
                  onClick={handleNewChat}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    color: "rgba(255,255,255,0.9)",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.18)";
                    (e.currentTarget as HTMLElement).style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.09)";
                    (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span>New chat</span>
                </button>
              </div>

              {/* Inline Search Bar */}
              {isSearchOpen && (
                <div className="px-3 pb-2 flex-shrink-0 animate-fade-in">
                  <div
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search chats..."
                      className="flex-1 bg-transparent text-white outline-none placeholder:text-white/30 text-xs min-w-0"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="text-white/40 hover:text-white text-xs p-0.5 cursor-pointer"
                        title="Clear"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }}
                      className="text-[10px] text-white/30 hover:text-white/60 uppercase cursor-pointer"
                    >
                      ESC
                    </button>
                  </div>
                </div>
              )}

              {/* Multi-Select Action Bar */}
              {isSelectMode && (
                <div className="mx-2.5 mb-2.5 p-2 rounded-xl bg-white/[0.05] border border-white/[0.1] flex flex-col gap-2 animate-fade-in flex-shrink-0 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        onClick={toggleSelectAll}
                        className="text-[12px] font-medium text-white/80 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {selectedSessionIds.size === filteredSessions.length && filteredSessions.length > 0
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                      <span className="text-white/20 text-xs">•</span>
                      <span className="text-white/40 text-[11px] whitespace-nowrap">
                        {selectedSessionIds.size} selected
                      </span>
                    </div>
                    <button
                      onClick={exitSelectMode}
                      className="text-[11px] font-medium px-2 py-0.5 rounded bg-white/10 text-white/80 hover:text-white hover:bg-white/15 transition-all cursor-pointer whitespace-nowrap"
                    >
                      Done
                    </button>
                  </div>

                  {selectedSessionIds.size > 0 && (
                    <button
                      onClick={() => setShowBatchDeleteConfirm(true)}
                      className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span>Delete {selectedSessionIds.size} Chat{selectedSessionIds.size > 1 ? "s" : ""}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Sessions List */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
                {loadingSessions ? (
                  <div className="flex flex-col gap-1.5 px-2 pt-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="h-8 rounded-lg animate-shimmer"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          animationDelay: `${i * 100}ms`,
                        }}
                      />
                    ))}
                  </div>
                ) : filteredSessions.length === 0 ? (
                  <div className="px-3 py-6 text-center">
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {searchQuery ? `No chats matching "${searchQuery}"` : "No chats yet"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {timelineGroups.map((group, groupIdx) => (
                      <div key={group.label} className="flex flex-col gap-0.5">
                        {/* Timeline Header */}
                        <div className="flex items-center justify-between px-2 pt-1 pb-1">
                          <span className="text-xs font-medium text-white/40">
                            {group.label}
                          </span>
                          {groupIdx === 0 && (
                            <div className="flex items-center gap-1">
                              {/* Full chat toggle (Up / Down arrow) */}
                              <button
                                onClick={() => setIsChatHistoryFull((prev) => !prev)}
                                className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                                title={isChatHistoryFull ? "Restore navigation" : "Expand chat history to full sidebar"}
                                aria-label={isChatHistoryFull ? "Restore navigation" : "Expand chat history"}
                              >
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={`transition-transform duration-300 ease-in-out ${isChatHistoryFull ? "rotate-180" : "rotate-0"}`}
                                >
                                  <polyline points="18 15 12 9 6 15" />
                                </svg>
                              </button>

                              {/* Multi-select Manage Toggle */}
                              {!isSelectMode && (
                                <button
                                  onClick={() => setIsSelectMode(true)}
                                  className="p-1 rounded text-white/30 hover:text-white/80 hover:bg-white/5 transition-all cursor-pointer"
                                  title="Manage / Multi-select chats"
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="4" y1="6" x2="20" y2="6" />
                                    <circle cx="8" cy="6" r="2" />
                                    <line x1="4" y1="12" x2="20" y2="12" />
                                    <circle cx="16" cy="12" r="2" />
                                    <line x1="4" y1="18" x2="20" y2="18" />
                                    <circle cx="10" cy="18" r="2" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Sessions inside group */}
                        {group.sessions.map((session) => {
                          const isCurrentSession = session.id === currentSessionId;
                          const isSelected = selectedSessionIds.has(session.id);

                          if (isSelectMode) {
                            return (
                              <div
                                key={session.id}
                                onClick={(e) => toggleSessionSelect(e, session.id)}
                                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150 select-none min-w-0"
                                style={{
                                  background: isSelected ? "rgba(255,255,255,0.08)" : "transparent",
                                  border: isSelected ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                                }}
                              >
                                <div
                                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
                                    isSelected
                                      ? "bg-white border-white text-black"
                                      : "border-white/30 bg-white/[0.04]"
                                  }`}
                                >
                                  {isSelected && (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </div>
                                <span className="flex-1 min-w-0 text-[13.5px] text-white/80 truncate leading-snug">
                                  {session.title}
                                </span>
                                {chatRuns[session.id]?.status === "running" && (
                                  <div className="flex items-center shrink-0 ml-1.5" title="Generating response in background...">
                                    <StateSpinner size="xs" color="emerald" />
                                  </div>
                                )}
                                {completedShowUntil[session.id] && Date.now() < completedShowUntil[session.id] && chatRuns[session.id]?.status !== "running" && (
                                  <div className="flex items-center shrink-0 ml-1.5 text-emerald-400 animate-fade-in" title="Response completed">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <Link
                              key={session.id}
                              href={`/chat/${session.id}`}
                              onClick={onMobileClose}
                              className="group flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all duration-150 min-w-0"
                              style={{
                                background: isCurrentSession
                                  ? "rgba(255,255,255,0.07)"
                                  : "transparent",
                                border: isCurrentSession
                                  ? "1px solid rgba(255,255,255,0.1)"
                                  : "1px solid transparent",
                              }}
                              onMouseEnter={(e) => {
                                if (!isCurrentSession) {
                                  (e.currentTarget as HTMLElement).style.background =
                                    "rgba(255,255,255,0.03)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isCurrentSession) {
                                  (e.currentTarget as HTMLElement).style.background = "transparent";
                                }
                              }}
                            >
                              {editingSessionId === session.id ? (
                                <input
                                  autoFocus
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleRenameSave(e, session.id);
                                    if (e.key === "Escape") setEditingSessionId(null);
                                  }}
                                  onBlur={() => handleRenameSave(undefined, session.id)}
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  className="flex-1 text-[13.5px] bg-transparent outline-none text-white w-full min-w-0 py-0.5"
                                  style={{
                                    borderBottom: "1px solid rgba(255,255,255,0.3)",
                                  }}
                                />
                              ) : (
                                <span
                                  className="flex-1 text-[13.5px] truncate leading-snug"
                                  style={{
                                    color: isCurrentSession
                                      ? "rgba(255,255,255,0.92)"
                                      : "rgba(255,255,255,0.65)",
                                  }}
                                >
                                  {session.title}
                                </span>
                              )}

                              {/* Running background loader */}
                              {chatRuns[session.id]?.status === "running" && (
                                <div className="flex items-center shrink-0 ml-1.5" title="Generating response in background...">
                                  <StateSpinner size="xs" color="emerald" />
                                </div>
                              )}

                              {/* Completed green checkmark (shown for 5 seconds) */}
                              {completedShowUntil[session.id] && Date.now() < completedShowUntil[session.id] && chatRuns[session.id]?.status !== "running" && (
                                <div className="flex items-center shrink-0 ml-1.5 text-emerald-400 animate-fade-in" title="Response completed">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </div>
                              )}

                              {!editingSessionId && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => handleRenameStart(e, session.id, session.title)}
                                    className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                                    title="Rename"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M12 20h9"></path>
                                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                    className="p-1 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                                    title="Delete"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"></polyline>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spacer when not on chat */}
      {!isOnChat && <div className="flex-1" />}

      {/* User footer */}
      <div
        className={`py-3 flex-shrink-0 ${collapsed ? "px-2 flex flex-col items-center gap-1.5" : "px-3"}`}
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        {collapsed ? (
          /* Collapsed User & Logout */
          <>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold relative group cursor-default flex-shrink-0"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.8)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 0 10px rgba(255,255,255,0.05)",
              }}
            >
              {initials}

              {/* Tooltip */}
              <div
                className="absolute left-full ml-3 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[100] shadow-xl flex flex-col gap-0.5"
                style={{
                  background: "#111111",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "#ffffff",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
                }}
              >
                <span className="font-semibold text-white">{user.name}</span>
                <span className="text-[10px] text-white/50">{user.email}</span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-200 relative group flex-shrink-0 cursor-pointer"
              style={{ color: "rgba(255,255,255,0.3)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "#f87171";
                (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.3)";
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
              aria-label="Sign out"
            >
              {loggingOut ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              )}

              {/* Tooltip */}
              <div
                className="absolute left-full ml-3 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[100] shadow-xl"
                style={{
                  background: "#111111",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "#ffffff",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
                }}
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </div>
            </button>
          </>
        ) : (
          /* Expanded User & Logout */
          <div className="flex items-center justify-between gap-2 px-1 py-0.5">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 select-none"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate leading-tight">
                  {user.name}
                </p>
                <p className="text-[10px] truncate leading-tight text-white/30">
                  {user.email}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0 cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              {loggingOut ? (
                <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Single Delete Confirmation Modal */}
      {deletingSessionId && (
        <div className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div
            className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-scale-in"
            style={{
              background: "#0c0c0c",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <h3 className="text-white text-lg font-semibold mb-2">Delete Chat</h3>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>
              Are you sure you want to delete this chat? This action cannot be undone.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setDeletingSessionId(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                style={{ color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteSession}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                style={{ color: "#fff", background: "#ef4444" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div
            className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-scale-in"
            style={{
              background: "#0c0c0c",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <h3 className="text-white text-lg font-semibold mb-2">Delete {selectedSessionIds.size} Chat{selectedSessionIds.size > 1 ? "s" : ""}?</h3>
            <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>
              Are you sure you want to delete {selectedSessionIds.size} selected chat{selectedSessionIds.size > 1 ? "s" : ""}? This action cannot be undone.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowBatchDeleteConfirm(false)}
                disabled={isBatchDeleting}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                style={{ color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              >
                Cancel
              </button>
              <button
                onClick={confirmBatchDelete}
                disabled={isBatchDeleting}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer"
                style={{ color: "#fff", background: "#ef4444" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
              >
                {isBatchDeleting && (
                  <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                )}
                {isBatchDeleting ? "Deleting…" : `Delete (${selectedSessionIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar — collapsible */}
      <div
        className="hidden lg:flex h-full flex-shrink-0 transition-all duration-200 ease-in-out"
        style={{ width: isCollapsed ? "68px" : "270px" }}
      >
        {renderSidebar(isCollapsed)}
      </div>

      {/* Mobile drawer — always full width (270px) */}
      <div
        className={`fixed inset-y-0 left-0 z-50 lg:hidden transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ width: "270px", boxShadow: "10px 0 40px rgba(0,0,0,0.9)" }}
      >
        {renderSidebar(false)}
      </div>
    </>
  );
}
