"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";
import { getPrimaryProjectUrl } from "@/lib/domains";
import { validateTcpPort } from "@/lib/port-validator";

interface PipelineStage {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  { id: "clone", name: "Git Clone", desc: "Checkout branch & commit", icon: "lucide:git-pull-request" },
  { id: "deps", name: "Dependencies", desc: "Resolve packages & locks", icon: "lucide:package" },
  { id: "security", name: "Security Audit", desc: "Pre-deployment CVE & vulnerability scan", icon: "lucide:shield-check" },
  { id: "build", name: "Docker Build", desc: "Compile container image", icon: "logos:docker-icon" },
  { id: "deploy", name: "Container Deploy", desc: "Launch running instance", icon: "lucide:server" },
  { id: "health", name: "Healthcheck", desc: "Verify live endpoint", icon: "lucide:check-circle-2" },
];

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function CicdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [pipeline, setPipeline] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [diagnoseRun, setDiagnoseRun] = useState<any>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Dual Consent Override state
  const [overrideAckRisk, setOverrideAckRisk] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggerSuccess, setTriggerSuccess] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  // Settings form states
  const [editBranch, setEditBranch] = useState("");
  const [editPort, setEditPort] = useState(3000);
  const [editAutoDeploy, setEditAutoDeploy] = useState(true);
  const [editDockerfile, setEditDockerfile] = useState("Dockerfile");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsPortError, setSettingsPortError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/cicd/${id}`);
      if (res.ok) {
        const data = await res.json();
        setPipeline(data.pipeline || null);
        setPipelineError(null);
        if (data.pipeline) {
          setEditBranch(data.pipeline.branch || "main");
          setEditPort(data.pipeline.port || 3000);
          setEditAutoDeploy(data.pipeline.autoDeploy ?? true);
          setEditDockerfile(data.pipeline.dockerfilePath || "Dockerfile");
          // Auto-expand latest run if none selected
          setExpandedRunId((prev) => prev || data.pipeline.runs?.[0]?.id || null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setPipelineError(errData.error || `Failed to load pipeline (${res.status})`);
      }
    } catch (err: unknown) {
      setPipelineError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 4000);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerError(null);
    setTriggerSuccess(null);
    try {
      const res = await fetch(`/api/cicd/${id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Pipeline execution failed to start (${res.status})`);
      }
      setTriggerSuccess("Pipeline run successfully initiated");
      setTimeout(() => setTriggerSuccess(null), 5000);
      await fetchPipeline();
    } catch (err: unknown) {
      setTriggerError(err instanceof Error ? err.message : "Failed to trigger pipeline run");
    } finally {
      setTriggering(false);
    }
  };

  const handleOverrideDeploy = async () => {
    if (!overrideAckRisk || overrideSubmitting) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      const res = await fetch("/api/security/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineRunId: latestRun?.id,
          pipelineId: pipeline?.id,
          acknowledgedRisk: true,
          consentDeploy: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOverrideError(data.error || "Failed to authorize deployment override");
      } else {
        setOverrideAckRisk(false);
        fetchPipeline();
      }
    } catch (err: unknown) {
      setOverrideError(err instanceof Error ? err.message : "Network error");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleToggleAutoDeploy = async () => {
    const nextVal = !pipeline.autoDeploy;
    try {
      const res = await fetch(`/api/cicd/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoDeploy: nextVal }),
      });
      if (res.ok) {
        setPipeline((prev: any) => ({ ...prev, autoDeploy: nextVal }));
      }
    } catch { /* silent */ }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsPortError(null);
    setSettingsError(null);

    const portValidation = validateTcpPort(editPort);
    if (!portValidation.valid) {
      setSettingsPortError(portValidation.error || "Port must be an integer between 1 and 65535");
      return;
    }

    setSavingSettings(true);
    try {
      const res = await fetch(`/api/cicd/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: editBranch.trim(),
          port: portValidation.port,
          autoDeploy: editAutoDeploy,
          dockerfilePath: editDockerfile.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to update settings (${res.status})`);
      }
      setShowSettingsModal(false);
      fetchPipeline();
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhooks/github/${id}`
    : `/api/webhooks/github/${id}`;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  if (!pipeline && loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-white/40 font-sans">
        <SpinIcon /><span className="text-xs font-medium">Loading pipeline details…</span>
      </div>
    );
  }

  if (!pipeline && !loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center font-sans">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4">
          <Icon icon="lucide:alert-circle" width={28} height={28} />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Pipeline Unavailable</h2>
        <p className="text-xs text-white/60 max-w-md mb-6 leading-relaxed">
          {pipelineError || "The requested CI/CD pipeline could not be found or you do not have permission to access it."}
        </p>
        <button
          onClick={() => router.push("/cicd")}
          className="ray-btn-primary px-4 py-2 text-xs flex items-center gap-2 cursor-pointer"
        >
          <Icon icon="lucide:arrow-left" width={14} height={14} />
          <span>Back to CI/CD Pipelines</span>
        </button>
      </div>
    );
  }

  const latestRun = pipeline?.runs?.[0];
  let stagesRunning = false;
  try {
    if (latestRun?.stages) {
      const parsed = JSON.parse(latestRun.stages);
      if (Array.isArray(parsed)) {
        stagesRunning = parsed.some((s: any) => s.status === "running" || s.status === "building");
      }
    }
  } catch { /* silent */ }

  const isBlockedDanger = pipeline?.status === "blocked_danger" || latestRun?.status === "blocked_danger";
  const isRunning = pipeline?.status === "running" || latestRun?.status === "running" || stagesRunning;
  const isSuccess = !isRunning && !isBlockedDanger && (latestRun ? (latestRun.status === "success" && !stagesRunning) : pipeline?.status === "success");
  const isFailed = !isRunning && !isBlockedDanger && (latestRun ? latestRun.status === "failed" : pipeline?.status === "failed");
  const effectiveAppUrl = getPrimaryProjectUrl(pipeline?.deployment?.deployUrl, pipeline?.port) || (pipeline?.port ? `http://localhost:${pipeline.port}` : null);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 font-sans">
      {/* Top Header */}
      <div className="p-5 rounded-2xl bg-card border border-card-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-start md:items-center gap-4 min-w-0">
          <button
            onClick={() => router.push("/cicd")}
            className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/10 transition-all cursor-pointer flex-shrink-0 mt-0.5 md:mt-0"
            title="Back to CI/CD Pipelines"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>

          {/* Large Technology Icon */}
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-sm">
            <Icon icon={pipeline?.icon || (pipeline?.isDocker ? "logos:docker-icon" : "logos:nodejs-icon")} width={24} height={24} className="shrink-0" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-jersey text-3xl text-white tracking-wide">
                {pipeline?.name}
              </h1>

              {/* 1. Framework badge (First) */}
              {pipeline?.framework && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${
                    pipeline.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                  }`}
                >
                  <Icon icon={pipeline.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                  <span>{pipeline.framework.toLowerCase()}</span>
                </span>
              )}

              {/* 2. Docker badge (Second) */}
              {pipeline?.isDocker && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300">
                  <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                  <span>docker</span>
                </span>
              )}

              {/* 3. Pipeline status badge (Third, without dots) */}
              {isBlockedDanger ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-rose-500/[0.15] border border-rose-500/30 text-[10.5px] font-mono text-rose-300">
                  <Icon icon="lucide:shield-alert" width={12} height={12} className="text-rose-400" />
                  <span>blocked: danger</span>
                </span>
              ) : isSuccess ? (
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

              {/* 4. Branch & Port badge */}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/70">
                <Icon icon="lucide:git-branch" width={11} height={11} className="text-white/40" />
                <span>{pipeline?.branch}</span>
                <span className="text-white/30">:{pipeline?.port}</span>
              </span>

              {/* 5. AutoDeploy Webhook badge */}
              {pipeline?.autoDeploy && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/[0.08] border border-amber-500/20 text-[10px] font-mono text-amber-300">
                  <Icon icon="lucide:zap" width={10} height={10} className="text-amber-400" />
                  <span>auto-deploy on push</span>
                </span>
              )}
            </div>

            <p className="text-[11px] font-mono text-white/40 truncate mt-0.5">
              {pipeline?.repoUrl} · Port :{pipeline?.port}
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          {effectiveAppUrl && pipeline?.deployment?.status === "healthy" && (
            <a
              href={effectiveAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span>Open App ↗</span>
            </a>
          )}

          {isFailed && latestRun && (
            <button
              onClick={() => setDiagnoseRun(latestRun)}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
            >
              <span>⚡</span>
              <span>AI Troubleshoot</span>
            </button>
          )}

          <button
            onClick={() => {
              setSettingsPortError(null);
              setSettingsError(null);
              setShowSettingsModal(true);
            }}
            className="ray-btn-ghost flex items-center gap-1.5 text-xs px-3 py-2 cursor-pointer"
            title="Configure Pipeline Settings"
          >
            <Icon icon="lucide:settings" width={13} height={13} />
            <span>Settings</span>
          </button>

          <button
            onClick={handleTrigger}
            disabled={triggering || isRunning}
            className="ray-btn-primary flex items-center gap-1.5 text-xs px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            {triggering || isRunning ? (
              <>
                <SpinIcon size={12} />
                <span>Running Build…</span>
              </>
            ) : (
              <>
                <Icon icon="lucide:play" width={12} height={12} />
                <span>Trigger Pipeline Run</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Trigger Execution Alerts */}
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

      {triggerSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center justify-between gap-3 shadow-lg shadow-emerald-950/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon icon="lucide:check-circle-2" width={16} height={16} className="shrink-0 text-emerald-400" />
            <span className="font-medium">{triggerSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setTriggerSuccess(null)}
            className="text-white/40 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Dismiss"
          >
            <Icon icon="lucide:x" width={14} height={14} />
          </button>
        </div>
      )}

      {/* Dual Consent Deployment Override Card (Shown when pipeline is blocked by danger findings) */}
      {isBlockedDanger && (
        <div className="rounded-2xl p-6 bg-gradient-to-b from-rose-950/20 to-black/40 border border-rose-500/30 shadow-lg shadow-rose-950/20 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
              <Icon icon="lucide:shield-alert" width={22} height={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-sans font-bold text-base text-white">
                  Deployment Blocked: Critical Security Vulnerability
                </h3>
                <span className="text-[10.5px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold uppercase">
                  Danger Level
                </span>
              </div>
              <p className="text-xs text-white/70 leading-relaxed mb-4">
                The pre-deployment Security Audit identified critical vulnerabilities (known CVEs or exposed sensitive secrets). Automatic deployment was automatically stopped to prevent security compromise. To deploy anyway, explicit dual confirmation consent is required by protocol.
              </p>

              {overrideError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <Icon icon="lucide:alert-circle" width={14} height={14} className="shrink-0" />
                  <span>{overrideError}</span>
                </div>
              )}

              {/* Dual-Consent Form */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Confirmation 1: Risk Acknowledgment Checkbox */}
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    id="overrideAckRiskCheckbox"
                    checked={overrideAckRisk}
                    onChange={(e) => setOverrideAckRisk(e.target.checked)}
                    className="mt-0.5 rounded bg-[#181818] border-white/20 text-rose-500 focus:ring-rose-500 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white block">
                      Confirmation 1 of 2: Acknowledge Security Risk
                    </span>
                    <span className="text-white/50 text-[11px]">
                      I understand the DANGER severity findings and authorize deployment knowing the risk of exploitation.
                    </span>
                  </div>
                </label>

                {/* Confirmation 2: Force Deploy Button */}
                <div className="flex items-center gap-3 shrink-0">
                  <Link
                    href={`/projects/${pipeline?.projectId || pipeline?.id}?tab=security`}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/[0.04] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all flex items-center gap-1.5"
                  >
                    <Icon icon="lucide:file-text" width={13} height={13} />
                    <span>Review Audit Logs</span>
                  </Link>

                  <button
                    onClick={handleOverrideDeploy}
                    disabled={!overrideAckRisk || overrideSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 active:scale-95 text-white transition-all shadow-md shadow-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                  >
                    {overrideSubmitting ? (
                      <>
                        <SpinIcon size={12} />
                        <span>Authorizing Deploy…</span>
                      </>
                    ) : (
                      <>
                        <Icon icon="lucide:alert-triangle" width={13} height={13} />
                        <span>Confirmation 2: Authorize & Force Deploy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Visual Pipeline DAG Stage Workflow Tracker */}
      <div className="rounded-2xl p-6 bg-card border border-card-border shadow-sm mb-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-sans font-bold text-base text-white tracking-tight">Pipeline DAG Execution Flow</h2>
            <p className="text-xs text-white/40 mt-0.5">Automated compilation, containerization, and deployment stages</p>
          </div>
          <span className="text-[11px] font-mono font-semibold text-white/40 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            {isBlockedDanger ? "Blocked on Security Danger" : isRunning ? "Pipeline Active" : isSuccess ? "All 6 Stages Passed" : isFailed ? "Halted on Error" : "Standby"}
          </span>
        </div>

        {/* 6 Stage Connected Flow */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 relative">
          {PIPELINE_STAGES.map((st, idx) => {
            // Parse run stages if available
            let parsedStages: any[] = [];
            try {
              if (latestRun?.stages) parsedStages = JSON.parse(latestRun.stages);
            } catch { /* fallback */ }

            let stageState: "success" | "running" | "failed" | "blocked" | "idle" = "idle";
            const stageObj = parsedStages.find((s: any) =>
              s.name?.toLowerCase().includes(st.name.toLowerCase().split(" ")[0]) ||
              s.id === st.id
            );

            if (stageObj) {
              if (stageObj.status === "success" || stageObj.status === "passed" || stageObj.status === "overridden") {
                stageState = "success";
              } else if (stageObj.status === "running") {
                stageState = "running";
              } else if (stageObj.status === "blocked_danger" || stageObj.status === "blocked") {
                stageState = "blocked";
              } else if (stageObj.status === "failed") {
                stageState = "failed";
              } else {
                stageState = "idle";
              }
            } else {
              if (isSuccess) {
                stageState = "success";
              } else if (isBlockedDanger) {
                if (idx < 2) stageState = "success";
                else if (idx === 2) stageState = "blocked";
                else stageState = "idle";
              } else if (isFailed) {
                stageState = idx === 3 ? "failed" : idx < 3 ? "success" : "idle";
              } else if (isRunning) {
                stageState = idx === 3 ? "running" : idx < 3 ? "success" : "idle";
              }
            }

            return (
              <div
                key={st.id}
                className="relative rounded-2xl p-4 bg-card border transition-all flex flex-col justify-between"
                style={{
                  borderColor:
                    stageState === "blocked"
                      ? "rgba(244,63,94,0.6)"
                      : stageState === "running"
                      ? "rgba(56,189,248,0.4)"
                      : stageState === "success"
                      ? "rgba(34,197,94,0.3)"
                      : stageState === "failed"
                      ? "rgba(239,68,68,0.4)"
                      : "rgba(255,255,255,0.06)",
                  boxShadow:
                    stageState === "blocked"
                      ? "0 0 25px rgba(244,63,94,0.2)"
                      : stageState === "running"
                      ? "0 0 20px rgba(56,189,248,0.15)"
                      : stageState === "success"
                      ? "0 0 15px rgba(34,197,94,0.08)"
                      : "none",
                }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[10px] font-mono font-bold text-white/30">0{idx + 1}</span>
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${
                        stageState === "blocked"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                          : stageState === "running"
                          ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse"
                          : stageState === "success"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : stageState === "failed"
                          ? "bg-red-500/15 text-red-400 border border-red-500/30"
                          : "bg-white/[0.04] text-white/40 border border-white/[0.08]"
                      }`}
                    >
                      {stageState === "blocked" ? (
                        <Icon icon="lucide:shield-alert" width={13} height={13} />
                      ) : stageState === "running" ? (
                        <SpinIcon size={12} />
                      ) : stageState === "success" ? (
                        <Icon icon="lucide:check" width={13} height={13} />
                      ) : stageState === "failed" ? (
                        <Icon icon="lucide:x" width={13} height={13} />
                      ) : (
                        <Icon icon={st.icon} width={13} height={13} />
                      )}
                    </div>
                  </div>

                  <h3 className="font-sans font-bold text-xs text-white tracking-tight">{st.name}</h3>
                  <p className="text-[10.5px] text-white/40 mt-0.5 leading-snug">{st.desc}</p>
                </div>

                <div className="mt-4 pt-2.5 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono">
                  <span
                    className={`font-semibold uppercase tracking-wider ${
                      stageState === "blocked"
                        ? "text-rose-400 font-bold"
                        : stageState === "running"
                        ? "text-sky-400"
                        : stageState === "success"
                        ? "text-emerald-400"
                        : stageState === "failed"
                        ? "text-red-400"
                        : "text-white/30"
                    }`}
                  >
                    {stageState === "blocked" ? "BLOCKED: DANGER" : stageState === "running" ? "Building…" : stageState}
                  </span>
                  <span className="text-white/20">Stage {idx + 1}/6</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* GitHub Webhook Trigger & Automation Card */}
      <div className="rounded-2xl p-6 bg-card border border-card-border shadow-sm mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.06] mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Icon icon="logos:github-icon" width={16} height={16} />
              <h2 className="font-sans font-bold text-base text-white tracking-tight">GitHub Webhook Automation</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Live Listener Active
              </span>
            </div>
            <p className="text-xs text-white/50">
              When developers push commits to GitHub, Ray receives the webhook and automatically initiates a build.
            </p>
          </div>

          <button
            onClick={handleToggleAutoDeploy}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 cursor-pointer flex-shrink-0 ${
              pipeline?.autoDeploy
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
                : "bg-white/[0.05] text-white/50 border-white/10 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${pipeline?.autoDeploy ? "bg-amber-400 animate-pulse" : "bg-white/30"}`} />
            <span>Auto-deploy: {pipeline?.autoDeploy ? "Enabled" : "Disabled"}</span>
          </button>
        </div>

        {/* Webhook URL Input & 1-Click Copy */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="relative flex-1">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="w-full bg-[#141414] border border-white/10 focus:border-white/20 focus:outline-none text-xs font-mono text-white/90 rounded-xl py-2.5 px-3.5 select-all"
            />
          </div>
          <button
            onClick={copyWebhook}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            {copiedWebhook ? (
              <>
                <Icon icon="lucide:check" width={13} height={13} />
                <span>Copied Webhook URL!</span>
              </>
            ) : (
              <>
                <Icon icon="lucide:copy" width={13} height={13} />
                <span>Copy Payload URL</span>
              </>
            )}
          </button>
        </div>

        {/* Quick Instructions Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-[11px] text-white/50">
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <strong className="text-white/80 block mb-0.5">1. Open Repo Webhooks</strong>
            <span>Go to GitHub repo → Settings → Webhooks → Add webhook</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <strong className="text-white/80 block mb-0.5">2. Paste Payload URL</strong>
            <span>Set Payload URL above, content type to <code>application/json</code></span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <strong className="text-white/80 block mb-0.5">3. Just Push Events</strong>
            <span>Ray automatically builds Docker image on each push</span>
          </div>
        </div>
      </div>

      {/* Execution Run History & Live Logs Console */}
      <div className="rounded-2xl p-6 bg-card border border-card-border shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-sans font-bold text-base text-white tracking-tight">Execution Run History</h2>
            <p className="text-xs text-white/40 mt-0.5">Detailed build logs, commits, and diagnostic traces</p>
          </div>
          <span className="text-xs text-white/40 font-mono">
            {pipeline?.runs?.length || 0} build execution{pipeline?.runs?.length !== 1 ? "s" : ""} recorded
          </span>
        </div>

        {(!pipeline?.runs || pipeline.runs.length === 0) ? (
          <div className="p-8 rounded-xl border border-card-border bg-card text-center text-xs text-white/40">
            No pipeline runs recorded yet. Click <strong>Trigger Pipeline Run</strong> above to initiate a build.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pipeline.runs.map((run: any) => {
              const isExpanded = expandedRunId === run.id;
              const isRunFailed = run.status === "failed";
              const isRunSuccess = run.status === "success";
              const isRunRunning = run.status === "running";

              return (
                <div
                  key={run.id}
                  className="rounded-2xl border transition-all overflow-hidden"
                  style={{
                    background: "#0f0f0f",
                    borderColor: isExpanded ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)",
                    boxShadow: isExpanded ? "0 10px 30px rgba(0,0,0,0.8)" : "none",
                  }}
                >
                  {/* Run Header Row */}
                  <div
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          isRunRunning
                            ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                            : isRunSuccess
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-red-500/15 text-red-300 border border-red-500/30"
                        }`}
                      >
                        {isRunRunning ? (
                          <SpinIcon size={12} />
                        ) : isRunSuccess ? (
                          <Icon icon="lucide:check" width={13} height={13} />
                        ) : (
                          <Icon icon="lucide:alert-triangle" width={13} height={13} />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-sans font-bold text-xs text-white truncate">
                            {run.commitMessage || "Pipeline build run"}
                          </p>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.04] text-white/50 border border-white/[0.06]">
                            {run.commitHash?.slice(0, 7) || "manual"}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-white/40 mt-0.5">
                          Author: {run.author || "Developer"} · {new Date(run.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isRunFailed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDiagnoseRun(run);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                        >
                          <span>⚡</span>
                          <span>AI Troubleshoot</span>
                        </button>
                      )}

                      <span
                        className={`text-[10.5px] font-mono font-bold px-2.5 py-0.5 rounded uppercase tracking-wider ${
                          isRunSuccess
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : isRunRunning
                            ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}
                      >
                        {run.status}
                      </span>

                      <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 text-white/40 hover:text-white transition-colors">
                        <Icon
                          icon="lucide:chevron-down"
                          width={14}
                          height={14}
                          className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Build Console Logs */}
                  {isExpanded && (
                    <div className="border-t border-white/[0.06] bg-[#050505]">
                      {isRunFailed && (
                        <div className="p-3.5 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-red-300 font-mono">
                            <span>⚠️</span>
                            <span>Build run encountered an error. Ray AI Troubleshooter can diagnose root cause.</span>
                          </div>
                          <button
                            onClick={() => setDiagnoseRun(run)}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-red-500/25 text-red-200 hover:bg-red-500/35 border border-red-500/40 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            <span>⚡</span>
                            <span>Diagnose with Ray AI</span>
                          </button>
                        </div>
                      )}

                      <div className="p-4 font-mono text-xs max-h-96 overflow-y-auto leading-relaxed text-[#e2e8f0] select-text">
                        <div className="flex items-center justify-between text-[11px] text-white/40 mb-2 pb-1.5 border-b border-white/[0.04]">
                          <span>── Build Execution Logs ────────────────────────────</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(run.logs || "");
                              setCopiedLogs(true);
                              setTimeout(() => setCopiedLogs(false), 2000);
                            }}
                            className="px-2.5 py-0.5 rounded text-[10px] font-semibold bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
                          >
                            {copiedLogs ? "Copied!" : "Copy Logs"}
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap font-mono">
                          {run.logs || "No detailed output logs recorded for this execution run."}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings Modal - Full Viewport Coverage */}
      {showSettingsModal && (
        <div
          className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in font-sans"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettingsModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl p-6 bg-card border border-card-border shadow-2xl">
            <h2 className="font-jersey text-2xl text-white tracking-wide mb-1">Pipeline Settings</h2>
            <p className="text-xs text-white/50 mb-5 font-normal">
              Update build configuration and branch triggers for <strong>{pipeline?.name}</strong>.
            </p>

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                  Target Branch
                </label>
                <input
                  type="text"
                  required
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                  className="w-full bg-[#141414] border border-white/10 focus:border-white/25 focus:outline-none text-xs font-mono text-white rounded-lg py-2 px-3 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                  Host Port
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={editPort}
                  onChange={(e) => {
                    const val = e.target.value === "" ? "" : Number(e.target.value);
                    setEditPort(val as any);
                    if (settingsPortError) {
                      const check = validateTcpPort(val);
                      if (check.valid) {
                        setSettingsPortError(null);
                      }
                    }
                  }}
                  onBlur={() => {
                    const check = validateTcpPort(editPort);
                    if (!check.valid) {
                      setSettingsPortError(check.error || "Port must be an integer between 1 and 65535");
                    } else {
                      setSettingsPortError(null);
                    }
                  }}
                  className={`w-full bg-[#141414] border text-xs font-mono text-white rounded-lg py-2 px-3 transition-all focus:outline-none ${
                    settingsPortError
                      ? "border-rose-500/60 focus:border-rose-500 text-rose-200"
                      : "border-white/10 focus:border-white/25"
                  }`}
                  placeholder="3000"
                />
                {settingsPortError ? (
                  <p className="text-[11px] text-rose-400 mt-1.5 flex items-center gap-1">
                    <Icon icon="lucide:alert-circle" width={12} height={12} />
                    <span>{settingsPortError}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-white/30 mt-1 font-mono">
                    Valid TCP port between 1 and 65535
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                  Dockerfile Path
                </label>
                <input
                  type="text"
                  value={editDockerfile}
                  onChange={(e) => setEditDockerfile(e.target.value)}
                  className="w-full bg-[#141414] border border-white/10 focus:border-white/25 focus:outline-none text-xs font-mono text-white rounded-lg py-2 px-3 transition-all"
                />
              </div>

              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <input
                  type="checkbox"
                  id="autoDeployEditCheckbox"
                  checked={editAutoDeploy}
                  onChange={(e) => setEditAutoDeploy(e.target.checked)}
                  className="rounded bg-[#141414] border-white/20 text-white focus:ring-0 cursor-pointer"
                />
                <label htmlFor="autoDeployEditCheckbox" className="text-xs text-white/80 cursor-pointer select-none">
                  Enable automated webhook deployment on <code className="text-[11px] text-white">git push</code>
                </label>
              </div>

              {settingsError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <Icon icon="lucide:alert-circle" width={14} height={14} className="shrink-0 text-rose-400" />
                  <span>{settingsError}</span>
                </div>
              )}

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="ray-btn-ghost flex-1 py-2 text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="ray-btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {savingSettings && <SpinIcon />}
                  <span>Save Settings</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ray AI Troubleshooter Modal - Full Viewport Coverage */}
      <DeployDiagnosisModal
        isOpen={!!diagnoseRun}
        onClose={() => setDiagnoseRun(null)}
        deploymentName={pipeline?.name ? `${pipeline.name} (Run ${diagnoseRun?.commitHash?.slice(0, 7) || ""})` : "Pipeline Run"}
        buildLogs={diagnoseRun?.logs || undefined}
        onRedeploySuccess={() => {
          fetchPipeline();
        }}
      />
    </div>
  );
}
