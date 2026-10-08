"use client";
import { useId, useEffect, useState } from "react";
import DeploymentServiceFields from "./DeploymentServiceFields";
import { FRAMEWORKS, FRAMEWORK_TEMPLATE_NOTES } from "@/lib/framework-registry";
import type { ProjectSetup } from "@/lib/project-setup";

export default function DeploymentSetupFields({ value, onChange, includeEnvironment = true, includeDirectory = false, existing = false }: {
  value: ProjectSetup; onChange: (value: ProjectSetup) => void; includeEnvironment?: boolean; includeDirectory?: boolean; existing?: boolean;
}) {
  const id = useId();
  const update = (key: keyof ProjectSetup, content: unknown) => onChange({ ...value, [key]: content });
  return <div className="flex flex-col gap-4">
    <div>
      <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={value.dockerEnabled} onChange={event => update("dockerEnabled", event.target.checked)} />Use Docker <span className="ray-badge">Recommended</span></label>
      <p className="text-xs text-white/40 mt-1.5">{value.dockerEnabled ? "Isolates your application in a container." : "Runs directly on a Linux or macOS server as Brain’s OS account, without container isolation. Only deploy trusted code. Runtimes and dependencies must be installed on the host."}</p>
      {includeDirectory && <p className="text-xs text-white/40 mt-1.5">Stop the current deployment before switching runtime.</p>}
    </div>
    {includeDirectory && <div><label htmlFor={`${id}-directory`} className="ray-eyebrow block mb-1.5">Application directory</label>
      <input id={`${id}-directory`} className="ray-input text-xs font-mono" value={value.appDirectory} onChange={event => update("appDirectory", event.target.value)} />
      <p className="text-xs text-white/40 mt-1.5 break-all">Relative to {value.sourceRoot}. Changes apply on the next deployment.</p></div>}
    <div><label htmlFor={`${id}-framework`} className="ray-eyebrow block mb-1.5">Framework</label>
      <select id={`${id}-framework`} className="ray-input text-xs" value={value.framework} onChange={event => update("framework", event.target.value)}>
        <option value="auto">Auto-detect</option>{FRAMEWORKS.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
      </select><p className="text-xs text-white/40 mt-1.5">{value.dockerEnabled ? "An existing Dockerfile takes precedence. Frameworks without a built-in template require a Dockerfile." : "Framework detection is informational. Your build and start commands control host execution."}</p></div>
    {FRAMEWORK_TEMPLATE_NOTES[value.framework] && <p className="text-xs text-white/50">{FRAMEWORK_TEMPLATE_NOTES[value.framework]}</p>}
    {([ ["buildCommand", "Build command", "Use Dockerfile or framework default"], ["startCommand", "Start command", "Use Dockerfile or framework default"] ] as const).map(([key, label, placeholder]) =>
      <div key={key}><label htmlFor={`${id}-${key}`} className="ray-eyebrow block mb-1.5">{label}</label><input id={`${id}-${key}`} className="ray-input text-xs font-mono" value={value[key]} required={!value.dockerEnabled && key === "startCommand"} placeholder={value.dockerEnabled ? placeholder : key === "startCommand" ? "Required, e.g. npm start" : "Optional, e.g. npm ci && npm run build"} onChange={event => update(key, event.target.value)} /></div>)}
    <p className="text-xs text-white/40">{value.dockerEnabled ? "Commands run inside Docker during deployment. For a custom Dockerfile, set the build command in that file. A start override requires /bin/sh in the image." : "Start commands must stay in the foreground. Build commands run before the existing managed process is stopped; no dependencies are installed automatically."}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{([ ["hostPort", "Public host port"], ["containerPort", "Application port inside Docker"] ] as const).filter(([key]) => value.dockerEnabled || key !== "containerPort").map(([key,label]) =>
      <div key={key}><label htmlFor={`${id}-${key}`} className="ray-eyebrow block mb-1.5">{label}</label><input id={`${id}-${key}`} type="number" min={1} max={65535} className="ray-input text-xs font-mono" value={value[key] ?? ""} placeholder="Automatic" onChange={event => update(key, event.target.value === "" ? null : Number(event.target.value))} /></div>)}</div>
    <p className="text-xs text-white/40">{value.dockerEnabled ? "Port mapping does not change the port your application listens on." : "The chosen host port is passed as PORT to the build and application. Configure the application to use it; there is no port mapping."}</p>
    <div><label htmlFor={`${id}-url`} className="ray-eyebrow block mb-1.5">Application URL (optional)</label><input id={`${id}-url`} className="ray-input text-xs" value={value.projectUrl} placeholder="https://app.example.com" onChange={event => update("projectUrl", event.target.value)} />
      <p className="text-xs text-white/40 mt-1.5">Choose direct port access or managed HTTPS below.</p></div>
    <DeploymentServiceFields value={value} onChange={onChange} />
    {existing && <p className="text-xs text-white/40">Registration alone does not start or replace an existing application.</p>}
    {includeEnvironment && <div><label htmlFor={`${id}-env`} className="ray-eyebrow block mb-1.5">Runtime environment variables (JSON object)</label>
      <EnvironmentEditor id={`${id}-env`} value={value.envVars} onChange={env => update("envVars", env)} />
      <p className="text-xs text-white/40 mt-1.5">{value.dockerEnabled ? "Runtime values only; these are not Docker build arguments or edits to the source .env file." : "Passed to your host build and start commands. Brain’s database credentials and provider keys are not inherited."}</p></div>}
  </div>;
}

function EnvironmentEditor({ id, value, onChange }: { id: string; value: Record<string,string>; onChange: (value: Record<string,string>) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(""); }, [value]);
  if (!revealed) return <button type="button" className="ray-btn-ghost text-xs" onClick={() => setRevealed(true)}>Edit runtime variables ({Object.keys(value).length})</button>;
  return <><textarea id={id} className="ray-input text-xs font-mono min-h-24" value={text} spellCheck={false} onChange={event => {
    setText(event.target.value);
    try { const parsed = JSON.parse(event.target.value || "{}"); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some(v => typeof v !== "string")) throw new Error(); setError(""); onChange(parsed); event.target.setCustomValidity(""); }
    catch { setError("Enter a JSON object with string values."); event.target.setCustomValidity("Enter a JSON object with string values."); }
  }} />{error && <p role="alert" className="text-xs text-red-400">{error}</p>}</>;
}
