"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { type ChatDeploymentDraft } from "@/lib/chat-deployment-draft";
import { Icon } from "@iconify/react";
import { readDroppedFiles } from "@/lib/upload-drop";
import { validateTcpPort } from "@/lib/port-validator";
import { FRAMEWORK_TEMPLATE_NOTES } from "@/lib/framework-registry";
import DeploymentServiceFields from "@/components/DeploymentServiceFields";
import { defaultProjectSetup, parseProjectSetup, type ProjectSetup } from "@/lib/project-setup";
import { uploadWithProgress } from "@/lib/upload-progress";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";
import SearchableFrameworkSelect from "@/components/SearchableFrameworkSelect";
import DeploymentPipelineFlow from "@/components/DeploymentPipelineFlow";

interface AnalysisResult {
  projectPath: string;
  sourceRoot: string;
  appDirectory: string;
  framework: string;
  frameworkSlug: string;
  language: string;
  icon: string;
  colorClasses: string;
  hasDockerfile: boolean;
  isMonorepo: boolean;
  startCommand: string;
  dockerfileContent: string | null;
  containerPort: number;
  suggestedPort: number;
  filesSummary: string[];
}

interface EnvVarItem {
  id: string;
  key: string;
  value: string;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// Crisp pure-white GitHub icon
const WhiteGitHubIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-white shrink-0">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

export default function DeploymentWizard({ embedded = false, initialSource = "", initialName = "", initialDraft, onDraftChange, onDeploymentCreated }: {
 embedded?: boolean; initialSource?: string; initialName?: string; initialDraft?: ChatDeploymentDraft;
 onDraftChange?: (draft: ChatDeploymentDraft) => void; onDeploymentCreated?: (id: string) => void;
}) {
  const setupDefaults = () => ({ ...defaultProjectSetup(), ...(initialDraft ? { framework: initialDraft.framework, dockerEnabled: initialDraft.dockerEnabled, projectUrl: initialDraft.projectUrl, routingMode: initialDraft.routingMode } : {}) });
  // ─── Step Management ────────────────────────────────────────────────────────
  // Step 1: Select Source Code (Drag & Drop or Git)
  // Step 2: Configuration & Review
  // Step 3: Deploy & Pipeline Logs
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  // Source selection mode on Step 1: "upload" (ZIP/folder) or "git" (GitHub)
  const [sourceMode, setSourceMode] = useState<"upload" | "git">("upload");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Advanced accordion state on Step 2
  const [showAdvanced, setShowAdvanced] = useState(embedded);
  const [reviewed, setReviewed] = useState(false);

  // Git source state
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [preparedGit, setPreparedGit] = useState<{ preparedSource: string; repoUrl: string; branch: string; commitHash: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = embedded ? (initialSource.startsWith("https://") ? initialSource : "") : params.get("repo") || "";
    const branch = embedded ? "" : params.get("branch") || "";
    if (url) {
      setRepoUrl(url);
      setRepoBranch(branch);
      setSourceMode("git");
    }
  }, [embedded, initialSource]);

  // Uploaded files state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);

  // Project configuration
  const [projectName, setProjectName] = useState(initialDraft?.projectName || initialName);
  const [customPort, setCustomPort] = useState<string>(initialDraft?.customPort || "");
  const [internalPort, setInternalPort] = useState(initialDraft?.internalPort || "");
  const [setup, setSetup] = useState<ProjectSetup>(setupDefaults);
  const [envVars, setEnvVars] = useState<EnvVarItem[]>([]);
  const [appDirectory, setAppDirectory] = useState(initialDraft?.appDirectory || ".");

