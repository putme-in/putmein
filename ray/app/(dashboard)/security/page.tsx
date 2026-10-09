"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AdvancedSecuritySettings from "@/components/AdvancedSecuritySettings";
import { Icon } from "@iconify/react";

interface SecurityRule {
  id: string;
  title: string;
  description: string;
  category: "cve" | "secret" | "container" | "owasp" | "dependency";
  severity: "info" | "warning" | "danger";
  cve?: string;
  checklist: string;
  remediation: string;
}

interface FindingItem {
  id: string;
  ruleId: string;
  title: string;
  severity: "info" | "warning" | "danger";
  category: string;
  description: string;
  file?: string;
  line?: number;
  cve?: string;
  recommendation: string;
}

interface SecurityScanItem {
  id: string;
  projectId?: string | null;
  projectName: string;
  trigger: string;
  status: "passed" | "warning" | "danger" | "error" | "skipped";
  dangerCount: number;
  warnCount: number;
  infoCount: number;
  findings: string; // JSON
  logs: string;
  overridden: boolean;
  overrideBy?: string | null;
  createdAt: string;
}

interface SecurityStats {
  totalScans: number;
  totalProjects: number;
  cleanProjects: number;
  warningProjects: number;
  dangerProjects: number;
  blockedDeployments: number;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function SecurityPage() {
  const [activeTab, setActiveTab] = useState<"projects" | "rules" | "history">("projects");
  const [scans, setScans] = useState<SecurityScanItem[]>([]);
  const [rules, setRules] = useState<SecurityRule[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [stats, setStats] = useState<SecurityStats>({
    totalScans: 0,
    totalProjects: 0,
    cleanProjects: 0,
    warningProjects: 0,
    dangerProjects: 0,
    blockedDeployments: 0,
  });
  const [blockedPipelines, setBlockedPipelines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanningProject, setScanningProject] = useState<string | null>(null);

  // Scan modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [selectedScanProject, setSelectedScanProject] = useState("");

  // Report modal state
  const [selectedScanReport, setSelectedScanReport] = useState<SecurityScanItem | null>(null);
  const [activeReportTab, setActiveReportTab] = useState<"findings" | "logs">("findings");

  // Dual consent override state
  const [overrideAck, setOverrideAck] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideSuccess, setOverrideSuccess] = useState(false);
  const [overrideError, setOverrideError] = useState("");

  // Rule search / filter
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleCategoryFilter, setRuleCategoryFilter] = useState<string>("all");

