"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import DeployDiagnosisModal from "@/components/DeployDiagnosisModal";
import { parseProjectDomains, getPrimaryProjectUrl, normalizeDomain } from "@/lib/domains";
import TerminalView from "@/components/TerminalView";

interface FileNode {
  name: string;
  path: string;
  relPath: string;
  type: "file" | "directory";
  size?: number;
  ext?: string;
  children?: FileNode[];
}

interface ProjectData {
  id: string;
  name: string;
  projectPath: string;
  projectUrl?: string | null;
  status: string;
  memory?: string | null;
  memoryStatus?: string | null;
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
    image?: string;
  } | null;
  deployment?: {
    id: string;
    name: string;
    sourceType: string;
    status: "pending" | "building" | "deploying" | "healthy" | "failed" | "stopped";
    projectPath: string;
    containerName?: string | null;
    hostPort?: number | null;
    deployUrl?: string | null;
    buildLogs?: string | null;
    createdAt: string;
    container?: {
      id: string;
      name: string;
      state: string;
      port?: number;
      url?: string;
    } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface PipelineData {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  autoDeploy: boolean;
  port?: number;
  status: string;
  lastRunAt?: string | null;
  runs?: Array<{
    id: string;
    status: string;
    commitHash?: string;
    commitMessage?: string;
    createdAt: string;
  }>;
}

interface GithubData {
  connected: boolean;
  integration?: {
    id: string;
    githubUsername?: string;
    avatarUrl?: string;
  } | null;
}

interface NetworkData {
  localIp: string;
  publicIp: string;
  isPrivateNetwork?: boolean;
  isPubliclyExposed?: boolean;
}

interface EnvVar {
  key: string;
  value: string;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const FolderIcon = ({ open = false }: { open?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={open ? "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" : "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"} />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

const DockerIcon = ({ size = 12, className = "text-sky-400" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.186.185.186m-2.954 0h2.119a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185H8.075a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m-2.955 0h2.119a.186.186 0 00.186-.186V6.29a.186.186 0 00-.186-.185H5.12a.185.185 0 00-.185.185v1.888c0 .102.083.186.185.186m14.771 4.972c-.547-.38-1.579-.475-2.427-.475-.152 0-.301.004-.447.012-.396-2.585-2.613-3.692-2.613-3.692s-.98 1.092-1.516 2.378c-.286-.062-.591-.097-.912-.097H2.888A2.888 2.888 0 000 14.364c0 3.237 2.008 6.549 5.86 6.549 4.608 0 7.893-2.68 9.382-6.386 1.487.11 3.51-.237 4.707-1.127.35-.26.547-.63.547-1.048 0-.414-.194-.783-.54-1.048z" />
  </svg>
);

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  // Active top-level view: default is settings, or terminal, deployment, files, memory, security
  const [activeTab, setActiveTab] = useState<"settings" | "terminal" | "deployment" | "files" | "memory" | "security">("settings");

  // Security audit state
  const [securityScans, setSecurityScans] = useState<any[]>([]);
  const [securityRules, setSecurityRules] = useState<any[]>([]);
  const [loadingSecurity, setLoadingSecurity] = useState(false);
  const [scanningSecurity, setScanningSecurity] = useState(false);
  const [overrideAck, setOverrideAck] = useState(false);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideSuccess, setOverrideSuccess] = useState(false);
  const [overrideError, setOverrideError] = useState("");
  const [selectedAuditLog, setSelectedAuditLog] = useState<string | null>(null);

  // Active section inside Settings & Overview anchor sidebar
  const [activeSection, setActiveSection] = useState<"general" | "services" | "domain" | "env" | "danger">("general");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Scroll container ref for spy & scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Project & metadata
  const [project, setProject] = useState<ProjectData | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [github, setGithub] = useState<GithubData>({ connected: false });
  const [network, setNetwork] = useState<NetworkData>({
    localIp: "127.0.0.1",
    publicIp: "127.0.0.1",
    isPrivateNetwork: true,
    isPubliclyExposed: false,
  });
  const [loading, setLoading] = useState(true);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [deploying, setDeploying] = useState(false);

  // Settings State: Project Name
  const [projectName, setProjectName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Settings State: Domain & Port
  const [domainInput, setDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [domainSaved, setDomainSaved] = useState(false);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [domainCheckResult, setDomainCheckResult] = useState<{
    resolved?: boolean;
    matchesServerIp?: boolean;
    resolvedIps?: string[];
    error?: string | null;
  } | null>(null);

  // IP Exposure check
  const [checkingExposure, setCheckingExposure] = useState(false);
  const [exposureChecked, setExposureChecked] = useState(false);

  // Settings State: Environment Variables
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [rawEnv, setRawEnv] = useState("");
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [loadingRawEnv, setLoadingRawEnv] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [addingEnv, setAddingEnv] = useState(false);
  const [savingRawEnv, setSavingRawEnv] = useState(false);
  const [rawEnvMode, setRawEnvMode] = useState(false);
  const [envActionMessage, setEnvActionMessage] = useState("");

  // Files Tab State
  const [filesTree, setFilesTree] = useState<FileNode[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // AI Memory Tab State
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Fetch full project details
  const fetchProjectDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setProjectName(data.project.name || "");
        setDomainInput(data.project.projectUrl || "");
        setMemoryDraft(data.project.memory || "");
        if (data.pipeline) setPipeline(data.pipeline);
        if (data.github) setGithub(data.github);
        if (data.network) setNetwork(data.network);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id]);

  const handleDeployOrRedeploy = async () => {
    setDeploying(true);
    try {
      if (project?.deployment) {
        const res = await fetch(`/api/deploy/${project.deployment.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "redeploy" }),
        });
        if (res.ok) {
          window.dispatchEvent(new Event("ray:redeploy-triggered"));
          fetchProjectDetails();
        }
      } else if (project) {
        const res = await fetch(`/api/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: project.name,
            projectPath: project.projectPath,
            sourceType: "local",
          }),
        });
        if (res.ok) {
          window.dispatchEvent(new Event("ray:redeploy-triggered"));
          fetchProjectDetails();
        }
      }
    } catch { /* silent */ }
    finally {
      setDeploying(false);
    }
  };

  // Fetch env variables
  const fetchEnvVars = useCallback(async () => {
    setLoadingEnv(true);
    try {
      const res = await fetch(`/api/projects/${id}/env`);
      if (res.ok) {
        const data = await res.json();
        setEnvVars(data.vars || []);
      }
    } catch { /* silent */ }
    finally { setLoadingEnv(false); }
  }, [id]);

  // Fetch file tree (lazy loaded when user opens Files tab)
  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(`/api/projects/${id}/files`);
      if (res.ok) {
        const data = await res.json();
        const tree = data.tree || [];
        setFilesTree(tree);
        setFilesLoaded(true);
        const initialExpanded = new Set<string>();
        tree.forEach((node: FileNode) => {
          if (node.type === "directory") initialExpanded.add(node.path);
        });
        setExpandedFolders(initialExpanded);
        const firstFile = tree.find((n: FileNode) => n.type === "file") || (tree[0]?.children?.find((n: FileNode) => n.type === "file"));
        if (firstFile) setSelectedFile(firstFile);
      }
    } catch { /* silent */ }
    finally { setLoadingFiles(false); }
  }, [id]);

  useEffect(() => {
    fetchProjectDetails();
    fetchEnvVars();
  }, [fetchProjectDetails, fetchEnvVars]);

  // Fetch files when switching to Files tab if not loaded yet
  useEffect(() => {
    if (activeTab === "files" && !filesLoaded) {
      fetchFiles();
    }
  }, [activeTab, filesLoaded, fetchFiles]);

  // Fetch security audit data when switching to Security tab
  const fetchSecurityData = useCallback(async () => {
    if (!id) return;
    setLoadingSecurity(true);
    try {
      const [scansRes, rulesRes] = await Promise.all([
        fetch(`/api/security/scans?projectId=${id}`),
        fetch("/api/security/rules"),
      ]);
      if (scansRes.ok) {
        const data = await scansRes.json();
        setSecurityScans(data.scans || []);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setSecurityRules(data.rules || []);
      }
    } catch { /* silent */ }
    finally { setLoadingSecurity(false); }
  }, [id]);

  useEffect(() => {
    if (activeTab === "security") {
      fetchSecurityData();
    }
  }, [activeTab, fetchSecurityData]);

  const handleRunProjectScan = async () => {
    if (!project) return;
    setScanningSecurity(true);
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
      if (res.ok) {
        fetchSecurityData();
      }
    } catch { /* silent */ }
    finally {
      setScanningSecurity(false);
    }
  };

  const handleAuthorizeProjectOverride = async (pipelineRunId: string, pipelineId?: string, scanId?: string) => {
    if (!overrideAck) return;
    setOverrideSubmitting(true);
    setOverrideError("");
    try {
      const res = await fetch("/api/security/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineRunId,
          pipelineId,
          scanId,
          acknowledgedRisk: true,
          consentDeploy: true,
        }),
      });
      if (res.ok) {
        setOverrideSuccess(true);
        setTimeout(() => {
          setOverrideSuccess(false);
          setOverrideAck(false);
          fetchProjectDetails();
          fetchSecurityData();
        }, 2000);
      } else {
        const err = await res.json();
        setOverrideError(err.error || "Failed to authorize override");
      }
    } catch (e: any) {
      setOverrideError(e.message || "Failed to authorize override");
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // Fetch content when selected file changes in Files view
  useEffect(() => {
    if (!selectedFile || selectedFile.type !== "file") return;
    setLoadingContent(true);
    fetch(`/api/projects/${id}/file-content?path=${encodeURIComponent(selectedFile.path)}`)
      .then((res) => res.json())
      .then((data) => setFileContent(data.content || ""))
      .catch(() => setFileContent("Failed to load file content."))
      .finally(() => setLoadingContent(false));
  }, [id, selectedFile]);

  // Scroll spy to update activeSection when user scrolls the full page
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const scrollPos = container.scrollTop + 140;

    const sections: Array<"general" | "services" | "domain" | "env" | "danger"> = ["general", "services", "domain", "env", "danger"];
    for (let i = sections.length - 1; i >= 0; i--) {
      const el = document.getElementById(`section-${sections[i]}`);
      if (el && el.offsetTop <= scrollPos) {
        setActiveSection(sections[i]);
        break;
      }
    }
  };

  // Scroll to anchor section
  const scrollToSection = (sectionKey: "general" | "services" | "domain" | "env" | "danger") => {
    setActiveSection(sectionKey);
    const target = document.getElementById(`section-${sectionKey}`);
    if (target && scrollContainerRef.current) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Save Project Name
  const handleSaveName = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!projectName.trim() || savingName) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName.trim() }),
      });
      if (res.ok) {
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 2500);
        fetchProjectDetails();
      }
    } catch { /* silent */ }
    finally { setSavingName(false); }
  };

  const [domainError, setDomainError] = useState<string | null>(null);

  // Save Project Domain(s)
  const handleSaveDomain = async (customUrl?: string | null) => {
    const urlToSave = customUrl !== undefined ? (customUrl ? customUrl.trim() : null) : domainInput.trim() || null;
    setSavingDomain(true);
    setDomainError(null);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectUrl: urlToSave }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDomainError(data.error || "Failed to update project domains");
        return;
      }
      setDomainSaved(true);
      setDomainInput(urlToSave || "");
      setTimeout(() => setDomainSaved(false), 2500);
      fetchProjectDetails();
    } catch {
      setDomainError("Network error while saving domains");
    } finally {
      setSavingDomain(false);
    }
  };

  // Add / Append Domain helper
  const handleAppendDomain = (newDomain: string) => {
    const currentList = parseProjectDomains(domainInput);
    const newNorm = normalizeDomain(newDomain);
    if (!currentList.some((d) => normalizeDomain(d) === newNorm)) {
      currentList.push(newDomain);
    }
    const serialized = currentList.join(", ");
    setDomainInput(serialized);
    handleSaveDomain(serialized);
    handleCheckDomain(newDomain);
  };

  // Remove individual domain
  const handleRemoveDomain = (domainToRemove: string) => {
    const currentList = parseProjectDomains(domainInput);
    const targetNorm = normalizeDomain(domainToRemove);
    const filtered = currentList.filter((d) => normalizeDomain(d) !== targetNorm);
    const serialized = filtered.length > 0 ? filtered.join(", ") : null;
    setDomainInput(serialized || "");
    handleSaveDomain(serialized);
  };

  // Check Domain DNS Resolution
  const handleCheckDomain = async (targetDomain?: string) => {
    const domain = (targetDomain || domainInput).trim();
    if (!domain) return;
    setCheckingDomain(true);
    setDomainCheckResult(null);
    try {
      const res = await fetch(`/api/projects/${id}/domain-check?domain=${encodeURIComponent(domain)}`);
      if (res.ok) {
        const data = await res.json();
        setDomainCheckResult(data);
      }
    } catch {
      setDomainCheckResult({ error: "Failed to query DNS" });
    } finally {
      setCheckingDomain(false);
    }
  };

  // Check IP Exposure Reachability
  const handleCheckExposure = async () => {
    setCheckingExposure(true);
    try {
      const res = await fetch(`/api/projects/${id}?refresh=1`);
      if (res.ok) {
        const data = await res.json();
        if (data.network) setNetwork(data.network);
      }
      setExposureChecked(true);
      setTimeout(() => setExposureChecked(false), 4000);
    } finally {
      setCheckingExposure(false);
    }
  };

  // Quick Apply sslip.io Domain
  const handleApplySslipDomain = () => {
    if (!project) return;
    const cleanName = project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const ip = network.publicIp && network.publicIp !== "127.0.0.1" ? network.publicIp : (network.localIp || "127.0.0.1");
    const sslipDomain = `http://${cleanName}.${ip}.sslip.io`;
    handleAppendDomain(sslipDomain);
  };

  // Winning allocated port (from container e.g. 4000, pipeline, or fallback)
  const allocatedPort = project?.container?.port || pipeline?.port || 4000;

  // Switch to Allocated Port
  const handleSwitchToAllocatedPort = () => {
    const portUrl = `http://localhost:${allocatedPort}`;
    handleAppendDomain(portUrl);
  };

  // Reset to Default / Clear Domain
  const handleResetPort = () => {
    setDomainInput("");
    handleSaveDomain(null);
  };

  // Add ENV variable
  const handleAddEnvVar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvKey.trim() || addingEnv) return;
    setAddingEnv(true);
    setEnvActionMessage("");
    try {
      const res = await fetch(`/api/projects/${id}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newEnvKey.trim(), value: newEnvValue }),
      });
      if (res.ok) {
        setNewEnvKey("");
        setNewEnvValue("");
        setEnvActionMessage("Variable added to .env");
        setTimeout(() => setEnvActionMessage(""), 3000);
        fetchEnvVars();
      }
    } catch { /* silent */ }
    finally { setAddingEnv(false); }
  };

  // Delete ENV variable
  const handleDeleteEnvVar = async (key: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/env?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", key }),
      });
      if (res.ok) {
        setEnvActionMessage(`Deleted ${key} from .env`);
        setTimeout(() => setEnvActionMessage(""), 3000);
        fetchEnvVars();
      }
    } catch { /* silent */ }
  };

  // Load the raw file only when the user explicitly opens the editor.
  const handleOpenRawEnv = async () => {
    setLoadingRawEnv(true);
    setEnvActionMessage("");
    try {
      const res = await fetch(`/api/projects/${id}/env?view=raw`);
      if (!res.ok) {
        setEnvActionMessage("Unable to load the raw .env file");
        return;
      }
      const data = await res.json();
      setRawEnv(data.rawContent || "");
      setRawEnvMode(true);
    } catch {
      setEnvActionMessage("Unable to load the raw .env file");
    } finally {
      setLoadingRawEnv(false);
    }
  };

  const handleCloseRawEnv = () => {
    setRawEnvMode(false);
    setRawEnv("");
  };

  // Save the raw .env file without returning its contents in the response.
  const handleSaveRawEnv = async () => {
    setSavingRawEnv(true);
    setEnvActionMessage("");
    try {
      const res = await fetch(`/api/projects/${id}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "raw", content: rawEnv }),
      });
      if (res.ok) {
        handleCloseRawEnv();
        setEnvActionMessage("Saved .env configuration");
        setTimeout(() => setEnvActionMessage(""), 3000);
        fetchEnvVars();
      } else {
        setEnvActionMessage("Unable to save the .env file");
      }
    } catch {
      setEnvActionMessage("Unable to save the .env file");
    } finally {
      setSavingRawEnv(false);
    }
  };

  // Save AI Memory Draft
  const handleSaveMemory = async () => {
    setSavingMemory(true);
    try {
      const res = await fetch(`/api/monitor/projects/${id}/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memory: memoryDraft }),
      });
      if (res.ok) {
        setMemorySaved(true);
        setEditingMemory(false);
        setTimeout(() => setMemorySaved(false), 2500);
        fetchProjectDetails();
      }
    } catch { /* silent */ }
    finally { setSavingMemory(false); }
  };

  // Re-analyze AI Memory
  const handleReanalyze = async () => {
    if (!project) return;
    setAnalyzing(true);
    try {
      await fetch(`/api/monitor/projects/${id}/memory`, { method: "POST" });
      setTimeout(() => {
        fetchProjectDetails();
        setAnalyzing(false);
      }, 3000);
    } catch {
      setAnalyzing(false);
    }
  };

  // Folder toggling in Files view
  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Recursive tree rendering
  const renderTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
      const isDir = node.type === "directory";
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFile?.path === node.path;

      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => {
              if (isDir) toggleFolder(node.path);
              else setSelectedFile(node);
            }}
            className={`flex items-center gap-2 py-1 px-2 rounded-lg cursor-pointer transition-colors text-xs ${isSelected
              ? "bg-white/[0.08] text-white font-medium"
              : isDir
                ? "text-white/70 hover:bg-white/[0.04] hover:text-white"
                : "text-white/45 hover:bg-white/[0.04] hover:text-white/80"
              }`}
            style={{
              paddingLeft: `${depth * 14 + 8}px`,
            }}
          >
            {isDir ? (
              <>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={`transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <FolderIcon open={isExpanded} />
              </>
            ) : (
              <>
                <span className="w-2.5" />
                <FileIcon />
              </>
            )}
            <span className="truncate font-mono text-[11px]">{node.name}</span>
          </div>

          {isDir && isExpanded && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const primaryUrl = getPrimaryProjectUrl(
    project?.projectUrl,
    project?.container?.port || allocatedPort
  );
  const effectiveUrl =
    primaryUrl ||
    project?.container?.url ||
    (project?.container?.port ? `http://localhost:${project.container.port}` : null) ||
    (allocatedPort ? `http://localhost:${allocatedPort}` : null);
  const projectDomainList = parseProjectDomains(project?.projectUrl);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-white/40">
        <SpinIcon /><span className="text-xs font-medium">Loading project...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden font-sans">
      {/* Top Header bar */}
      <div className="px-6 py-4 border-b border-white/[0.06] bg-[#060606] flex items-center justify-between gap-4 flex-shrink-0">
        <div>
          <button
            onClick={() => router.push("/projects")}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white mb-1.5 transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
            <span>Back to Projects</span>
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-jersey text-3xl text-white tracking-wide mr-1">{project?.name || "Project"}</h1>

            {/* 1. Framework / Inner Stack Badge (1st) */}
            {project?.framework && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-mono ${project.colorClasses || "bg-white/[0.04] border-white/[0.08] text-white/70"
                  }`}
              >
                <Icon icon={project.icon || "logos:nodejs-icon"} width={12} height={12} className="shrink-0" />
                <span>{project.framework.toLowerCase()}</span>
              </span>
            )}

            {/* 2. Docker Badge (2nd) */}
            {project?.isDocker && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-[11px] font-mono text-sky-300">
                <Icon icon="logos:docker-icon" width={13} height={13} className="shrink-0" />
                <span>docker</span>
              </span>
            )}

            {allocatedPort && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-500/[0.08] border border-blue-500/20 text-[11px] font-mono text-blue-300">
                <Icon icon="lucide:radio" width={11} height={11} className="text-blue-400/80" />
                <span>:{allocatedPort}</span>
              </span>
            )}
            {effectiveUrl && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-[11px] font-mono text-emerald-300">
                <Icon icon="lucide:globe" width={11} height={11} className="text-emerald-400/80" />
                <span>{effectiveUrl.replace(/^https?:\/\//, "")}</span>
                {projectDomainList.length > 1 && (
                  <span className="text-[10px] text-emerald-400/70 font-sans font-medium">
                    (+{projectDomainList.length - 1} more)
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] text-white/40 mt-0.5">
            {project?.projectPath}
          </p>
        </div>

        {/* Top Actions: Open App */}
        <div className="flex items-center gap-2">
          {effectiveUrl && (
            <a
              href={effectiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ray-btn-primary flex items-center gap-1.5 text-xs px-3.5 py-1.5 cursor-pointer"
            >
              <span>Open App</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /></svg>
            </a>
          )}
        </div>
      </div>

      {/* Primary Navigation Tabs: Settings & Overview (Default), Files, AI Memory, Deployment */}
      <div className="px-6 border-b border-white/[0.06] bg-[#090909] flex items-center justify-between flex-shrink-0 h-11">
        <div className="flex items-center gap-1 h-full">
          <button
            onClick={() => setActiveTab("settings")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "settings"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            {/* Reverted original settings & overview gear icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings & Overview</span>
          </button>

          <button
            onClick={() => setActiveTab("terminal")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "terminal"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            <Icon icon="lucide:terminal" width={14} height={14} />
            <span>Terminal</span>
            {project?.container && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Docker Container Active" />
            )}
          </button>

          <button
            onClick={() => setActiveTab("files")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "files"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            <FolderIcon open={activeTab === "files"} />
            <span>Files</span>
          </button>

          <button
            onClick={() => setActiveTab("memory")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "memory"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            <span>AI Memory</span>
          </button>

          <button
            onClick={() => setActiveTab("deployment")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "deployment"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span>Deployment</span>
          </button>

          <button
            onClick={() => setActiveTab("security")}
            className={`relative h-full px-4 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${activeTab === "security"
              ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-white after:shadow-[0_0_10px_rgba(255,255,255,0.8),0_0_20px_rgba(255,255,255,0.4)]"
              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
              }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Security</span>
            {securityScans[0]?.status === "danger" && (
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* TAB 1: SETTINGS & OVERVIEW (Full Page with Anchor Sidebar) */}
        {activeTab === "settings" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Anchor Sub-Sidebar */}
            <div className="w-56 border-r border-white/[0.06] bg-[#090909] p-3 flex flex-col justify-between flex-shrink-0">
              <div className="space-y-1">
                <div className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-wider text-white/40">
                  Settings Sections
                </div>

                <button
                  type="button"
                  onClick={() => scrollToSection("general")}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all cursor-pointer ${activeSection === "general"
                    ? "bg-white/10 text-white font-semibold shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                    }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  <span>General</span>
                </button>

                <button
                  type="button"
                  onClick={() => scrollToSection("services")}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all cursor-pointer ${activeSection === "services"
                    ? "bg-white/10 text-white font-semibold shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                    }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
                  <span>Connected Services</span>
                </button>

                <button
                  type="button"
                  onClick={() => scrollToSection("domain")}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all cursor-pointer ${activeSection === "domain"
                    ? "bg-white/10 text-white font-semibold shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                    }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                  <span>Domain & Network</span>
                </button>

                <button
                  type="button"
                  onClick={() => scrollToSection("env")}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all cursor-pointer ${activeSection === "env"
                    ? "bg-white/10 text-white font-semibold shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                    }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <span>Environment (.env)</span>
                </button>

                <button
                  type="button"
                  onClick={() => scrollToSection("danger")}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all cursor-pointer ${activeSection === "danger"
                    ? "bg-red-500/15 text-red-300 font-semibold shadow-sm border border-red-500/20"
                    : "text-red-400/60 hover:text-red-300 hover:bg-red-500/[0.08]"
                    }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span>Danger Zone</span>
                </button>
              </div>

              {/* Sidebar Footer: Quick Access to Monitor Logs */}
              <div className="pt-3 border-t border-white/[0.06]">
                <Link
                  href={`/monitor/${id}`}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 text-white/50 hover:text-white hover:bg-white/[0.04] transition-all"
                  title="Open live logs and monitor"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  <span>Monitor Logs ↗</span>
                </Link>
              </div>
            </div>

            {/* Settings Full Scrollable Content */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-6 scroll-smooth bg-[#060606]"
            >
              <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-[60vh]">

                {/* 1. GENERAL IDENTITY SECTION */}
                <div id="section-general" className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                  <h2 className="font-sans font-bold text-lg text-white tracking-tight mb-1">Project Identity & Execution</h2>
                  <p className="text-xs text-white/50 mb-5">
                    Rename this project and inspect local root directory paths.
                  </p>

                  <form onSubmit={handleSaveName} className="flex flex-col sm:flex-row gap-3 items-end">
                    <div className="flex-1 w-full">
                      <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">Project Name</label>
                      <input
                        type="text"
                        required
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        className="w-full bg-[#141414] border border-white/10 focus:border-white/25 focus:outline-none text-xs text-white placeholder:text-white/30 rounded-xl py-2 px-3 transition-all"
                        placeholder="e.g. PutmeIn, yukthi"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={savingName || projectName === project?.name}
                      className="bg-white text-black font-bold text-xs px-4 py-2 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {savingName && <SpinIcon size={12} />}
                      <span>{nameSaved ? "Saved!" : "Save Name"}</span>
                    </button>
                  </form>

                  <div className="mt-5 pt-5 border-t border-white/[0.06]">
                    <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">Project Absolute Path</label>
                    <p className="text-xs font-mono p-3 rounded-xl text-white/80 select-all bg-[#121212] border border-white/[0.06]">
                      {project?.projectPath}
                    </p>
                  </div>

                  <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
                    <div>
                      <span className="block text-[11px] font-bold text-white/60 uppercase tracking-wider mb-0.5">Live Log Streaming & Diagnostic Tools</span>
                      <p className="text-xs text-white/45">
                        Inspect real-time terminal output, error logs, and AI self-healing tools.
                      </p>
                    </div>
                    <Link
                      href={`/monitor/${id}`}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all flex items-center gap-1.5 flex-shrink-0"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                      <span>Open Monitor Logs</span>
                    </Link>
                  </div>
                </div>

                {/* 2. CONNECTED SERVICES SECTION */}
                <div id="section-services">
                  <h2 className="font-sans font-bold text-lg text-white tracking-tight mb-1">Connected Services</h2>
                  <p className="text-xs text-white/50 mb-5">
                    Integrations linking this workspace to Docker container runtimes, CI/CD pipelines, and GitHub.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Container Card */}
                    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-5 flex flex-col justify-between shadow-lg">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Container</span>
                          {project?.container ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-300">
                              {project.container.status || "running"}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.02] border border-white/[0.05] text-white/35">
                              not connected
                            </span>
                          )}
                        </div>

                        {project?.container ? (
                          <div className="space-y-1.5 text-xs font-mono">
                            <p className="text-white font-semibold truncate">{project.container.name}</p>
                            <p className="text-[11px] text-white/50 truncate">Port: :{allocatedPort}</p>
                            {project.container.image && (
                              <p className="text-[10px] text-white/40 truncate">Img: {project.container.image}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-white/40">
                            No Docker container attached to this project. Run in Docker or deploy to link.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/[0.06]">
                        {project?.container ? (
                          <Link
                            href={`/containers/${project.container.id || project.container.name}`}
                            className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1"
                          >
                            <span>Manage Container ↗</span>
                          </Link>
                        ) : (
                          <Link href="/containers" className="text-xs font-medium text-white/50 hover:text-white flex items-center gap-1">
                            <span>View Containers ↗</span>
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* CI/CD Pipeline Card */}
                    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-5 flex flex-col justify-between shadow-lg">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">CI/CD Pipeline</span>
                          {pipeline ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-sky-500/[0.08] border border-sky-500/20 text-sky-300">
                              {pipeline.status || "active"}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.02] border border-white/[0.05] text-white/35">
                              not linked
                            </span>
                          )}
                        </div>

                        {pipeline ? (
                          <div className="space-y-1.5 text-xs font-mono">
                            <p className="text-white font-semibold truncate">{pipeline.name}</p>
                            <p className="text-[11px] text-white/50 truncate">Branch: {pipeline.branch || "main"}</p>
                            {pipeline.repoUrl && (
                              <p className="text-[10px] text-white/40 truncate">{pipeline.repoUrl.replace(/^https?:\/\//, "")}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-white/40">
                            No automated CI/CD pipeline linked. Link a Git repository to automate builds.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/[0.06]">
                        <Link href="/cicd" className="text-xs font-medium text-white/50 hover:text-white flex items-center gap-1">
                          <span>{pipeline ? "View Pipeline ↗" : "Setup CI/CD ↗"}</span>
                        </Link>
                      </div>
                    </div>

                    {/* GitHub Account Card */}
                    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-5 flex flex-col justify-between shadow-lg">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">GitHub Account</span>
                          {github.connected ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-300">
                              connected
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/[0.08] border border-amber-500/20 text-amber-300/80">
                              disconnected
                            </span>
                          )}
                        </div>

                        {github.connected ? (
                          <div className="space-y-1.5 text-xs">
                            <p className="text-white font-semibold flex items-center gap-1.5">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                              <span>@{github.integration?.githubUsername || "GitHub User"}</span>
                            </p>
                            <p className="text-[11px] text-white/50">Syncing commits and webhooks</p>
                          </div>
                        ) : (
                          <p className="text-xs text-white/40">
                            GitHub account is currently disconnected. Connect to sync repos and automated webhooks.
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/[0.06]">
                        <Link href="/github" className="text-xs font-medium text-white/50 hover:text-white flex items-center gap-1">
                          <span>{github.connected ? "Manage GitHub ↗" : "Connect GitHub ↗"}</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. DOMAIN & NETWORK SECTION */}
                <div id="section-domain" className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                  <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                    <div>
                      <h2 className="font-sans font-bold text-lg text-white tracking-tight mb-1">Domain & Port Routing</h2>
                      <p className="text-xs text-white/40">
                        Configure multiple custom domains or sslip.io addresses. Incoming traffic will be reverse-proxied to this project's container.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCheckExposure}
                      disabled={checkingExposure}
                      className="ray-btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                    >
                      {checkingExposure && <SpinIcon size={11} />}
                      <span>{exposureChecked ? "Checked!" : "Check IP Exposure"}</span>
                    </button>
                  </div>

                  {/* Domain Collision / Save Error Banner */}
                  {domainError && (
                    <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon icon="lucide:alert-triangle" className="text-red-400 shrink-0" width={16} height={16} />
                        <span className="font-mono">{domainError}</span>
                      </div>
                      <button
                        onClick={() => setDomainError(null)}
                        className="text-white/40 hover:text-white text-xs px-2 py-0.5 rounded cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* IP Exposure Status Banner */}
                  <div className={`mb-5 p-4 rounded-2xl flex items-start gap-3 border transition-colors ${network.isPubliclyExposed
                    ? "bg-emerald-500/[0.04] border-emerald-500/20"
                    : "bg-amber-500/[0.04] border-amber-500/20"
                    }`}>
                    <div className="flex-1 text-xs">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`font-mono text-xs font-semibold ${network.isPubliclyExposed ? "text-emerald-300" : "text-amber-300"
                          }`}>
                          {network.isPubliclyExposed ? "Public Server IP Exposed" : "Local Machine: IP Not Publicly Exposed"}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${network.isPubliclyExposed
                          ? "bg-emerald-500/[0.1] border border-emerald-500/20 text-emerald-200"
                          : "bg-amber-500/[0.1] border border-amber-500/20 text-amber-200"
                          }`}>
                          Local: {network.localIp}
                        </span>
                        {network.publicIp && network.publicIp !== network.localIp && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-white/60">
                            NAT / Router: {network.publicIp}
                          </span>
                        )}
                      </div>
                      <p className="text-white/50 text-[11px] leading-relaxed">
                        {network.isPubliclyExposed
                          ? "This machine has a direct public IP interface. Custom domains and wildcard sslip.io domains will resolve globally across the internet."
                          : "This machine is running on a private local network (LAN / NAT). External internet traffic cannot reach this machine directly without port forwarding or a public VPS. Domain names and sslip.io will only resolve on this local machine or LAN."}
                      </p>
                    </div>
                  </div>

                  {/* Configured Domains List */}
                  <div className="mb-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-white/50 uppercase font-mono tracking-wider">
                        Active Configured Domains ({parseProjectDomains(domainInput).length})
                      </span>
                      {parseProjectDomains(domainInput).length > 1 && (
                        <span className="text-[10px] text-white/40 font-mono">
                          First domain is used for primary &quot;Open App&quot; buttons
                        </span>
                      )}
                    </div>

                    {parseProjectDomains(domainInput).length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-white/10 bg-white/[0.01] text-center text-xs text-white/40">
                        No domains assigned yet. Traffic routes directly via port :{allocatedPort}.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {parseProjectDomains(domainInput).map((domain, idx) => {
                          const isPrimary = idx === 0;
                          const href = domain.startsWith("http://") || domain.startsWith("https://")
                            ? domain
                            : `http://${domain}`;
                          return (
                            <div
                              key={domain}
                              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#080808] border border-white/[0.06] hover:border-white/15 transition-all"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isPrimary ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[10px] font-mono shrink-0">
                                    Primary
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/10 text-white/40 text-[10px] font-mono shrink-0">
                                    #{idx + 1}
                                  </span>
                                )}
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-xs text-white hover:text-emerald-300 transition-colors truncate flex items-center gap-1.5"
                                >
                                  <span>{domain}</span>
                                  <Icon icon="lucide:external-link" width={11} height={11} className="text-white/40 shrink-0" />
                                </a>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleCheckDomain(domain)}
                                  disabled={checkingDomain}
                                  className="ray-btn-ghost text-[10.5px] font-mono px-2.5 py-1 rounded-md"
                                >
                                  Check DNS
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDomain(domain)}
                                  disabled={savingDomain}
                                  title="Remove domain"
                                  className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Icon icon="lucide:x" width={14} height={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Quick Add Actions: sslip.io and Port */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-5">
                    {/* sslip.io Quick-Generate Card */}
                    <div className="p-4.5 rounded-xl flex flex-col justify-between gap-3 bg-[#080808] border border-white/[0.08] shadow-sm">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon icon="lucide:zap" className="text-white/70" width={13} height={13} />
                          <span className="text-xs font-mono font-semibold text-white">
                            sslip.io Wildcard Domain
                          </span>
                        </div>
                        <p className="text-[11px] text-white/70 font-mono truncate">
                          {project?.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.{network.publicIp && network.publicIp !== "127.0.0.1" ? network.publicIp : (network.localIp || "127.0.0.1")}.sslip.io
                        </p>
                        <p className="text-[10px] text-white/40 mt-1">
                          Resolves automatically without creating DNS records.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleApplySslipDomain}
                        disabled={savingDomain}
                        className="ray-btn-ghost w-full py-1.5 text-xs text-center font-semibold"
                      >
                        + Add sslip.io Domain
                      </button>
                    </div>

                    {/* Allocated Port Card */}
                    <div className="p-4.5 rounded-xl flex flex-col justify-between gap-3 bg-[#080808] border border-white/[0.08] shadow-sm">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon icon="lucide:radio" className="text-white/70" width={13} height={13} />
                          <span className="text-xs font-mono font-semibold text-white">
                            Local Allocated Port
                          </span>
                        </div>
                        <p className="text-[11px] text-white/70 font-mono">
                          http://localhost:{allocatedPort}
                        </p>
                        <p className="text-[10px] text-white/40 mt-1">
                          Direct port routing for local development.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSwitchToAllocatedPort}
                          disabled={savingDomain}
                          className="ray-btn-ghost flex-1 py-1.5 text-xs text-center font-semibold"
                        >
                          + Add Port URL
                        </button>
                        {project?.projectUrl && (
                          <button
                            type="button"
                            onClick={handleResetPort}
                            disabled={savingDomain}
                            className="ray-btn-ghost px-3 py-1.5 text-xs text-white/40 hover:text-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Custom Domain Input & DNS Verifier */}
                  <div className="space-y-3">
                    <label className="block text-[11px] font-bold text-white/50 uppercase font-mono tracking-wider">
                      Edit / Add Custom Domains
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        type="text"
                        placeholder="e.g. app.mycompany.com, https://api.mycompany.com"
                        value={domainInput}
                        onChange={(e) => {
                          setDomainInput(e.target.value);
                          setDomainCheckResult(null);
                          if (domainError) setDomainError(null);
                        }}
                        className="ray-input font-mono text-xs flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleCheckDomain()}
                        disabled={checkingDomain || !domainInput.trim()}
                        className="ray-btn-ghost text-xs px-3.5 py-2 flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {checkingDomain && <SpinIcon size={12} />}
                        <span>Verify DNS</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveDomain()}
                        disabled={savingDomain}
                        className="ray-btn-primary text-xs px-4 py-2 flex items-center gap-1.5 flex-shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {savingDomain && <SpinIcon size={12} />}
                        <span>{domainSaved ? "Saved!" : "Save Domains"}</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-white/40 leading-relaxed">
                      Separate multiple domains with commas. Each domain pointing to this server's IP will route to this project. Duplicate domains assigned to another project will be blocked.
                    </p>

                    {/* DNS Verification Result Badge */}
                    {domainCheckResult && (
                      <div className={`p-3.5 rounded-xl text-xs font-mono flex items-center justify-between gap-2 border transition-all ${domainCheckResult.matchesServerIp
                        ? "bg-emerald-500/[0.05] border-emerald-500/20"
                        : domainCheckResult.resolved
                          ? "bg-amber-500/[0.05] border-amber-500/20"
                          : "bg-red-500/[0.05] border-red-500/20"
                        }`}>
                        <div>
                          {domainCheckResult.matchesServerIp ? (
                            <span className="text-emerald-300 font-semibold flex items-center gap-1.5">
                              ✓ A-Record Verified: points to {domainCheckResult.resolvedIps?.join(", ")}
                            </span>
                          ) : domainCheckResult.resolved ? (
                            <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                              ⚠ Resolves to {domainCheckResult.resolvedIps?.join(", ")}, expecting server IP ({network.publicIp || network.localIp})
                            </span>
                          ) : (
                            <span className="text-red-300 font-semibold flex items-center gap-1.5">
                              ✗ No DNS A-record resolved for this domain. Add an A record pointing to {network.publicIp || network.localIp}.
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. ENVIRONMENT VARIABLES SECTION */}
                <div id="section-env" className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <h2 className="font-sans font-bold text-lg text-white tracking-tight mb-1">Environment Variables (.env)</h2>
                      <p className="text-xs text-white/50">
                        Variables are automatically loaded from and saved directly into the project root <code className="text-white/80 font-mono">.env</code>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={rawEnvMode ? handleCloseRawEnv : handleOpenRawEnv}
                      disabled={loadingRawEnv}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all flex-shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {loadingRawEnv ? "Loading..." : rawEnvMode ? "Structured View" : "Raw .env Editor"}
                    </button>
                  </div>

                  {envActionMessage && (
                    <div className="mb-4 px-3 py-2 rounded-xl text-xs font-mono text-white/80 bg-white/[0.04] border border-white/[0.08]">
                      {envActionMessage}
                    </div>
                  )}

                  {rawEnvMode ? (
                    <div className="space-y-3 mt-4">
                      <textarea
                        rows={10}
                        value={rawEnv}
                        onChange={(e) => setRawEnv(e.target.value)}
                        placeholder="# Define your .env keys here\nPORT=4000\nDATABASE_URL=..."
                        className="w-full bg-[#121212] border border-white/10 focus:border-white/25 focus:outline-none font-mono text-xs text-white p-3.5 leading-relaxed rounded-xl"
                        style={{ resize: "vertical" }}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={handleCloseRawEnv}
                          className="text-white/60 hover:text-white text-xs px-3 py-2 rounded-xl border border-white/[0.08] transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveRawEnv}
                          disabled={savingRawEnv}
                          className="bg-white text-black font-bold text-xs px-4 py-2 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {savingRawEnv && <SpinIcon size={12} />}
                          <span>Save .env File</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className="space-y-4 mt-4">
                      {/* Add Variable Form */}
                      <form onSubmit={handleAddEnvVar} className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 items-end p-4 rounded-xl bg-[#111111] border border-white/[0.06]">
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1">Key</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. DATABASE_URL, PORT"
                            value={newEnvKey}
                            onChange={(e) => setNewEnvKey(e.target.value)}
                            className="w-full bg-[#161616] border border-white/10 focus:border-white/25 focus:outline-none text-xs font-mono text-white placeholder:text-white/30 rounded-lg py-1.5 px-2.5 transition-all"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1">Value</label>
                          <input
                            type="text"
                            placeholder="Value"
                            value={newEnvValue}
                            onChange={(e) => setNewEnvValue(e.target.value)}
                            className="w-full bg-[#161616] border border-white/10 focus:border-white/25 focus:outline-none text-xs font-mono text-white placeholder:text-white/30 rounded-lg py-1.5 px-2.5 transition-all"
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <button
                            type="submit"
                            disabled={addingEnv || !newEnvKey.trim()}
                            className="bg-white text-black font-bold text-xs py-2 px-3 w-full rounded-lg hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {addingEnv && <SpinIcon size={12} />}
                            <span>Add</span>
                          </button>
                        </div>
                      </form>

                      {/* Existing Variables List */}
                      {loadingEnv ? (
                        <div className="py-6 text-center text-xs text-white/40">Loading variables...</div>
                      ) : envVars.length === 0 ? (
                        <div className="p-6 text-center text-xs text-white/40 border border-dashed rounded-xl border-white/[0.08]">
                          No environment variables found in .env. Add one above to create it.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                          <table className="w-full text-left text-xs font-mono">
                            <thead>
                              <tr className="border-b border-white/[0.06] text-white/40 text-[10px] uppercase tracking-wider bg-white/[0.02]">
                                <th className="py-2.5 px-3.5">Key</th>
                                <th className="py-2.5 px-3.5">Value</th>
                                <th className="py-2.5 px-3.5 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                              {envVars.map((v) => {
                                return (
                                  <tr key={v.key} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="py-2.5 px-3.5 text-white font-semibold">{v.key}</td>
                                    <td className="py-2.5 px-3.5 text-white/60">
                                      <span className="truncate max-w-xs">{v.value}</span>
                                    </td>
                                    <td className="py-2.5 px-3.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteEnvVar(v.key)}
                                        className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer px-2 py-1"
                                        title="Delete variable"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </div>
                  )}
                </div>

                {/* 5. DANGER ZONE SECTION */}
                <div id="section-danger" className="rounded-2xl border border-red-500/20 bg-[#0e0707] p-6 shadow-lg">
                  <div className="flex items-center gap-2.5 mb-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <h2 className="font-sans font-bold text-lg text-white tracking-tight">Danger Zone</h2>
                  </div>
                  <p className="text-xs text-white/50 mb-5">
                    Permanently delete this project and wipe all associated resources, including running Docker containers, image builds, CI/CD pipelines, 24/7 monitors, logs, and workspace files from disk.
                  </p>

                  <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-red-200">Delete this project</p>
                      <p className="text-[11px] text-white/40 mt-0.5">
                        Once deleted, the project, containers, files on disk, and logs cannot be recovered.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer flex-shrink-0"
                    >
                      <Icon icon="lucide:trash-2" width={14} height={14} />
                      <span>Delete Project</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* TAB: TERMINAL VIEW (Docker Container or Host Shell) */}
        {activeTab === "terminal" && project && (
          <div className="flex-1 p-6 bg-[#060606] flex flex-col min-h-0 overflow-hidden">
            <TerminalView
              title={`${project.name} Terminal`}
              initialCwd={project.projectPath}
              projectPath={project.projectPath}
              projectName={project.name}
              containerId={project.container?.id || project.container?.name || project.deployment?.containerName || null}
              containerName={project.container?.name || project.deployment?.containerName || null}
              hasContainer={!!(project.container || project.deployment?.containerName)}
              shellMode={project.container || project.deployment?.containerName ? "container" : "host"}
            />
          </div>
        )}

        {/* TAB 2: FILES VIEW */}
        {activeTab === "files" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Interactive File Tree */}
            <div className="w-64 border-r border-white/[0.06] bg-[#090909] flex flex-col flex-shrink-0">
              <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Explorer</span>
                <button
                  onClick={fetchFiles}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md text-white/50 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer"
                  title="Refresh files"
                >
                  ↻ Refresh
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {loadingFiles ? (
                  <div className="p-4 text-center text-xs text-white/40">
                    Loading file tree...
                  </div>
                ) : filesTree.length === 0 ? (
                  <div className="p-4 text-center text-xs text-white/40">
                    No files found
                  </div>
                ) : (
                  renderTree(filesTree)
                )}
              </div>
            </div>

            {/* Right: Code Viewer */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#060606]">
              <div className="px-4 border-b border-white/[0.06] bg-[#090909] flex items-center justify-between flex-shrink-0 h-11">
                <div className="flex items-center gap-2">
                  <FileIcon />
                  <span className="font-mono text-xs text-white font-medium">
                    {selectedFile ? selectedFile.name : "Select a file"}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {selectedFile ? (
                  loadingContent ? (
                    <div className="flex items-center justify-center py-20 gap-2 text-white/40">
                      <SpinIcon /><span className="text-xs font-medium">Reading file...</span>
                    </div>
                  ) : (
                    <pre
                      className="text-xs leading-relaxed font-mono p-4 rounded-2xl overflow-x-auto bg-[#0a0a0a] border border-white/[0.06] text-white/80"
                    >
                      {fileContent || "(Empty file)"}
                    </pre>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-center text-white/40">
                    <p className="text-xs">Select a file from the explorer on the left to preview code.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AI MEMORY VIEW & EDIT */}
        {activeTab === "memory" && (
          <div className="flex-1 overflow-y-auto p-6 bg-[#060606]">
            <div className="max-w-3xl mx-auto">
              <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h3 className="font-sans font-bold text-base text-white flex items-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                    <span>AI Memory & Project Context</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingMemory(!editingMemory)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
                    >
                      {editingMemory ? "View Mode" : "Edit Memory"}
                    </button>
                    <button
                      type="button"
                      onClick={handleReanalyze}
                      disabled={analyzing}
                      className="bg-white text-black font-bold text-xs px-3.5 py-1.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {analyzing ? <SpinIcon size={12} /> : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                      )}
                      <span>Re-analyze</span>
                    </button>
                  </div>
                </div>

                {editingMemory ? (
                  /* Editable AI Memory */
                  <div className="space-y-3">
                    <p className="text-xs text-white/50">
                      Modify the AI memory notes and context. Ray AI uses this knowledge when debugging and analyzing logs.
                    </p>
                    <textarea
                      rows={14}
                      value={memoryDraft}
                      onChange={(e) => setMemoryDraft(e.target.value)}
                      placeholder="Enter AI memory details about this project..."
                      className="w-full bg-[#121212] border border-white/10 focus:border-white/25 focus:outline-none font-mono text-xs text-white p-4 leading-relaxed rounded-xl"
                      style={{ resize: "vertical" }}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMemoryDraft(project?.memory || "");
                          setEditingMemory(false);
                        }}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveMemory}
                        disabled={savingMemory}
                        className="bg-white text-black font-bold text-xs px-4 py-1.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {savingMemory && <SpinIcon size={12} />}
                        <span>{memorySaved ? "Saved!" : "Save Memory"}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View AI Memory */
                  <div>
                    {project?.memory ? (
                      <pre
                        className="text-xs leading-relaxed whitespace-pre-wrap font-sans p-4 rounded-2xl bg-[#090909] border border-white/[0.06] text-white/85"
                      >
                        {project.memory}
                      </pre>
                    ) : (
                      <div className="p-8 text-center text-white/40">
                        <p className="text-xs mb-3">No AI memory generated yet.</p>
                        <button
                          onClick={handleReanalyze}
                          disabled={analyzing}
                          className="bg-white text-black font-bold text-xs px-3.5 py-1.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {analyzing && <SpinIcon size={12} />}
                          <span>Trigger AI Code Analysis</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DEPLOYMENT VIEW */}
        {activeTab === "deployment" && (
          <div className="flex-1 overflow-y-auto p-6 bg-[#060606]">
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              {project?.deployment ? (
                <>
                  {/* Deployment Status Card */}
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <h2 className="font-sans font-bold text-xl text-white tracking-tight">
                            {project.deployment.name}
                          </h2>
                          <span
                            className="text-[11px] font-bold px-2.5 py-0.5 rounded capitalize font-mono"
                            style={{
                              background:
                                project.deployment.status === "healthy"
                                  ? "rgba(34,197,94,0.12)"
                                  : project.deployment.status === "failed"
                                    ? "rgba(239,68,68,0.15)"
                                    : "rgba(234,179,8,0.12)",
                              color:
                                project.deployment.status === "healthy"
                                  ? "#22c55e"
                                  : project.deployment.status === "failed"
                                    ? "#ef4444"
                                    : "#eab308",
                              border: `1px solid ${project.deployment.status === "healthy"
                                ? "rgba(34,197,94,0.25)"
                                : project.deployment.status === "failed"
                                  ? "rgba(239,68,68,0.3)"
                                  : "rgba(234,179,8,0.25)"
                                }`,
                            }}
                          >
                            {project.deployment.status}
                          </span>
                          {project.deployment.hostPort && (
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400">
                              Port :{project.deployment.hostPort}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/40 mt-1 font-mono">
                          Source: {project.deployment.sourceType} · {project.deployment.projectPath}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {project.deployment.status === "failed" && (
                          <button
                            onClick={() => setShowTroubleshooter(true)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>⚡</span>
                            <span>Ray AI Troubleshooter</span>
                          </button>
                        )}
                        <button
                          onClick={handleDeployOrRedeploy}
                          disabled={deploying || project.deployment.status === "building"}
                          className="bg-white text-black font-bold text-xs px-3.5 py-1.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <svg className={deploying ? "animate-spin" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                          <span>{deploying ? "Redeploying…" : "Redeploy"}</span>
                        </button>
                        <Link
                          href={`/deployments/${project.deployment.id}`}
                          className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
                        >
                          Full Details ↗
                        </Link>
                      </div>
                    </div>

                    {/* Failure Banner */}
                    {project.deployment.status === "failed" && (
                      <div className="mt-5 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="text-lg">⚠️</span>
                          <div>
                            <p className="text-xs font-bold text-red-300 font-mono">Deployment Failed</p>
                            <p className="text-[11px] text-red-400/80 mt-0.5">
                              The build step or Docker container exited with an error. Ray AI can inspect the build logs and prescribe a direct fix.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowTroubleshooter(true)}
                          className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm flex-shrink-0"
                        >
                          <span>⚡</span>
                          <span>Diagnose Root Cause</span>
                        </button>
                      </div>
                    )}

                    {/* Quick Metadata Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/[0.06]">
                      <div className="p-3 rounded-xl bg-[#121212] border border-white/[0.06]">
                        <span className="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">Docker Container</span>
                        <p className="text-xs font-mono text-white/90 truncate">
                          {project.deployment.containerName || `ray-${project.deployment.name}`}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-[#121212] border border-white/[0.06]">
                        <span className="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">Allocated Port</span>
                        <p className="text-xs font-mono text-sky-400">
                          {project.deployment.hostPort ? `Port :${project.deployment.hostPort}` : "Dynamic"}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-[#121212] border border-white/[0.06]">
                        <span className="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">Live Endpoint</span>
                        {effectiveUrl ? (
                          <a href={effectiveUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-emerald-400 hover:underline truncate block">
                            {effectiveUrl} ↗
                          </a>
                        ) : (
                          <span className="text-xs font-mono text-white/40">Not assigned</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Live Build Logs Viewer */}
                  <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] overflow-hidden shadow-lg flex flex-col">
                    <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-sans font-bold text-xs text-white">Build & Container Output</span>
                        <span className="text-[10px] font-mono text-white/30">── Live Logs</span>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(project.deployment?.buildLogs || "");
                          alert("Build logs copied to clipboard!");
                        }}
                        className="px-2.5 py-1 text-[11px] font-mono rounded-lg bg-white/[0.05] hover:bg-white/10 text-white/60 hover:text-white border border-white/[0.08] transition-colors cursor-pointer"
                      >
                        Copy Logs
                      </button>
                    </div>
                    <div className="p-5 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto" style={{ background: "#020202", color: "#e2e8f0" }}>
                      <pre className="whitespace-pre-wrap font-mono">
                        {project.deployment.buildLogs || "No build logs recorded yet. Application is packaged and ready."}
                      </pre>
                    </div>
                  </div>
                </>
              ) : (
                /* Empty Deployment State */
                <div className="p-12 rounded-2xl border border-white/[0.08] bg-[#0c0c0c] flex flex-col items-center justify-center text-center shadow-lg">
                  <div className="w-12 h-12 rounded-2xl mb-4 flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/70">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </div>
                  <h3 className="font-sans font-bold text-base text-white mb-1">No Deployment Configured</h3>
                  <p className="text-xs text-white/40 max-w-md mb-6 leading-relaxed">
                    Deploy this workspace as a live isolated Docker container. Ray automatically detects your stack (Node, Next.js, Go, Python, Dockerfile), maps ports, and launches it.
                  </p>
                  <button
                    onClick={handleDeployOrRedeploy}
                    disabled={deploying}
                    className="bg-white text-black font-bold text-xs px-5 py-2.5 rounded-xl hover:bg-white/90 active:scale-95 transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {deploying ? <SpinIcon size={14} /> : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                    <span>{deploying ? "Initiating Deployment…" : "Deploy Project with Ray"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SECURITY AUDIT & GUARDRAILS VIEW */}
        {activeTab === "security" && (
          <div className="flex-1 overflow-y-auto p-6 bg-[#060606]">
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              {/* Top Security Status Header */}
              {(() => {
                const latestScan = securityScans[0];
                const blockedRun = pipeline?.runs?.find((r) => r.status === "blocked_danger");

                let findingsList: any[] = [];
                try {
                  if (latestScan?.findings) findingsList = JSON.parse(latestScan.findings);
                } catch { /* silent */ }

                return (
                  <>
                    {/* DUAL-CONSENT OVERRIDE CARD (If pipeline is blocked on danger) */}
                    {blockedRun && (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6 shadow-xl">
                        <div className="flex items-start gap-4">
                          <div className="p-3 rounded-xl bg-red-500/15 text-red-400 shrink-0">
                            <Icon icon="lucide:alert-octagon" className="w-6 h-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-base font-bold text-white">CI/CD Deployment Blocked by Security Guardrail</h3>
                              <span className="text-[10px] uppercase font-bold font-mono tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                                Danger Severity
                              </span>
                            </div>
                            <p className="text-xs text-white/70 mt-1 leading-relaxed">
                              The pre-deployment security scan detected critical danger-level vulnerabilities on commit{" "}
                              <span className="font-mono text-white font-semibold">({blockedRun.commitHash?.slice(0, 7)})</span>.
                              Public deployment has been halted. Two-step confirmation consent is required to authorize override.
                            </p>

                            {overrideError && <div className="text-xs text-red-400 font-semibold mt-2">{overrideError}</div>}
                            {overrideSuccess ? (
                              <div className="text-xs text-emerald-400 font-semibold mt-3 flex items-center gap-1.5">
                                <Icon icon="lucide:check-circle" className="w-4 h-4" />
                                Dual consent verified! Override authorized and deployment initiated.
                              </div>
                            ) : (
                              <div className="mt-4 p-4 rounded-xl bg-[#080808] border border-white/[0.08] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <label className="flex items-center gap-2.5 text-xs text-white/80 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={overrideAck}
                                    onChange={(e) => setOverrideAck(e.target.checked)}
                                    className="rounded bg-[#181818] border-white/20 text-red-500 focus:ring-red-500 w-4 h-4 cursor-pointer"
                                  />
                                  <span className="font-medium">
                                    I acknowledge the identified danger-level findings and consent to deploy
                                  </span>
                                </label>

                                <button
                                  onClick={() => handleAuthorizeProjectOverride(blockedRun.id, pipeline?.id, latestScan?.id)}
                                  disabled={!overrideAck || overrideSubmitting}
                                  className="ray-btn-primary px-4 py-2 text-xs font-bold shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {overrideSubmitting ? <SpinIcon size={14} /> : <Icon icon="lucide:unlock" className="w-4 h-4" />}
                                  <span>Confirm & Force Deploy</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Overall Project Posture Banner */}
                    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="font-sans font-bold text-xl text-white tracking-tight">Security Posture</h2>
                            {latestScan ? (
                              latestScan.status === "danger" ? (
                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded uppercase font-mono bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                  Danger ({latestScan.dangerCount} Critical)
                                </span>
                              ) : latestScan.status === "warning" ? (
                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded uppercase font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  Warning ({latestScan.warnCount} Attention)
                                </span>
                              ) : (
                                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded uppercase font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  Clean (Passing)
                                </span>
                              )
                            ) : (
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded uppercase font-mono bg-white/[0.04] text-white/40 border border-white/[0.08]">
                                Unscanned
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-white/40 mt-1">
                            {latestScan
                              ? `Last audited: ${new Date(latestScan.createdAt).toLocaleString()} (${latestScan.trigger.replace(/_/g, " ")})`
                              : "No security audits conducted on this project yet."}
                          </p>
                        </div>

                        <button
                          onClick={handleRunProjectScan}
                          disabled={scanningSecurity}
                          className="ray-btn-primary px-4 py-2 text-xs cursor-pointer shrink-0"
                        >
                          {scanningSecurity ? (
                            <>
                              <SpinIcon size={14} />
                              <span>Running Audit…</span>
                            </>
                          ) : (
                            <>
                              <Icon icon="lucide:shield-check" className="w-4 h-4" />
                              <span>Run Security Audit</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Counts breakdown */}
                      {latestScan && (
                        <div className="grid grid-cols-3 gap-3 mt-6 pt-5 border-t border-white/[0.06]">
                          <div className="p-3.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
                            <span className="text-[11px] font-medium text-red-400 block">Danger CVEs</span>
                            <span className="text-xl font-bold text-red-400 mt-0.5 block font-mono">{latestScan.dangerCount}</span>
                          </div>
                          <div className="p-3.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                            <span className="text-[11px] font-medium text-amber-400 block">Warnings</span>
                            <span className="text-xl font-bold text-amber-400 mt-0.5 block font-mono">{latestScan.warnCount}</span>
                          </div>
                          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                            <span className="text-[11px] font-medium text-white/50 block">Info & Best Practice</span>
                            <span className="text-xl font-bold text-white/80 mt-0.5 block font-mono">{latestScan.infoCount}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Predefined Rules & Known CVEs Checklist */}
                    <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                        <Icon icon="lucide:check-square" className="w-4 h-4 text-emerald-400" />
                        <span>Predefined Rules & Known CVE Checklist</span>
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {securityRules.map((rule) => {
                          const isFailed = findingsList.some((f) => f.ruleId === rule.id && f.severity === "danger");
                          const isWarn = findingsList.some((f) => f.ruleId === rule.id && f.severity === "warning");

                          return (
                            <div
                              key={rule.id}
                              className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                                isFailed
                                  ? "bg-red-500/[0.06] border-red-500/25 text-red-200"
                                  : isWarn
                                  ? "bg-amber-500/[0.06] border-amber-500/25 text-amber-200"
                                  : "bg-white/[0.02] border-white/[0.06] text-white/70"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold truncate text-white">{rule.title}</span>
                                  {rule.cve && (
                                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                                      {rule.cve}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-white/40 mt-1 line-clamp-2">{rule.checklist}</p>
                              </div>

                              <span
                                className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded shrink-0 ${
                                  isFailed
                                    ? "bg-red-500/20 text-red-300"
                                    : isWarn
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                }`}
                              >
                                {isFailed ? "Fail" : isWarn ? "Warn" : "Pass"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Findings List */}
                    {findingsList.length > 0 && (
                      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                          <Icon icon="lucide:alert-circle" className="w-4 h-4 text-amber-400" />
                          <span>Detected Vulnerabilities ({findingsList.length})</span>
                        </h3>

                        <div className="space-y-3">
                          {findingsList.map((f: any, idx: number) => (
                            <div
                              key={f.id || idx}
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
                                  <div className="flex items-center gap-2 flex-wrap">
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
                                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                                        {f.cve}
                                      </span>
                                    )}
                                    <h4 className="text-xs font-bold text-white">{f.title}</h4>
                                  </div>
                                </div>

                                {f.file && (
                                  <span className="text-[11px] font-mono text-white/40 bg-white/[0.04] px-2 py-0.5 rounded border border-white/[0.06]">
                                    {f.file}
                                    {f.line ? `:${f.line}` : ""}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-white/70 mt-2 leading-relaxed">{f.description}</p>

                              {f.recommendation && (
                                <div className="mt-3 p-3 rounded-xl bg-[#060606] border border-white/[0.06] text-xs">
                                  <span className="text-emerald-400 font-semibold block mb-0.5">Remediation:</span>
                                  <code className="text-white/80 font-mono text-[11px] block whitespace-pre-wrap">{f.recommendation}</code>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scan Audit Logs */}
                    {latestScan?.logs && (
                      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c0c] p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Icon icon="lucide:terminal" className="w-4 h-4 text-white/40" />
                            <span>Security Execution Logs</span>
                          </h3>
                        </div>
                        <pre className="p-4 rounded-xl bg-[#050505] border border-white/[0.06] font-mono text-xs text-white/70 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                          {latestScan.logs}
                        </pre>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Ray AI Troubleshooter Modal */}
      <DeployDiagnosisModal
        isOpen={showTroubleshooter}
        onClose={() => setShowTroubleshooter(false)}
        deploymentId={project?.deployment?.id}
        deploymentName={project?.name || "Project"}
        buildLogs={project?.deployment?.buildLogs || undefined}
        onRedeploySuccess={() => {
          fetchProjectDetails();
        }}
      />

      {/* 2-Step Danger Zone Delete Modal */}
      {project && (
        <DeleteProjectModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          project={project}
          pipeline={pipeline}
          onDeleted={() => {
            setShowDeleteModal(false);
            router.replace("/projects");
          }}
        />
      )}
    </div>
  );
}

function DeleteProjectModal({
  isOpen,
  onClose,
  project,
  pipeline,
  onDeleted,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectData;
  pipeline: PipelineData | null;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setConfirmName("");
      setError(null);
      setDeleting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async () => {
    if (confirmName.trim() !== project.name.trim() || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete project");
      }
      onDeleted();
    } catch (err: any) {
      setError(err.message || "An error occurred during deletion");
      setDeleting(false);
    }
  };

  const containerName = project.container?.name || project.deployment?.containerName || `ray-${project.name.toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in font-sans">
      <div className="w-full max-w-lg rounded-2xl bg-[#0d0d0d] border border-white/10 shadow-2xl p-6 text-white flex flex-col gap-5 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={deleting}
          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        {step === 1 ? (
          <>
            {/* Step 1: Resource Review */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0 text-red-400">
                <Icon icon="lucide:alert-triangle" width={20} height={20} />
              </div>
              <div>
                <h3 className="font-sans font-bold text-lg text-white">Delete Project</h3>
                <p className="text-xs text-white/50 mt-1">
                  Are you sure you want to continue? Deleting <strong className="text-white">{project.name}</strong> will permanently wipe all associated resources.
                </p>
              </div>
            </div>

            {/* Linked Resources Breakdown List */}
            <div className="rounded-xl border border-white/[0.08] bg-[#070707] p-4 flex flex-col gap-3">
              <span className="text-[10px] uppercase font-bold tracking-wider text-white/40">
                Linked Resources to be Permanently Destroyed:
              </span>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="logos:docker-icon" width={16} height={16} className="shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-mono font-medium text-white/90">Docker Container & Image</p>
                  <p className="text-[11px] font-mono text-white/40 truncate">{containerName}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="lucide:box" width={16} height={16} className="shrink-0 mt-0.5 text-sky-400" />
                <div className="min-w-0">
                  <p className="font-medium text-white/90">Deployments</p>
                  <p className="text-[11px] text-white/40">{project.deployment ? `${project.deployment.name} (${project.deployment.sourceType})` : "Active deployment metadata"}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="lucide:git-branch" width={16} height={16} className="shrink-0 mt-0.5 text-purple-400" />
                <div className="min-w-0">
                  <p className="font-medium text-white/90">CI/CD Pipelines & Runs</p>
                  <p className="text-[11px] text-white/40">{pipeline ? `${pipeline.name} (${pipeline.branch})` : "Pipeline configurations"}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="lucide:activity" width={16} height={16} className="shrink-0 mt-0.5 text-emerald-400" />
                <div className="min-w-0">
                  <p className="font-medium text-white/90">24/7 AI Monitor & Alerts</p>
                  <p className="text-[11px] text-white/40">Real-time health watcher & incident records</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="lucide:folder" width={16} height={16} className="shrink-0 mt-0.5 text-amber-400" />
                <div className="min-w-0">
                  <p className="font-medium text-white/90">Physical Workspace Files on Disk</p>
                  <p className="text-[11px] font-mono text-white/40 truncate">{project.projectPath}</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <Icon icon="lucide:file-text" width={16} height={16} className="shrink-0 mt-0.5 text-white/40" />
                <div className="min-w-0">
                  <p className="font-medium text-white/90">Logs & Diagnostics</p>
                  <p className="text-[11px] text-white/40">Build logs, container logs, and AI memory</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <span>Continue</span>
                <span>→</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Name Confirmation */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0 text-red-400">
                <Icon icon="lucide:shield-alert" width={20} height={20} />
              </div>
              <div>
                <h3 className="font-sans font-bold text-lg text-white">Confirm Deletion</h3>
                <p className="text-xs text-white/50 mt-1">
                  This action cannot be undone. To verify, please type <strong className="text-red-300 font-mono select-all">{project.name}</strong> below:
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <Icon icon="lucide:alert-circle" width={14} height={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-white/60 uppercase tracking-wider">
                Project Name
              </label>
              <input
                type="text"
                autoFocus
                disabled={deleting}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmName.trim() === project.name.trim()) {
                    handleDelete();
                  }
                }}
                placeholder={`Type ${project.name} to confirm`}
                className="w-full bg-[#121212] border border-white/15 focus:border-red-400 focus:outline-none text-xs font-mono text-white placeholder:text-white/20 rounded-xl px-3.5 py-2.5 transition-all"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setStep(1)}
                className="px-3.5 py-2 text-xs font-medium rounded-xl text-white/50 hover:text-white hover:bg-white/[0.04] transition-all cursor-pointer disabled:opacity-40"
              >
                ← Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/70 hover:text-white border border-white/[0.08] transition-all cursor-pointer disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmName.trim() !== project.name.trim() || deleting}
                  onClick={handleDelete}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleting ? (
                    <>
                      <SpinIcon size={12} />
                      <span>Deleting Everything…</span>
                    </>
                  ) : (
                    <>
                      <Icon icon="lucide:trash-2" width={13} height={13} />
                      <span>Delete Everything</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
