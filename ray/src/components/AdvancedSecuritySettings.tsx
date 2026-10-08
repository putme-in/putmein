"use client";
import { useEffect, useState } from "react";
type Config = { dependencies: boolean; images: boolean; rescanHours: number };
export default function AdvancedSecuritySettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [available, setAvailable] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/security/advanced", { signal: controller.signal }).then(async response => {
      if (response.status === 403) { setHidden(true); return; }
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfig(data.config); setAvailable(data.scannerAvailable);
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Settings unavailable"); });
    return () => controller.abort();
  }, []);
  if (hidden) return null;
  return <section className="ray-card p-5 mb-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-sans text-lg font-semibold text-white">Dependency, image and scheduled scans</h2><button className="ray-btn-ghost text-xs" onClick={() => setOpen(!open)}>{open ? "Close settings" : "Configure"}</button></div>
    {open && config && <form className="mt-4 space-y-3 text-xs text-white/70" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/security/advanced", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setConfig(data.config); setAvailable(data.scannerAvailable); setMessage("Saved. Scheduled scanning picks up changes on its next scheduling check. Existing applications are not restarted.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save"); } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="space-y-3">
      <p>Administrator policy for all projects. Trivy {available ? "is available" : "is not installed"} on Brain. Vulnerability scanning requires a local advisory cache refreshed within 48 hours. See Developer Guide → Advanced Security before enabling.</p>
      <label className="block"><input type="checkbox" checked={config.dependencies} onChange={event => setConfig({ ...config, dependencies: event.target.checked })} /> Scan supported dependency manifests before deployment and during manual/scheduled scans</label>
      <label className="block"><input type="checkbox" checked={config.images} onChange={event => setConfig({ ...config, images: event.target.checked })} /> Scan local Docker images before starting them and during manual/scheduled scans</label>
      <label className="block">Rescan enabled monitored projects every (hours; 0 disables)<input className="ray-input text-xs mt-1" type="number" min={0} max={168} value={config.rescanHours} onChange={event => setConfig({ ...config, rescanHours: Number(event.target.value) })} /></label>
      <p className="text-white/50">Schedules accept 6–168 hours. High/critical vulnerabilities and incomplete enabled checks block deployment. Scheduled findings produce reports and alerts but do not stop running applications. Source security checks run even when Trivy options are off.</p>
      <p className="text-white/50">The existing global security-gate switch still controls deployment blocking. Schedules are independently enabled here. Scans share the lifecycle lock; deployment actions may ask you to retry while a scan is running.</p>
      <button className="ray-btn-primary text-xs" type="submit">{busy ? "Saving…" : "Save security policy"}</button>
    </fieldset></form>}
    {message && <p role="status" className="text-xs text-white/60 mt-3">{message}</p>}
  </section>;
}