  useEffect(() => {
    const scanId = new URLSearchParams(window.location.search).get("scanId");
    if (!scanId) return;
    const controller = new AbortController();
    void fetch(`/api/security/scans/${encodeURIComponent(scanId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open scan");
      if (!controller.signal.aborted) { setSelectedScanReport(result.scan); setActiveReportTab("findings"); }
    }).catch(error => { if (!controller.signal.aborted) setScanError(error instanceof Error ? error.message : "Could not open scan"); });
    return () => controller.abort();
  }, []);

  const fetchData = useCallback(async () => {
    setDataError(null);
    try {
      const [scansRes, rulesRes, projectsRes] = await Promise.all([
        fetch("/api/security/scans"),
        fetch("/api/security/rules"),
        fetch("/api/monitor/projects"),
      ]);

      const failedResponse = [
        { resource: "security scans", response: scansRes },
        { resource: "security rules", response: rulesRes },
        { resource: "projects", response: projectsRes },
      ].find(({ response }) => !response.ok);
      if (failedResponse) {
        const details = await failedResponse.response.json().catch(() => ({}));
        throw new Error(details.error || `Failed to load ${failedResponse.resource}`);
      }

      const [scansData, rulesData, projectsData] = await Promise.all([
        scansRes.json(),
        rulesRes.json(),
        projectsRes.json(),
      ]);
      setScans(scansData.scans || []);
      if (scansData.stats) setStats(scansData.stats);
      if (scansData.blockedPipelines) setBlockedPipelines(scansData.blockedPipelines);
      setRules(rulesData.rules || []);
      setProjects(projectsData.projects || []);
    } catch (error: unknown) {
      setDataError(error instanceof Error ? error.message : "Failed to load Security Center data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Run security scan
  const handleTriggerScan = async (project: { id?: string; name: string; projectPath: string }) => {
    setScanningProject(project.name);
    setScanError(null);
    setShowScanModal(false);
    try {
      const res = await fetch("/api/security/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          projectName: project.name,
          projectPath: project.projectPath,
          trigger: "manual",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Security audit failed (${res.status})`);
      }
      if (!data.scan) {
        throw new Error("Security audit completed without a saved result. Please retry.");
      }
      setScans((prev) => [data.scan, ...prev.filter((s) => s.id !== data.scan.id)]);
      setSelectedScanReport(data.scan);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Security audit failed. Please retry.");
    } finally {
      setScanningProject(null);
      fetchData();
    }
  };

  // Authorize dual consent override
  const handleAuthorizeOverride = async (runId: string, pipelineId?: string, scanId?: string) => {
    if (!overrideAck) return;
    setOverrideSubmitting(true);
    setOverrideError("");
    try {
      const res = await fetch("/api/security/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          pipelineId,
          scanId,
          acknowledgedDanger: true,
          overrideReason: "Operator dual-consent force authorization via Security Center",
        }),
      });
      if (res.ok) {
        setOverrideSuccess(true);
        setTimeout(() => {
          setOverrideSuccess(false);
          setOverrideAck(false);
          fetchData();
        }, 3000);
      } else {
        const err = await res.json();
        setOverrideError(err.error || "Failed to override security block");
      }
    } catch (e: any) {
      setOverrideError(e.message || "Failed to override security block");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // Group latest scan per project
  const projectScanMap = new Map<string, SecurityScanItem>();
  for (const scan of scans) {
    const key = scan.projectId || scan.projectName;
    if (!projectScanMap.has(key)) {
      projectScanMap.set(key, scan);
    }
  }

  // Filter rules
  const filteredRules = rules.filter((r) => {
    const matchSearch =
      r.title.toLowerCase().includes(ruleSearch.toLowerCase()) ||
      r.description.toLowerCase().includes(ruleSearch.toLowerCase()) ||
      (r.cve && r.cve.toLowerCase().includes(ruleSearch.toLowerCase()));
    const matchCat = ruleCategoryFilter === "all" || r.category === ruleCategoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-jersey text-3xl text-white tracking-wide">
              Security Center
            </h1>
            <span className="text-[10.5px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Source Security Checks
            </span>
          </div>
          <p className="text-xs text-white/40 mt-1">
            Automated CVE audits, secret leak detection, container security posture, and CI/CD deployment guardrails
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="ray-btn-ghost px-3.5 py-2 text-xs cursor-pointer"
          >
            <Icon icon="lucide:refresh-cw" className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowScanModal(true)}
            className="ray-btn-primary px-4 py-2 text-xs cursor-pointer"
          >
            <Icon icon="lucide:shield-check" className="w-4 h-4" />
            <span>Run Security Audit</span>
          </button>
        </div>
      </div>

      {dataError && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:circle-alert" className="h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold">Security Center data could not be loaded</p>
              <p className="mt-1 text-xs text-red-200/70">{dataError}</p>
            </div>
          </div>
          <button onClick={() => fetchData()} className="ray-btn-ghost shrink-0 px-3 py-1.5 text-xs cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {scanError && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-200">
          <div className="flex items-center gap-3">
            <Icon icon="lucide:triangle-alert" className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold">Security audit failed</p>
              <p className="mt-1 text-xs text-amber-200/70">{scanError}</p>
            </div>
          </div>
          <button onClick={() => setScanError(null)} className="ray-btn-ghost shrink-0 px-3 py-1.5 text-xs cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      <AdvancedSecuritySettings />

      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        <div className="p-4.5 rounded-2xl bg-card border border-card-border shadow-lg">
          <div className="flex items-center justify-between text-white/40 text-xs font-medium">
            <span>Total Security Audits</span>
            <Icon icon="lucide:file-search" className="w-4 h-4 text-white/30" />
          </div>
          <div className="text-2xl font-bold text-white mt-2 font-mono">{stats.totalScans}</div>
          <div className="text-[11px] text-white/40 mt-1">Across {stats.totalProjects} registered projects</div>
        </div>

        <div className="p-4.5 rounded-2xl bg-card border border-emerald-500/20 shadow-lg">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-medium">
            <span>Clean / Passing</span>
            <Icon icon="lucide:check-circle-2" className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-2 font-mono">{stats.cleanProjects}</div>
          <div className="text-[11px] text-emerald-400/60 mt-1">Passed implemented checks</div>
        </div>

        <div className="p-4.5 rounded-2xl bg-card border border-amber-500/20 shadow-lg">
          <div className="flex items-center justify-between text-amber-400 text-xs font-medium">
            <span>Warnings / Attention</span>
            <Icon icon="lucide:alert-triangle" className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-2 font-mono">{stats.warningProjects}</div>
          <div className="text-[11px] text-amber-400/60 mt-1">Non-blocking recommendations</div>
        </div>

        <div className="p-4.5 rounded-2xl bg-card border border-red-500/25 shadow-lg">
          <div className="flex items-center justify-between text-red-400 text-xs font-medium">
            <span>Danger / Critical</span>
            <Icon icon="lucide:shield-alert" className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold text-red-400 mt-2 font-mono">{stats.dangerProjects}</div>
          <div className="text-[11px] text-red-400/60 mt-1">
            {stats.blockedDeployments > 0 ? `${stats.blockedDeployments} deployment(s) blocked` : "Requires dual consent"}
          </div>
        </div>
      </div>

      {/* Blocked Deployments Banner */}
      {blockedPipelines.length > 0 && (
        <div className="mb-6 p-5 rounded-2xl bg-red-500/[0.06] border border-red-500/30 shadow-xl">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-red-500/15 text-red-400 mt-0.5 shrink-0">
              <Icon icon="lucide:alert-octagon" className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white">
                  {blockedPipelines.length} CI/CD Deployment{blockedPipelines.length > 1 ? "s" : ""} Blocked by Security Policy
                </h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                  Action Required
                </span>
              </div>
              <p className="text-xs text-white/70 mt-1 leading-relaxed">
                Critical danger-level vulnerabilities (e.g. known framework CVEs or secret leaks) were detected before public deployment.
                Automated release has been halted until an authorized operator inspects findings and consents via dual confirmation.
              </p>

              <div className="mt-3.5 space-y-2">
                {blockedPipelines.map((run) => (
                  <div key={run.id} className="p-3.5 rounded-xl bg-card border border-card-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">{run.pipeline?.name}</span>
                        <span className="text-xs text-white/40 font-mono">({run.commitHash?.slice(0, 7)})</span>
                      </div>
                      <p className="text-[11px] text-white/40 mt-0.5 truncate max-w-md">{run.commitMessage}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/cicd/${run.pipelineId}`}
                        className="ray-btn-ghost px-3 py-1.5 text-xs"
                      >
                        Inspect CI/CD Run
                      </Link>
                      <button
                        onClick={() => {
                          const matchingScan = scans.find((s) => run.logs?.includes(`[SECURITY_SCAN] ${s.id}\n`) && s.status === "danger");
                          if (matchingScan) setSelectedScanReport(matchingScan);
                        }}
                        className="ray-btn-primary px-3 py-1.5 text-xs cursor-pointer"
                      >
                        Review Findings & Override
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] mb-6">
        <button
          onClick={() => setActiveTab("projects")}
          className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer -mb-px ${
            activeTab === "projects"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          <Icon icon="lucide:layout-grid" className="w-3.5 h-3.5" />
          <span>Projects Posture ({projects.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("rules")}
          className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer -mb-px ${
            activeTab === "rules"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          <Icon icon="lucide:shield-check" className="w-3.5 h-3.5" />
          <span>Active Rules & CVEs ({rules.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer -mb-px ${
            activeTab === "history"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8)]"
              : "text-white/40 hover:text-white/70"
          }`}
        >
          <Icon icon="lucide:history" className="w-3.5 h-3.5" />
          <span>Audit Logs ({scans.length})</span>
        </button>
      </div>

      {/* TAB 1: PROJECTS POSTURE */}
      {activeTab === "projects" && (
        <div>
          {projects.length === 0 ? (
            <div className="p-12 rounded-2xl border border-card-border bg-card flex flex-col items-center justify-center text-center shadow-lg">
              <div className="w-12 h-12 rounded-2xl mb-3 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/60">
                <Icon icon="lucide:folder-plus" className="w-6 h-6" />
              </div>
              <p className="font-sans font-bold text-sm text-white mb-1">No Monitored Projects Added Yet</p>
              <p className="text-xs text-white/40 max-w-sm mb-4">
                Add a project under Projects to automatically monitor and audit its codebase for known CVEs.
              </p>
              <Link
                href="/projects"
                className="ray-btn-primary px-4 py-2 text-xs"
              >
                Go to Projects
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((proj) => {
                const latestScan = projectScanMap.get(proj.id) || projectScanMap.get(proj.name);
                const isScanning = scanningProject === proj.name;

                return (
                  <div
                    key={proj.id}
                    className="p-5 rounded-2xl bg-card hover:bg-card border border-card-border hover:border-white/20 transition-all flex flex-col justify-between shadow-lg group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white font-bold text-sm flex items-center justify-center shrink-0">
                            {proj.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <Link href={`/projects/${proj.id}`} className="text-sm font-bold text-white hover:text-white/80 transition-colors truncate block">
                              {proj.name}
                            </Link>
                            <p className="text-[11px] text-white/40 truncate max-w-[180px] font-mono">{proj.projectPath}</p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        {latestScan ? (
                          ["error", "skipped"].includes(latestScan.status) ? (<span className="text-xs text-amber-400">{latestScan.status === "error" ? "Scan incomplete" : "Not scanned (disabled)"}</span>) : latestScan.status === "danger" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                              Danger
                            </span>
                          ) : latestScan.status === "warning" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              Warning
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Passed
                            </span>
                          )
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono bg-white/[0.04] text-white/40 border border-white/[0.08] shrink-0">
                            Unscanned
                          </span>
                        )}
                      </div>

                      {/* Findings Counts */}
                      {latestScan && (
                        <div className="flex items-center gap-3 mt-4 pt-3.5 border-t border-white/[0.06] text-xs font-mono">
                          <span className="flex items-center gap-1 text-red-400 font-semibold">
                            <Icon icon="lucide:shield-alert" className="w-3.5 h-3.5" />
                            {latestScan.dangerCount} Danger
                          </span>
                          <span className="flex items-center gap-1 text-amber-400 font-semibold">
                            <Icon icon="lucide:alert-triangle" className="w-3.5 h-3.5" />
                            {latestScan.warnCount} Warn
                          </span>
                          <span className="flex items-center gap-1 text-white/50 font-semibold">
                            <Icon icon="lucide:info" className="w-3.5 h-3.5" />
                            {latestScan.infoCount} Info
                          </span>
                        </div>
                      )}

                      <div className="mt-3 text-[11px] text-white/40">
                        {latestScan
                          ? `Last audit: ${new Date(latestScan.createdAt).toLocaleDateString()} at ${new Date(latestScan.createdAt).toLocaleTimeString()}`
                          : "No security audits conducted yet."}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-5 pt-3.5 border-t border-white/[0.06]">
                      {latestScan && (
                        <button
                          onClick={() => setSelectedScanReport(latestScan)}
                          className="flex-1 ray-btn-ghost py-1.5 text-xs cursor-pointer text-center"
                        >
                          View Report
                        </button>
                      )}
                      <button
                        onClick={() => handleTriggerScan(proj)}
                        disabled={isScanning}
                        className="flex-1 ray-btn-primary py-1.5 text-xs cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        {isScanning ? (
                          <>
                            <SpinIcon size={12} />
                            <span>Auditing…</span>
                          </>
                        ) : (
                          <>
                            <Icon icon="lucide:play" className="w-3 h-3" />
                            <span>Audit Now</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ACTIVE RULES & CVE CHECKLIST */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-2xl bg-card border border-card-border shadow-lg">
            <div className="relative w-full sm:w-80">
              <Icon icon="lucide:search" className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search rules, CVE identifiers..."
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
                className="w-full pl-9 pr-3.5 py-1.5 text-xs bg-[#070707] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 transition-all font-sans"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {["all", "cve", "secret", "container", "owasp", "dependency"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setRuleCategoryFilter(cat)}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition-all cursor-pointer ${
                    ruleCategoryFilter === cat
                      ? "bg-white text-black font-bold"
                      : "bg-white/[0.04] text-white/40 hover:text-white border border-white/[0.06]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredRules.map((rule) => (
              <div key={rule.id} className="p-5 rounded-2xl bg-card border border-card-border shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.06] text-white/60 font-mono">
                      {rule.category}
                    </span>
                    {rule.cve && (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                        {rule.cve}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded ${
                      rule.severity === "danger"
                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                        : rule.severity === "warning"
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        : "bg-white/[0.06] text-white/60 border border-white/[0.08]"
                    }`}
                  >
                    {rule.severity}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white mt-3">{rule.title}</h3>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">{rule.description}</p>

                <div className="mt-3.5 p-3 rounded-xl bg-[#060606] border border-white/[0.06] text-[11px] space-y-1.5">
                  <div>
                    <span className="font-semibold text-white/40">Checklist: </span>
                    <span className="text-white/80">{rule.checklist}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-400">Remediation: </span>
                    <span className="text-white/80">{rule.remediation}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT LOGS & HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {scans.length === 0 ? (
            <div className="p-12 rounded-2xl border border-card-border bg-card text-center text-white/40 text-xs shadow-lg">
              No audit logs recorded yet.
            </div>
          ) : (
            scans.map((scan) => {
              let parsedFindings: FindingItem[] = [];
              try {
                parsedFindings = JSON.parse(scan.findings);
              } catch { /* silent */ }

              return (
                <div
                  key={scan.id}
                  onClick={() => setSelectedScanReport(scan)}
                  className="p-4.5 rounded-2xl bg-card hover:bg-card border border-card-border hover:border-white/20 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg group"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        scan.status === "danger"
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : scan.status !== "passed"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}
                    >
                      <Icon
                        icon={
                          scan.status === "danger"
                            ? "lucide:shield-alert"
                            : scan.status !== "passed"
                            ? "lucide:alert-triangle"
                            : "lucide:shield-check"
                        }
                        className="w-5 h-5"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">{scan.projectName}</span>
                        <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60">
                          {scan.trigger.replace(/_/g, " ")}
                        </span>
                        {scan.overridden && (
                          <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            Overridden by {scan.overrideBy || "User"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/50 mt-0.5 font-mono">
                        {parsedFindings.length} issue(s) identified ({scan.dangerCount} Danger, {scan.warnCount} Warning, {scan.infoCount} Info)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-white/40">
                    <span className="font-mono">{new Date(scan.createdAt).toLocaleString()}</span>
                    <button className="ray-btn-ghost px-3 py-1 text-xs">
                      Inspect
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SCAN MODAL */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-card-border rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Icon icon="lucide:shield-check" className="w-5 h-5 text-emerald-400" />
              Initiate Project Security Audit
            </h3>
            <p className="text-xs text-white/50 mt-1">
              Select a project to audit dependencies, lockfiles, known CVEs, and configuration.
            </p>

            <div className="mt-4 space-y-2 max-h-60 overflow-y-auto pr-1">
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedScanProject(p.id)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                    selectedScanProject === p.id
                      ? "bg-white/[0.08] border-white text-white"
                      : "bg-[#070707] border-white/[0.06] text-white/70 hover:border-white/20"
                  }`}
                >
                  <span className="font-bold">{p.name}</span>
                  <span className="text-[11px] text-white/40 font-mono truncate max-w-[180px]">{p.projectPath}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-white/[0.06]">
              <button
                onClick={() => setShowScanModal(false)}
                className="ray-btn-ghost px-4 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = projects.find((p) => p.id === selectedScanProject) || projects[0];
                  if (target) handleTriggerScan(target);
                }}
                disabled={projects.length === 0}
                className="ray-btn-primary px-4 py-2 text-xs"
              >
                Start Scan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPORT DETAIL MODAL */}
      {selectedScanReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-card-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-lg font-bold text-white">{selectedScanReport.projectName} Audit Report</h3>
                  <span
                    className={`text-xs font-bold uppercase font-mono px-2 py-0.5 rounded ${
                      selectedScanReport.status === "danger"
                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                        : selectedScanReport.status !== "passed"
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}
                  >
                    {selectedScanReport.status}
                  </span>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  Audited on {new Date(selectedScanReport.createdAt).toLocaleString()} via {selectedScanReport.trigger.replace(/_/g, " ")}
                </p>
              </div>

              <button
                onClick={() => setSelectedScanReport(null)}
                className="p-2 text-white/40 hover:text-white rounded-xl hover:bg-white/[0.05] transition-all cursor-pointer"
              >
                <Icon icon="lucide:x" className="w-5 h-5" />
              </button>
            </div>

            {/* DUAL CONSENT OVERRIDE BANNER IN MODAL IF DANGER */}
            {selectedScanReport.status === "danger" && blockedPipelines.some(run => run.logs?.includes(`[SECURITY_SCAN] ${selectedScanReport.id}\n`)) && (
              <div className="p-4 mx-6 mt-4 rounded-2xl bg-red-500/[0.06] border border-red-500/30">
                <div className="flex items-start gap-3">
                  <Icon icon="lucide:shield-alert" className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-red-300 uppercase tracking-wide">
                      High-Risk Release — Guardrail Override Required
                    </h4>
                    <p className="text-xs text-white/70 mt-1">
                      Approval applies only to this source snapshot and scanner rules for ten minutes. New source is scanned again and cannot reuse this approval.
                    </p>

                    {overrideError && <div className="text-xs text-red-400 font-semibold mt-2">{overrideError}</div>}
                    {overrideSuccess ? (
                      <div className="text-xs text-emerald-400 font-semibold mt-2 flex items-center gap-1.5">
                        <Icon icon="lucide:check-circle" className="w-4 h-4" />
                        Dual consent confirmed! Deployment override dispatched.
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-red-500/20">
                        {/* Confirmation 1: Checkbox */}
                        <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={overrideAck}
                            onChange={(e) => setOverrideAck(e.target.checked)}
                            className="rounded bg-[#181818] border-white/20 text-red-500 focus:ring-red-500 w-4 h-4 cursor-pointer"
                          />
                          <span>I acknowledge these danger-level findings and accept the risk</span>
                        </label>

                        {/* Confirmation 2: Armed Button */}
                        <button
                          onClick={() => {
                            const blocked = blockedPipelines.find((b) => b.logs?.includes(`[SECURITY_SCAN] ${selectedScanReport.id}\n`));
                            if (blocked) {
                              handleAuthorizeOverride(blocked.id, blocked.pipelineId, selectedScanReport.id);
                            }
                          }}
                          disabled={!overrideAck || overrideSubmitting}
                          className="ray-btn-primary px-4 py-1.5 text-xs font-bold shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {overrideSubmitting ? <SpinIcon size={12} /> : <Icon icon="lucide:unlock" className="w-3.5 h-3.5" />}
                          <span>Confirm & Force Deploy</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {["error", "skipped"].includes(selectedScanReport.status) && <p role="status" className="px-6 py-3 text-sm text-amber-400">{selectedScanReport.status === "error" ? "This scan did not complete. Deployment is blocked until scanning succeeds or server policy is explicitly changed." : "Security checks were disabled. This is not a passing scan."}</p>}
            {/* Modal Tabs */}
            <div className="flex items-center gap-4 px-6 border-b border-white/[0.08] text-xs font-semibold pt-4">
              <button
                onClick={() => setActiveReportTab("findings")}
                className={`pb-2 border-b-2 cursor-pointer transition-all ${
                  activeReportTab === "findings" ? "border-white text-white font-bold" : "border-transparent text-white/40 hover:text-white"
                }`}
              >
                Vulnerability Findings ({selectedScanReport.dangerCount + selectedScanReport.warnCount + selectedScanReport.infoCount})
              </button>
              <button
                onClick={() => setActiveReportTab("logs")}
                className={`pb-2 border-b-2 cursor-pointer transition-all ${
                  activeReportTab === "logs" ? "border-white text-white font-bold" : "border-transparent text-white/40 hover:text-white"
                }`}
              >
                Execution Audit Log
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {activeReportTab === "findings" ? (
                (() => {
                  let findingsList: FindingItem[] = [];
                  try {
                    findingsList = JSON.parse(selectedScanReport.findings);
                  } catch { /* silent */ }

                  if (findingsList.length === 0) {
                    return (
                      <div className="text-center py-12 text-white/40 text-xs">
                        <Icon icon="lucide:shield-check" className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                        No security vulnerabilities detected in this project.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {findingsList.map((f, i) => (
                        <div
                          key={f.id || i}
                          className={`p-4 rounded-xl border ${
                            f.severity === "danger"
                              ? "bg-red-500/[0.06] border-red-500/30"
                              : f.severity === "warning"
                              ? "bg-amber-500/[0.06] border-amber-500/30"
                              : "bg-white/[0.02] border-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span
                                className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded ${
                                  f.severity === "danger"
                                    ? "bg-red-500/20 text-red-300"
                                    : f.severity === "warning"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-white/[0.06] text-white/60"
                                }`}
                              >
                                {f.severity}
                              </span>
                              {f.cve && (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 ml-2">
                                  {f.cve}
                                </span>
                              )}
                              <h4 className="text-sm font-bold text-white mt-1.5">{f.title}</h4>
                            </div>
                            {f.file && (
                              <span className="text-xs font-mono text-white/50 bg-[#060606] px-2 py-0.5 rounded border border-white/[0.06]">
                                {f.file}
                                {f.line ? `:${f.line}` : ""}
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-white/70 mt-2 leading-relaxed">{f.description}</p>

                          {f.recommendation && (
                            <div className="mt-3 p-3 rounded-xl bg-[#060606] border border-white/[0.06]">
                              <span className="text-xs font-semibold text-emerald-400 block mb-1">Recommended Action:</span>
                              <code className="text-xs text-white/80 font-mono block whitespace-pre-wrap">{f.recommendation}</code>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <pre className="p-4 rounded-xl bg-[#050505] border border-white/[0.06] font-mono text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                  {selectedScanReport.logs || "No detailed logs recorded."}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
