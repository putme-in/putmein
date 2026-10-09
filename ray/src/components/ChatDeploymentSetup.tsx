"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { parseProjectSetup } from "@/lib/project-setup";
import DeploymentPipelineFlow from "./DeploymentPipelineFlow";

export default function ChatDeploymentSetup({ output, sessionId, proposalId, onMessage, onInvestigate }: {
  output: string; sessionId: string | null; proposalId: string;
  onMessage: (message: { id: string; content: string; createdAt: string }) => void;
  onInvestigate?: (deploymentId: string) => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [deploymentId, setDeploymentId] = useState("");
  const [state, setState] = useState<"ready" | "deploying" | "success" | "error">("ready");
  const [step, setStep] = useState("source");
  const [logs, setLogs] = useState("");
  const [notice, setNotice] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [container, setContainer] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [restored, setRestored] = useState(false);
  const options = useRef<Record<string, unknown>>({});
  const running = useRef(false);
  const submitted = useRef(false);
  const investigated = useRef(new Set<string>());
  const callbacks = useRef({ onMessage, onInvestigate });
  callbacks.current = { onMessage, onInvestigate };
  const key = sessionId ? `ray:chat-setup:${sessionId}:${proposalId}` : "";

  useEffect(() => {
    try {
      const marker = "RAY_DEPLOYMENT_SETUP:";
      const index = output.indexOf(marker);
      if (index < 0) throw new Error("Setup details were not received. Ask chat to prepare the deployment again.");
      const proposal = JSON.parse(output.slice(index + marker.length));
      setName(typeof proposal.name === "string" ? proposal.name.slice(0, 100) : "");
      const input = typeof proposal.source === "string" ? proposal.source : "";
      if (input.startsWith("https://")) {
        const parsed = new URL(input);
        if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Use a repository URL without credentials. Save private Git access in Settings.");
      } else if (input && !input.startsWith("/")) throw new Error("Choose an HTTPS repository or existing absolute path.");
      setSource(input);
      options.current = proposal.setup && typeof proposal.setup === "object" && !Array.isArray(proposal.setup) ? proposal.setup : {};
      if (typeof options.current.projectUrl === "string") setUrl(options.current.projectUrl);
      const saved = key ? localStorage.getItem(`${key}:deployment`) : null;
      if (saved && /^[a-zA-Z0-9_-]{1,128}$/.test(saved)) { setDeploymentId(saved); setResumed(true); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not restore deployment."); }
    setRestored(true);
  }, [output, key]);

  useEffect(() => {
    if (!deploymentId || !sessionId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function sync() {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId!)}/deployment-result`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deploymentId }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not read deployment status");
        if (controller.signal.aborted) return;
        callbacks.current.onMessage(data.message);
        if (data.status === "failed") {
          setState("error");
          // One investigation per deployment, including across page refreshes.
          const handled = `${key}:investigated:${deploymentId}`;
          let alreadyHandled = investigated.current.has(deploymentId);
          try { alreadyHandled ||= Boolean(localStorage.getItem(handled)); } catch { /* in-memory protection still applies */ }
          if (!alreadyHandled) {
            investigated.current.add(deploymentId);
            try { localStorage.setItem(handled, "1"); } catch { /* this tab still avoids repeated follow-ups */ }
            callbacks.current.onInvestigate?.(deploymentId);
          }
          return;
        }
        if (data.status === "healthy") { setState("success"); return; }
        if (data.status === "stopped") { setNotice("Deployment is stopped. Tell chat what you want to change before retrying."); return; }
      } catch (error) {
        if (controller.signal.aborted) return;
        setNotice(error instanceof Error ? error.message : "Status unavailable");
      }
      timer = setTimeout(sync, 5000);
    }
    void sync();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [deploymentId, sessionId, key]);

  async function deploy() {
    if (running.current || submitted.current || deploymentId) return;
    running.current = true; setNotice(""); setState("deploying"); setStep("source"); setLogs("Inspecting source and detecting deployment settings…\n");
    try {
      const post = async (endpoint: string, body: unknown) => {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed");
        return data;
      };
      let sourceRoot = source, preparedSource: string | undefined;
      if (source.startsWith("https://")) {
        const prepared = await post("/api/deploy/prepare-git", { repoUrl: source, branch: options.current.branch || "" });
        sourceRoot = prepared.sourceRoot; preparedSource = prepared.preparedSource;
      }
      const analysis = await post("/api/deploy/analyze", { sourceRoot, appDirectory: options.current.appDirectory || "." });
      const setup = parseProjectSetup({ ...options.current, sourceRoot, appDirectory: analysis.appDirectory,
        framework: options.current.framework && options.current.framework !== "auto" ? options.current.framework : analysis.frameworkSlug && analysis.frameworkSlug !== "unknown" ? analysis.frameworkSlug : "auto",
        projectUrl: url, hostPort: options.current.hostPort || analysis.suggestedPort,
      });
      if (setup.dockerEnabled && setup.framework === "auto" && !analysis.hasDockerfile) throw new Error(`No application entry point was detected. Tell chat the application subfolder or framework. Files found: ${(analysis.filesSummary || []).join(", ") || "none"}.`);
      setLogs(previous => previous + `Detected ${analysis.framework}. Using ${setup.dockerEnabled ? "Docker" : "host execution"} on port ${setup.hostPort}.\n`);
      const response = await fetch("/api/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, projectPath: analysis.projectPath, preparedSource, sourceType: preparedSource ? "git" : "local", setup }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Deployment could not start"); }
      submitted.current = true;
      const id = response.headers.get("X-Deployment-ID");
      if (!id) throw new Error("Deployment accepted, but its tracking ID was missing. Check Deployments before retrying.");
      if (id) {
        setDeploymentId(id);
        try { if (key) localStorage.setItem(`${key}:deployment`, id); } catch { setNotice("Keep this chat open; the deployment recovery link could not be saved."); }
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Deployment started, but its progress stream is unavailable. Check Deployments before retrying.");
      const decoder = new TextDecoder(); let buffer = "", terminal = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = done ? "" : lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let event; try { event = JSON.parse(line.slice(5)); } catch { continue; }
          if (event.step && !["failed", "rollback"].includes(event.step)) setStep(event.step);
          if (event.logDelta || event.message) setLogs(previous => (previous + (event.logDelta || `[${event.step}] ${event.message}\n`)).slice(-100000));
          if (event.status === "error" || event.step === "failed") { terminal = true; setState("error"); setNotice(event.message || "Deployment stopped"); }
          if (event.step === "complete" && event.status === "success" && !terminal) { terminal = true; setState("success"); setLiveUrl(event.url || null); setContainer(event.container || null); }
        }
        if (done) break;
      }
      if (!terminal) throw new Error("Progress connection ended. Checking the saved deployment status; do not start another attempt yet.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Deployment needs attention"); setState("error"); }
    finally { running.current = false; }
  }

  return <section className="my-3 min-w-0">
    {state === "ready" && !deploymentId ? <div className="rounded-xl border border-white/10 p-4 space-y-3">
      <p className="text-sm text-white/80">Confirm the name and address. I’ll inspect the source and use the detected settings. Tell me any additional requirements in chat before starting.</p>
      <label className="block text-xs text-white/60">Project name<input className="ray-input w-full mt-1" value={name} onChange={e => setName(e.target.value)} /></label>
      {<label className="block text-xs text-white/60">Repository URL or existing path<input className="ray-input w-full mt-1" value={source} onChange={e => setSource(e.target.value)} /></label>}
      <label className="block text-xs text-white/60">Application URL (optional)<input className="ray-input w-full mt-1" value={url} placeholder="Leave blank for port access" onChange={e => setUrl(e.target.value)} /></label>
      <p className="text-xs text-white/40 break-all">Source: {source || "Not supplied"}</p>
      <button type="button" disabled={!restored || !name.trim() || !source.trim()} className="ray-btn-primary text-xs" onClick={deploy}>Deploy {name || "application"}</button>
      <Link href="/settings" className="text-xs text-white/50 ml-3 underline">Private Git access</Link>
    </div> : resumed ? <div className="ray-card p-4 text-sm">Deployment {state === "success" ? "healthy" : state === "error" ? "needs attention" : "status syncing"}. <Link className="underline" href={`/deployments/${deploymentId}`}>View progress</Link></div> : <DeploymentPipelineFlow chatMode currentStep={step} flowState={state} dockerEnabled={options.current.dockerEnabled !== false} projectName={name} buildLogs={logs} errorMessage={notice} liveUrl={liveUrl} containerName={container} onRetry={() => {}} onTroubleshoot={() => {}} />}
    {notice && <p role="status" className="mt-3 text-xs text-amber-300 leading-relaxed">{notice}</p>}
    {state === "error" && !deploymentId && !submitted.current && <button className="ray-btn-ghost text-xs mt-2" onClick={() => setState("ready")}>Edit details</button>}
  </section>;
}