  // Flow State
  const [flowState, setFlowState] = useState<"idle" | "uploading" | "analyzing" | "ready" | "deploying" | "success" | "error">("idle");
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number | null }>({ loaded: 0, total: null });
  const [uploadTransferred, setUploadTransferred] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);

  const [localSource, setLocalSource] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [buildLogs, setBuildLogs] = useState("");
  const [currentStep, setCurrentStep] = useState<string>("source_check");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [containerName, setContainerName] = useState<string | null>(null);
  const [deployedId, setDeployedId] = useState<string | null>(null);

  // Docker daemon status
  const [dockerRunning, setDockerRunning] = useState<boolean | null>(null);
  const [startingDocker, setStartingDocker] = useState(false);

  // AI Troubleshoot Modal
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);

  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Check Docker daemon on mount
  const checkDockerStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/docker/ensure");
      if (res.ok) {
        const data = await res.json();
        setDockerRunning(Boolean(data.running));
      }
    } catch {
      setDockerRunning(false);
    }
  }, []);

  useEffect(() => {
    checkDockerStatus();
  }, [checkDockerStatus]);

  const handleStartDocker = async () => {
    setStartingDocker(true);
    try {
      const res = await fetch("/api/docker/ensure", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDockerRunning(Boolean(data.running));
      }
    } catch {
      // silent
    } finally {
      setStartingDocker(false);
    }
  };

  // Handle Zip file selection
  const handleZipSelected = (file: File) => {
    if (!/\.zip$/i.test(file.name) || file.size === 0) {
      setErrorMessage("Choose a non-empty .zip archive, or drop a folder.");
      setFlowState("error");
      return;
    }
    setSelectedFile(file);
    setSelectedFolderFiles([]);
    const defaultName = file.name.replace(/\.(zip|tar\.gz|tar)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    setProjectName(initialDraft?.projectName || defaultName);
    processUpload(file, null, defaultName);
  };

  // Handle Folder selection
  const handleFolderSelected = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setSelectedFolderFiles(fileArray);
    setSelectedFile(null);

    const firstRel = (fileArray[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    let folderName = "my-app";
    if (firstRel) {
      folderName = firstRel.split("/")[0].replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    }
    setProjectName(initialDraft?.projectName || folderName);
    processUpload(null, fileArray, folderName);
  };

  // Process and analyze upload
  const processUpload = async (zipFile: File | null, folderFiles: File[] | null, name: string) => {
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    setUploadProgress({ loaded: 0, total: null });
    setUploadTransferred(false);

    setPreparedGit(null);
    setLocalSource(false);
    setFlowState("uploading");
    setErrorMessage("");
    setAnalysis(null);
    setInternalPort(initialDraft?.internalPort || "");
    setSetup(setupDefaults());

    try {
      const formData = new FormData();
      formData.set("name", name || "app");
      if (zipFile) {
        try { await zipFile.slice(0, 4).arrayBuffer(); } catch {
          throw new Error("The browser cannot read this ZIP. Save it locally, then select it again using the file picker.");
        }
        formData.set("zip", zipFile);
      } else if (folderFiles && folderFiles.length > 0) {
        formData.set("filePaths", JSON.stringify(folderFiles.map(file => file.webkitRelativePath || file.name)));
        for (const file of folderFiles) {
          formData.append("files", file, file.webkitRelativePath || file.name);
        }
      } else {
        throw new Error("No files selected");
      }

      const uploadRes = await uploadWithProgress(formData,
        (loaded, total) => setUploadProgress({ loaded, total }),
        () => setUploadTransferred(true), controller.signal);
      if (controller.signal.aborted) return;

      const uploadData = await uploadRes.json().catch(() => ({
        error: uploadRes.status === 413
          ? "The upload was rejected as too large. Check the server and reverse-proxy upload limits."
          : `Upload returned an unexpected response (HTTP ${uploadRes.status}). Check the server logs.`,
      }));
      if (!uploadRes.ok || !uploadData.projectPath) {
        throw new Error(uploadData.error || "Upload failed");
      }

      const projectPath = uploadData.projectPath;
      setFlowState("analyzing");

      // Analyze codebase
      const analyzeRes = await fetch("/api/deploy/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath }),
        signal: controller.signal,
      });

      const analyzeData = await analyzeRes.json();
      if (controller.signal.aborted) return;
      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || "Codebase analysis failed");
      }

      setAnalysis(analyzeData);
      setAppDirectory(initialDraft?.appDirectory || analyzeData.appDirectory);
      setCustomPort(initialDraft?.customPort || String(analyzeData.suggestedPort || 4050));
      setFlowState("ready");
      // Automatically advance to Step 2
      setActiveStep(2);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      console.error("Upload error:", err);
      setErrorMessage(err instanceof TypeError && /fetch|network/i.test(err.message)
        ? "The upload connection closed before the server responded. Reselect the ZIP using the file picker."
        : (err as Error).message || "An error occurred while preparing files");
      setFlowState("error");
    }
  };

  const prepareGitHub = async () => {
    setLocalSource(false);
    setFlowState("analyzing");
    setErrorMessage("");
    setAnalysis(null);
    setPreparedGit(null);
    setSelectedFile(null);
    setSelectedFolderFiles([]);
    setInternalPort(initialDraft?.internalPort || "");
    setSetup(setupDefaults());
    try {
      const response = await fetch("/api/deploy/prepare-git", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, branch: repoBranch }),
      });
      const source = await response.json();
      if (!response.ok) throw new Error(source.error || "Could not prepare repository");
      const analyze = await fetch("/api/deploy/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRoot: source.sourceRoot }),
      });
      const data = await analyze.json();
      if (!analyze.ok) throw new Error(data.error || "Could not analyze repository");
      setPreparedGit(source);
      setProjectName(initialDraft?.projectName || source.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
      setAnalysis(data);
      setAppDirectory(initialDraft?.appDirectory || data.appDirectory);
      setCustomPort(initialDraft?.customPort || String(data.suggestedPort || 4050));
      setFlowState("ready");
      // Automatically advance to Step 2
      setActiveStep(2);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not prepare repository");
      setFlowState("error");
    }
  };

  const analyzeDirectory = async () => {
    if (!analysis || analysisBusy) return;
    setAnalysisBusy(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/deploy/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceRoot: analysis.sourceRoot, appDirectory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not analyze directory");
      setAnalysis(data);
      setInternalPort(initialDraft?.internalPort || "");
      setAppDirectory(data.appDirectory);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not analyze directory");
    } finally { setAnalysisBusy(false); }
  };

  // Helper to update setup fields
  const updateSetup = (key: keyof ProjectSetup, val: unknown) => {
    setSetup((prev) => ({ ...prev, [key]: val }));
  };

  useEffect(() => { setReviewed(false); }, [projectName, setup, customPort, internalPort, envVars, appDirectory, analysis]);

  useEffect(() => {
    if (!onDraftChange) return;
    const timer = setTimeout(() => onDraftChange({ projectName, customPort, internalPort, appDirectory,
      framework: setup.framework, dockerEnabled: setup.dockerEnabled, projectUrl: setup.projectUrl, routingMode: setup.routingMode }), 400);
    return () => clearTimeout(timer);
  }, [projectName, customPort, internalPort, appDirectory, setup.framework, setup.dockerEnabled, setup.projectUrl, setup.routingMode, onDraftChange]);

  // Trigger Container Deployment
  const handleDeploy = async () => {
    if (!analysis || analysisBusy || appDirectory !== analysis.appDirectory || !projectName.trim() || (embedded && !reviewed)) return;

    const portCheck = validateTcpPort(customPort || analysis.suggestedPort);
    if (!portCheck.valid) { setErrorMessage(portCheck.error || "Choose a valid host port"); return; }
    if (internalPort && !validateTcpPort(internalPort).valid) {
      setErrorMessage("Internal port must be a whole number between 1 and 65535."); return;
    }
    if (!setup.dockerEnabled && !setup.startCommand.trim()) {
      setErrorMessage("Enter a production start command before deploying without Docker."); return;
    }

    setFlowState("deploying");
    setActiveStep(3);
    setErrorMessage("");
    setBuildLogs("[INIT] Starting application deployment pipeline...\n");
    setCurrentStep("source_check");

    // Pre-flight check: ensure Docker is running if enabled
    if (setup.dockerEnabled && !dockerRunning) {
      setBuildLogs((prev) => prev + "[SYSTEM] Docker daemon is offline. Attempting automated startup...\n");
      try {
        const dockerRes = await fetch("/api/docker/ensure", { method: "POST" });
        const dockerData = await dockerRes.json();
        if (dockerData.running) {
          setDockerRunning(true);
          setBuildLogs((prev) => prev + "✓ Docker daemon successfully started.\n");
        } else {
          throw new Error("Docker daemon is offline. Please launch Docker Desktop and retry.");
        }
      } catch (dErr: unknown) {
        const msg = (dErr as Error).message || "Could not start Docker";
        setBuildLogs((prev) => prev + `[ERROR] ${msg}\n`);
        setErrorMessage(msg);
        setFlowState("error");
        return;
      }
    }

    // Format env vars object
    const envObj: Record<string, string> = {};
    for (const item of envVars) {
      if (item.key.trim()) {
        envObj[item.key.trim()] = item.value;
      }
    }

    const hostPort = portCheck.port!;

    try {
      const deployRes = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName || "app",
          projectPath: analysis.projectPath,
          sourceType: preparedGit ? "github" : localSource ? "local" : "upload",
          preparedSource: preparedGit?.preparedSource,
          appDirectory: analysis.appDirectory,
          setup: parseProjectSetup({
            ...setup,
            sourceRoot: analysis.sourceRoot,
            appDirectory: analysis.appDirectory,
            hostPort,
            containerPort: internalPort ? Number(internalPort) : null,
            envVars: envObj,
          }),
          hostPort,
          containerPort: internalPort ? Number(internalPort) : undefined,
          envVars: Object.keys(envObj).length > 0 ? envObj : undefined,
        }),
      });

      if (!deployRes.ok) {
        const errJson = await deployRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Deployment error (status ${deployRes.status})`);
      }

      const depId = deployRes.headers.get("X-Deployment-ID");
      if (depId) { setDeployedId(depId); onDeploymentCreated?.(depId); }

      // Read SSE stream
      const reader = deployRes.body?.getReader();
      if (!reader) throw new Error("Could not read deployment log stream");

      const decoder = new TextDecoder();
      let streamBuffer = "";
      let completed = false;
      let failed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.step && !["failed", "rollback"].includes(event.step)) setCurrentStep(event.step);
              if (event.logDelta) {
                setBuildLogs((prev) => prev + event.logDelta);
              } else if (event.message) {
                setBuildLogs((prev) => prev + `[${(event.step || "deploy").toUpperCase()}] ${event.message}\n`);
              }

              if (event.step === "complete" && event.status === "success" && !failed) {
                completed = true;
                if (event.url) setLiveUrl(event.url);
                if (event.container) setContainerName(event.container);
                setFlowState("success");
              } else if (event.step === "failed" || event.status === "error") {
                failed = true;
                completed = false;
                setErrorMessage(event.message || "Deployment failed.");
                setFlowState("error");
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }

      if (!completed && !failed) {
        throw new Error("Deployment stream ended before completion. Check the deployment logs.");
      }

    } catch (err: unknown) {
      console.error("Deploy error:", err);
      const msg = (err as Error).message || "Deployment failed";
      setErrorMessage(msg);
      setBuildLogs((prev) => prev + `\n[ERROR] ${msg}\n`);
      setFlowState("error");
    }
  };

  const addEnvVar = () => {
    setEnvVars((prev) => [...prev, { id: `env-${Date.now()}-${Math.random()}`, key: "", value: "" }]);
  };

  const updateEnvVar = (id: string, field: "key" | "value", val: string) => {
    setEnvVars((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: val } : item)));
  };

  const removeEnvVar = (id: string) => {
    setEnvVars((prev) => prev.filter((item) => item.id !== id));
  };

  const prepareLocalSource = async () => {
    setFlowState("analyzing"); setErrorMessage("");
    try {
      const response = await fetch("/api/deploy/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectPath: initialSource }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not analyze source");
      setLocalSource(true); setPreparedGit(null); setAnalysis(data); setAppDirectory(initialDraft?.appDirectory || data.appDirectory);
      setCustomPort(initialDraft?.customPort || String(data.suggestedPort || 4050)); setFlowState("ready"); setActiveStep(2);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : "Could not prepare source"); setFlowState("error"); }
  };
  return (
    <div className={embedded ? "font-sans py-4" : "flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 font-sans"}>
      {embedded && activeStep === 1 && initialSource.startsWith("/") && <div className="ray-card p-4 mb-4"><p className="text-xs text-white/60 break-all mb-3">Server folder: {initialSource}</p><button type="button" className="ray-btn-primary text-xs" disabled={flowState === "analyzing"} onClick={prepareLocalSource}>Analyze this folder</button></div>}
      {/* ─── Breadcrumb & Top Bar ───────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/deployments"
              className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Deployments</span>
            </Link>
            <span className="text-white/20">/</span>
            <span className="text-xs text-white/80 font-medium">New Deployment</span>
          </div>
          <h1 className={embedded ? "font-sans text-lg font-semibold text-white" : "font-jersey text-3xl sm:text-4xl text-white tracking-wide"}>
            Deploy Application
          </h1>
          <p className="text-xs text-white/50 mt-0.5 font-normal">
            Upload a folder or ZIP file, or link a Git repository. Ray auto-detects the framework and launches isolated containers.
          </p>
        </div>
      </div>

      <nav aria-label="Deployment setup" className="max-w-3xl mx-auto mb-8">
        <ol className="grid grid-cols-3 gap-3">
          {["Source", "Configuration", "Deployment"].map((label, index) => {
            const step = index + 1;
            return <li key={label} aria-current={activeStep === step ? "step" : undefined} className={`border-t-2 pt-3 ${activeStep === step ? "border-white text-white" : activeStep > step ? "border-emerald-500/60 text-white/60" : "border-white/10 text-white/40"}`}>
              <button type="button" disabled={!(step === 1 && activeStep === 2 && flowState !== "deploying")} onClick={() => setActiveStep(1)} className="flex items-center gap-2 text-xs sm:text-sm font-medium disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                <span className="text-[11px] font-mono opacity-60">{activeStep > step ? "✓" : `0${step}`}</span>{label}
              </button>
            </li>;
          })}
        </ol>
      </nav>

      {/* ─── Centered Container ──────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto flex flex-col gap-6">

        {/* ══════════════════════════════════════════════════════════════════════
            STEP 1: SELECT SOURCE CODE (Upload ZIP/Folder or Git)
            Only visible when activeStep === 1
           ══════════════════════════════════════════════════════════════════════ */}
        {activeStep === 1 && (
          <div className="rounded-2xl border border-white/[0.08] bg-[#090909] p-6 sm:p-8 animate-fade-in relative shadow-xl">
            {/* Step 1 Header */}
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <span className="ray-eyebrow">Step 1 of 3</span>
                <h2 className="text-2xl font-bold text-white tracking-wide mt-0.5">
                  Select Source Code
                </h2>
                <p className="text-xs text-white/50 mt-1">
                  Choose a project folder, compressed .zip archive, or connect a remote Git repository.
                </p>
              </div>

              {/* Source Mode Switcher Pill */}
              <div className="flex items-center p-1 rounded-xl bg-black border border-white/[0.08] text-xs">
                <button
                  type="button"
                  onClick={() => setSourceMode("upload")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    sourceMode === "upload"
                      ? "bg-white/[0.1] text-white font-semibold"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  <Icon icon="lucide:archive" width={13} height={13} />
                  <span>Upload</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("git")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    sourceMode === "git"
                      ? "bg-white/[0.1] text-white font-semibold"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  <WhiteGitHubIcon size={13} />
                  <span>Git Repo</span>
                </button>
              </div>
            </div>

            {/* Error Message if any */}
            {errorMessage && flowState === "error" && (
              <div role="alert" className="mb-4 p-3.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-xs text-red-300 flex items-center gap-2">
                <Icon icon="lucide:alert-circle" width={15} height={15} className="shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Uploading / Analyzing Status Banner */}
            {(flowState === "uploading" || flowState === "analyzing") && (
              <div className="mb-5 p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-4" aria-busy="true">
                {sourceMode === "upload" && <div>
                  <div className="flex justify-between gap-3 text-xs mb-2">
                    <span className="font-medium text-white">{uploadTransferred || flowState === "analyzing" ? "Upload complete" : "Uploading files"}</span>
                    <span className="text-white/60 tabular-nums">{uploadTransferred || flowState === "analyzing" ? "100%" : uploadProgress.total ? `${Math.min(99, Math.round(uploadProgress.loaded / uploadProgress.total * 100))}%` : "Preparing…"}</span>
                  </div>
                  <div role="progressbar" aria-label="File upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadTransferred || flowState === "analyzing" ? 100 : uploadProgress.total ? Math.min(99, Math.round(uploadProgress.loaded / uploadProgress.total * 100)) : undefined} className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-[width] duration-200 rounded-full" style={{ width: `${uploadTransferred || flowState === "analyzing" ? 100 : uploadProgress.total ? Math.min(99, uploadProgress.loaded / uploadProgress.total * 100) : 0}%` }} />
                  </div>
                  {!uploadTransferred && uploadProgress.loaded > 0 && <p className="text-[11px] text-white/40 mt-1">{(uploadProgress.loaded / 1048576).toFixed(1)} MB sent{uploadProgress.total ? ` of ${(uploadProgress.total / 1048576).toFixed(1)} MB` : ""}</p>}
                </div>}
                <div>
                  <p role="status" className="text-xs font-medium text-white mb-2">{flowState === "analyzing" ? "Checking project files and detecting framework…" : uploadTransferred ? "Checking and extracting uploaded files…" : "Project checks will start after upload"}</p>
                  <div role="progressbar" aria-label="Project checks" className="h-1.5 bg-white/10 rounded-full overflow-hidden relative">
                    {(uploadTransferred || flowState === "analyzing") && <div className="absolute inset-y-0 w-1/3 bg-white/70 rounded-full animate-loading-bar motion-reduce:animate-none" />}
                  </div>
                  <p className="text-[11px] text-white/40 mt-2">{uploadTransferred || flowState === "analyzing" ? "The server is processing your project. Larger folders can take longer; setup opens when checks finish." : "Files stay on this page while they upload."}</p>
                </div>
              </div>
            )}

            {/* ─── Mode A: Big Drag & Drop Zone ─── */}
            {sourceMode === "upload" && (
              <div className="flex flex-col gap-5">
                <div
                  className={`relative border-2 border-dashed rounded-2xl p-9 text-center transition-all duration-200 group cursor-pointer ${
                    isDraggingOver
                      ? "border-white/40 bg-white/[0.025] shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                      : "border-white/[0.09] bg-black/40 hover:border-white/20 hover:bg-white/[0.01]"
                  }`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsDraggingOver(false);
                    }
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(false);
                    if (flowState === "uploading" || flowState === "analyzing") return;

                    const entries = Array.from(e.dataTransfer.items)
                      .map((item) => item.webkitGetAsEntry?.())
                      .filter((entry): entry is FileSystemEntry => Boolean(entry));
                    const droppedFiles = Array.from(e.dataTransfer.files);

                    try {
                      if (entries.some((entry) => entry.isDirectory)) {
                        if (entries.length !== 1) throw new Error("Drop one project folder at a time.");
                        setLocalSource(false);
    setFlowState("uploading");
                        setErrorMessage("");
                        setAnalysis(null);
                        const files = await readDroppedFiles(entries);
                        if (!files.length) throw new Error("The selected folder contains no files.");
                        handleFolderSelected(files);
                      } else {
                        if (droppedFiles.length !== 1) throw new Error("Drop one folder or ZIP archive at a time.");
                        handleZipSelected(droppedFiles[0]);
                      }
                    } catch (error) {
                      setErrorMessage(error instanceof Error ? error.message : "Could not read dropped files. Use the file picker instead.");
                      setFlowState("error");
                    }
                  }}
                >
                  {/* Hidden native inputs */}
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleZipSelected(e.target.files[0]);
                      }
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-expect-error webkitdirectory is standard in modern browsers
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={(e) => handleFolderSelected(e.target.files)}
                  />

                  {/* Drag Icon Indicator */}
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3.5 transition-all duration-200 ${
                      isDraggingOver
                        ? "bg-white/[0.08] border border-white/30 text-white"
                        : "bg-white/[0.03] border border-white/[0.06] text-white/50 group-hover:text-white group-hover:border-white/15"
                    }`}
                  >
                    {isDraggingOver ? (
                      <Icon icon="lucide:arrow-down" width={24} height={24} className="animate-bounce" />
                    ) : (
                      <Icon icon="lucide:upload-cloud" width={24} height={24} />
                    )}
                  </div>

                  {/* Heading & Instructions */}
                  <p className="text-sm font-semibold text-white tracking-wide">
                    {isDraggingOver
                      ? "Drop your folder or ZIP archive here"
                      : "Drag and drop a folder or a ZIP file"}
                  </p>
                  <p className="text-xs text-white/40 mt-1 max-w-md mx-auto leading-relaxed">
                    {isDraggingOver
                      ? "Release to unpack and analyze your project."
                      : "Supports Next.js, React, Node.js, Python, FastAPI, Django, Go, Static HTML, and Dockerfile projects."}
                  </p>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
                    <button
                      type="button"
                      disabled={flowState === "uploading" || flowState === "analyzing"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (zipInputRef.current) {
                          zipInputRef.current.value = "";
                          zipInputRef.current.click();
                        }
                      }}
                      className="ray-btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-2 cursor-pointer hover:border-white/20"
                    >
                      <Icon icon="lucide:file-archive" width={14} height={14} />
                      <span>Choose ZIP Archive</span>
                    </button>

                    <button
                      type="button"
                      disabled={flowState === "uploading" || flowState === "analyzing"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (folderInputRef.current) {
                          folderInputRef.current.value = "";
                          folderInputRef.current.click();
                        }
                      }}
                      className="ray-btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-2 cursor-pointer hover:border-white/20"
                    >
                      <Icon icon="lucide:folder-up" width={14} height={14} />
                      <span>Choose Project Folder</span>
                    </button>
                  </div>

                  {/* Active Selection Chip if any */}
                  {(selectedFile || selectedFolderFiles.length > 0) && (
                    <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
                      <Icon icon="lucide:check-circle" width={14} height={14} />
                      <span>
                        {selectedFile ? selectedFile.name : `${selectedFolderFiles.length} files selected`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Switch to Git Option */}
                <div className="flex items-center justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => setSourceMode("git")}
                    className="text-xs text-white/50 hover:text-white flex items-center gap-2 py-1.5 px-3 rounded-xl border border-white/[0.06] bg-black/40 hover:bg-white/[0.03] transition-all cursor-pointer"
                  >
                    <WhiteGitHubIcon size={14} />
                    <span>Prefer remote repository? <strong>Choose Git source →</strong></span>
                  </button>
                </div>
              </div>
            )}

            {/* ─── Mode B: GitHub / Remote Git Card ─── */}
            {sourceMode === "git" && (
              <div className="flex flex-col gap-4 animate-fade-in">
                <button
                  type="button"
                  onClick={() => setSourceMode("upload")}
                  className="self-start text-xs text-white/50 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer mb-1"
                >
                  <Icon icon="lucide:arrow-left" width={13} height={13} />
                  <span>Back to ZIP or folder upload</span>
                </button>

                <div className="flex flex-col gap-3 p-5 rounded-2xl bg-black/50 border border-white/[0.08]">
                  <div className="flex items-center gap-2 mb-1">
                    <WhiteGitHubIcon size={16} />
                    <span className="text-sm font-semibold text-white">GitHub Repository (HTTPS)</span>
                  </div>

                  <div>
                    <label htmlFor="git-repo-url" className="ray-eyebrow block mb-1">Repository URL</label>
                    <input
                      id="git-repo-url"
                      type="url"
                      value={repoUrl}
                      disabled={flowState === "uploading" || flowState === "analyzing"}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        setPreparedGit(null);
                        setAnalysis(null);
                        setFlowState("idle");
                      }}
                      placeholder="https://github.com/owner/repository"
                      className="ray-input text-xs font-mono"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label htmlFor="git-repo-branch" className="ray-eyebrow block mb-1">Branch (Optional)</label>
                      <input
                        id="git-repo-branch"
                        type="text"
                        value={repoBranch}
                        disabled={flowState === "uploading" || flowState === "analyzing"}
                        onChange={(e) => {
                          setRepoBranch(e.target.value);
                          setPreparedGit(null);
                          setAnalysis(null);
                          setFlowState("idle");
                        }}
                        placeholder="main / master"
                        className="ray-input text-xs font-mono"
                      />
                    </div>

                    <div className="sm:self-end">
                      <button
                        type="button"
                        onClick={prepareGitHub}
                        disabled={!repoUrl.trim() || flowState === "uploading" || flowState === "analyzing"}
                        className="ray-btn-primary text-xs px-5 py-2.5 font-bold flex items-center gap-2 cursor-pointer w-full sm:w-auto"
                      >
                        {flowState === "analyzing" ? <SpinIcon size={12} /> : <Icon icon="lucide:download-cloud" width={14} height={14} />}
                        <span>Prepare Repository</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/40 pt-2 border-t border-white/[0.04]">
                    <span>Private repositories use your saved GitHub credentials in Settings.</span>
                    <Link href="/settings#git-connections" className="text-sky-400 hover:underline">
                      Manage Git credentials ↗
                    </Link>
                  </div>

                  {preparedGit && (
                    <div className="mt-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-mono">
                      ✓ Prepared: {preparedGit.repoUrl} ({preparedGit.branch}) · {preparedGit.commitHash.slice(0, 8)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}


        {/* ══════════════════════════════════════════════════════════════════════
            STEP 2: CONFIGURATION & REVIEW
            Only visible when activeStep === 2
           ══════════════════════════════════════════════════════════════════════ */}
        {activeStep === 2 && analysis && (
          <div className="flex flex-col gap-6 animate-fade-in">
            {/* ─── Top Banner: Detected Language & Deploy Button (FIRST) ────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#090909] p-6 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                {/* Left: Detected framework and specs */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-black border border-white/[0.12] shadow-inner flex items-center justify-center shrink-0">
                    <Icon icon={analysis.icon || "logos:docker-icon"} width={32} height={32} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-2xl font-bold text-white tracking-tight">
                        {analysis.framework}
                      </span>
                      <span className="ray-badge">{analysis.language}</span>
                      {analysis.hasDockerfile && (
                        <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                          Dockerfile Detected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50 mt-1 max-w-md">
                      {setup.dockerEnabled
                        ? analysis.hasDockerfile
                          ? "Custom Dockerfile detected. Container will be built directly from project source."
                          : "Ray will auto-generate a production multi-stage Docker container specification."
                        : "Application will run directly as a managed process on the host machine."}
                    </p>
                  </div>
                </div>

                {embedded && <label className="text-xs text-white/70 flex gap-2 items-start"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed the name, framework, Docker mode, ports, domain, commands and runtime settings below.</label>}
                {/* Right: Primary Deploy Button */}
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={handleDeploy}
                    disabled={analysisBusy || appDirectory !== analysis.appDirectory || !projectName.trim() || (embedded && !reviewed)}
                    className="ray-btn-primary text-sm px-6 py-3 font-bold flex items-center gap-2 cursor-pointer shadow-xl hover:shadow-[0_0_20px_rgba(255,255,255,0.25)] transition-all shrink-0 disabled:opacity-40"
                  >
                    <Icon icon="lucide:play" width={15} height={15} />
                    <span>{setup.dockerEnabled ? "Deploy Container" : "Deploy on Host"}</span>
                  </button>
                </div>
              </div>

              {/* Sub-bar: Change source option */}
              <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/40">
                <span>
                  Source: <strong className="text-white/70">{preparedGit ? "GitHub Repository" : selectedFile ? selectedFile.name : `${selectedFolderFiles.length} files`}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="text-white/60 hover:text-white underline cursor-pointer"
                >
                  ← Change source code
                </button>
              </div>
            </div>

            {/* Error Message if any */}
            {errorMessage && (
              <div role="alert" className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-xs text-red-300 flex items-center gap-2">
                <Icon icon="lucide:alert-circle" width={15} height={15} className="shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* ─── Main Configuration Card (Outside Advanced) ────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#090909] p-6 flex flex-col gap-5 shadow-xl">
              <span className="ray-eyebrow">Project Identity & Application Routing</span>

              {/* 1. Project Name */}
              <div>
                <label htmlFor="setup-project-name" className="ray-eyebrow block mb-1.5">
                  Project Name
                </label>
                <input
                  id="setup-project-name"
                  type="text"
                  required
                  maxLength={100}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                  placeholder="e.g. my-awesome-app"
                  className="ray-input text-xs font-mono"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Used for container naming, telemetry tags, and internal DNS resolution.
                </p>
              </div>

              {/* 2. Application Directory */}
              <div>
                <label htmlFor="setup-app-dir" className="ray-eyebrow block mb-1.5">
                  Application Directory
                </label>
                <div className="flex gap-2">
                  <input
                    id="setup-app-dir"
                    type="text"
                    value={appDirectory}
                    onChange={(e) => setAppDirectory(e.target.value)}
                    placeholder=". or apps/web"
                    className="ray-input font-mono text-xs flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={analyzeDirectory}
                    disabled={analysisBusy || appDirectory === analysis.appDirectory}
                    className="ray-btn-ghost text-xs px-4 cursor-pointer disabled:opacity-50"
                  >
                    {analysisBusy ? "Analyzing..." : "Analyze"}
                  </button>
                </div>
                <p className="text-[11px] text-white/40 mt-1 break-all">
                  Relative to project root: <span className="font-mono text-white/60">{analysis.sourceRoot}</span>
                </p>
                {appDirectory !== analysis.appDirectory && (
                  <p role="status" className="text-xs text-amber-400 mt-1">
                    Directory changed. Click &quot;Analyze&quot; to inspect this subfolder before deploying.
                  </p>
                )}
              </div>

              {/* 3. Application URL (Outside Advanced as requested) */}
              <div>
                <label htmlFor="setup-app-url" className="ray-eyebrow block mb-1.5">
                  Application URL (Optional)
                </label>
                <input
                  id="setup-app-url"
                  type="url"
                  value={setup.projectUrl}
                  onChange={(e) => updateSetup("projectUrl", e.target.value)}
                  placeholder="https://app.example.com"
                  className="ray-input text-xs font-mono"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Saves your application’s public web address for quick access and monitoring.
                </p>
              </div>

              {/* ─── Advanced Settings Accordion Trigger ──────────────────────── */}
              <div className="pt-2 border-t border-white/[0.04]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10 transition-all cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <Icon icon="lucide:sliders" width={15} height={15} className="text-white/60" />
                    <div>
                      <span className="text-xs font-semibold text-white block">
                        Advanced Settings
                      </span>
                      <span className="text-[11px] text-white/40">
                        Docker isolation, port mapping, framework overrides, commands, and environment variables.
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="ray-badge">
                      {setup.dockerEnabled ? "Docker ON" : "Host Mode"}
                    </span>
                    <Icon
                      icon="lucide:chevron-down"
                      width={14}
                      height={14}
                      className={`text-white/40 transition-transform duration-200 ${
                        showAdvanced ? "rotate-180 text-white" : ""
                      }`}
                    />
                  </div>
                </button>

                {/* ─── Advanced Settings Menu (Inside Accordion) ──────────────── */}
                {showAdvanced && (
                  <div className="mt-4 p-5 rounded-2xl bg-black/60 border border-white/[0.08] flex flex-col gap-5 animate-fade-in">

                    {/* A. Use Docker Switch (Custom high-end switch with Docker icon + Simple text status) */}
                    <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] flex flex-col gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-black border border-white/[0.1] flex items-center justify-center shrink-0 mt-0.5">
                            <Icon icon="logos:docker-icon" width={18} height={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">Use Docker Container</span>
                              <span className="ray-badge">Recommended</span>
                            </div>
                            <p className="text-[11px] text-white/40 mt-0.5 max-w-sm">
                              {setup.dockerEnabled
                                ? "Isolates your application in a secure Linux container."
                                : "Runs directly on the host server without container isolation."}
                            </p>
                          </div>
                        </div>

                        {/* Custom Switch Component */}
                        <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                          <input
                            type="checkbox"
                            checked={setup.dockerEnabled}
                            onChange={(e) => updateSetup("dockerEnabled", e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-white/[0.08] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white/90 peer-checked:after:bg-black peer-checked:shadow-[0_0_12px_rgba(255,255,255,0.4)]" />
                        </label>
                      </div>

                      {/* Simple Text for Docker daemon status (not a chip) */}
                      {setup.dockerEnabled && (
                        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-white/50">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              dockerRunning ? "bg-emerald-400" : "bg-amber-400"
                            }`}
                          />
                          <span>
                            {dockerRunning ? "Docker daemon is running" : "Docker daemon is stopped"}
                          </span>
                          {!dockerRunning && (
                            <button
                              type="button"
                              onClick={handleStartDocker}
                              disabled={startingDocker}
                              className="text-amber-400 hover:text-amber-300 underline cursor-pointer disabled:opacity-50 ml-1 font-sans text-[11px]"
                            >
                              {startingDocker ? "Starting..." : "(Start daemon)"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* B. Public Port & Container Port (Inside Docker Section) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="setup-host-port" className="ray-eyebrow block mb-1.5">
                          Public Host Port
                        </label>
                        <input
                          id="setup-host-port"
                          type="number"
                          min={1}
                          max={65535}
                          value={customPort}
                          onChange={(e) => {
                            setCustomPort(e.target.value);
                            updateSetup("hostPort", e.target.value === "" ? null : Number(e.target.value));
                          }}
                          placeholder={String(analysis.suggestedPort || 4050)}
                          className="ray-input font-mono text-xs"
                        />
                        <p className="text-[10px] text-white/40 mt-1">
                          The external port opened on your server.
                        </p>
                      </div>

                      {setup.dockerEnabled && (
                        <div>
                          <label htmlFor="setup-internal-port" className="ray-eyebrow block mb-1.5">
                            Port inside Docker
                          </label>
                          <input
                            id="setup-internal-port"
                            type="number"
                            min={1}
                            max={65535}
                            value={internalPort}
                            onChange={(e) => {
                              setInternalPort(e.target.value);
                              updateSetup("containerPort", e.target.value === "" ? null : Number(e.target.value));
                            }}
                            placeholder={String(analysis.containerPort || 3000)}
                            className="ray-input font-mono text-xs"
                          />
                          <p className="text-[10px] text-white/40 mt-1">
                            Internal port listening inside the container.
                          </p>
                        </div>
                      )}
                    </div>

                    <DeploymentServiceFields value={setup} onChange={setSetup} />

                    {/* C. Framework Preset (Searchable Select2 style with brand icons) */}
                    <div>
                      <SearchableFrameworkSelect
                        value={setup.framework}
                        onChange={(slug) => updateSetup("framework", slug)}
                      />
                      <p className="text-[10px] text-white/40 mt-1">
                        {setup.dockerEnabled
                          ? "An existing Dockerfile takes precedence. Select a preset to enforce framework conventions."
                          : "Framework preset guides build and start commands for host execution."}
                      </p>
                    </div>

                    <p className="text-xs text-white/50">{FRAMEWORK_TEMPLATE_NOTES[setup.framework === "auto" ? analysis.frameworkSlug : setup.framework]}</p>

                    {/* D. Build & Start Commands (Grouped in single cohesive card) */}
                    <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="ray-eyebrow">Build & Execution Commands</span>
                        <span className="text-[10px] font-mono text-white/40">
                          {setup.dockerEnabled ? "Inside Docker container" : "Host shell"}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="setup-build-cmd" className="text-[11px] font-medium text-white/70 block mb-1">
                            Build Command
                          </label>
                          <input
                            id="setup-build-cmd"
                            type="text"
                            value={setup.buildCommand}
                            onChange={(e) => updateSetup("buildCommand", e.target.value)}
                            placeholder={setup.dockerEnabled ? "Use Dockerfile or preset default" : "e.g. npm ci && npm run build"}
                            className="ray-input font-mono text-xs"
                          />
                        </div>

                        <div>
                          <label htmlFor="setup-start-cmd" className="text-[11px] font-medium text-white/70 block mb-1">
                            Start Command {!setup.dockerEnabled && <span className="text-red-400">*</span>}
                          </label>
                          <input
                            id="setup-start-cmd"
                            type="text"
                            value={setup.startCommand}
                            onChange={(e) => updateSetup("startCommand", e.target.value)}
                            required={!setup.dockerEnabled}
                            placeholder={setup.dockerEnabled ? "Use Dockerfile or preset default" : "e.g. npm start (Required)"}
                            className="ray-input font-mono text-xs"
                          />
                        </div>
                      </div>

                      <p className="text-[10px] text-white/40">
                        {setup.dockerEnabled
                          ? "Commands run inside the container during build and execution."
                          : "Start command is required for host deployment. It runs continuously in the foreground."}
                      </p>
                    </div>

                    {/* E. Environment Variables */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="ray-eyebrow">Runtime Environment Variables ({envVars.length})</span>
                        <button
                          type="button"
                          onClick={addEnvVar}
                          className="text-[11px] text-white/60 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          <Icon icon="lucide:plus" width={12} height={12} />
                          <span>Add Variable</span>
                        </button>
                      </div>

                      {envVars.length === 0 ? (
                        <p className="text-[11px] text-white/30 italic">No custom environment variables configured.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {envVars.map((env) => (
                            <div key={env.id} className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="KEY (e.g. DATABASE_URL)"
                                value={env.key}
                                onChange={(e) => updateEnvVar(env.id, "key", e.target.value)}
                                className="ray-input text-xs font-mono flex-1"
                              />
                              <input
                                type="password"
                                placeholder="VALUE"
                                value={env.value}
                                autoComplete="new-password"
                                onChange={(e) => updateEnvVar(env.id, "value", e.target.value)}
                                className="ray-input text-xs font-mono flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => removeEnvVar(env.id)}
                                className="w-8 h-8 rounded-lg hover:bg-white/[0.08] text-white/30 hover:text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                              >
                                <Icon icon="lucide:trash-2" width={14} height={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* F. Recognized Assets Tag Cloud */}
                    {analysis.filesSummary && analysis.filesSummary.length > 0 && (
                      <div className="pt-2 border-t border-white/[0.04]">
                        <span className="ray-eyebrow block mb-2">Recognized Project Files</span>
                        <div className="flex flex-wrap gap-1.5">
                          {analysis.filesSummary.map((f) => (
                            <span
                              key={f}
                              className="px-2 py-0.5 rounded bg-black/40 border border-white/[0.05] text-[10px] font-mono text-white/60"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════════════════════════════
            STEP 3: DEPLOYMENT PIPELINE & STREAMING LOGS
            Only visible when activeStep === 3
           ══════════════════════════════════════════════════════════════════════ */}
        {activeStep === 3 && (
          <DeploymentPipelineFlow
            currentStep={currentStep}
            flowState={flowState}
            dockerEnabled={setup.dockerEnabled}
            projectName={projectName}
            buildLogs={buildLogs}
            errorMessage={errorMessage}
            liveUrl={liveUrl}
            containerName={containerName}
            onRetry={handleDeploy}
            onTroubleshoot={() => setTroubleshootOpen(true)}
          />
        )}
      </div>

      {/* ─── AI Diagnosis Modal ──────────────────────────────────────────────── */}
      <DeployDiagnosisModal
        isOpen={troubleshootOpen}
        onClose={() => setTroubleshootOpen(false)}
        deploymentId={deployedId || undefined}
        projectName={projectName}
        buildLogs={buildLogs || errorMessage}
        onRedeployStarted={() => {
          setTroubleshootOpen(false);
          handleDeploy();
        }}
      />
    </div>
  );
}
