"use client";
import { useState } from "react";

type Severity = "info" | "warn" | "error" | "critical";
type Rule = { id: string; pattern: string; message: string; severity: Severity; enabled: boolean; cooldownSeconds: number };
type Config = {
  version: number; builtinEnabled: boolean; aiEnabled: boolean; cooldownSeconds: number; intervalSeconds: number;
  logPaths: string[]; rules: Rule[];
  json: { enabled: boolean; levelField: string; messageField: string; levels: Record<string, Severity> };
};
type Match = { id: string; severity: Severity; message: string };
const input = "ray-input w-full text-xs";
export default function ProjectMonitoringSettings({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sample, setSample] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [levels, setLevels] = useState("");
  async function perform(action: "get" | "save" | "preview") {
    setBusy(true); setMessage(""); setMatches(null);
    try {
      const next = action !== "get" && config ? { ...config, logPaths: config.logPaths.map(path => path.trim()).filter(Boolean), json: { ...config.json, levels: JSON.parse(levels) } } : null;
      const response = await fetch(`/api/projects/${projectId}/monitoring`, action === "get" ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, config: next, sample }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update monitoring");
      if (action === "preview") { setMatches(data.matches); setMessage("Preview only. No alert was created and nothing was saved."); }
      else {
        setConfig(data.config); setLevels(JSON.stringify(data.config.json.levels, null, 2));
        if (action === "save") setMessage("Saved. The active monitor picks up these settings on its next poll; no application restart is needed.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid configuration"); }
    finally { setBusy(false); }
  }
  function patchRule(index: number, value: Partial<Rule>) {
    if (config) setConfig({ ...config, rules: config.rules.map((rule, i) => i === index ? { ...rule, ...value } : rule) });
  }
  return <section className="ray-card p-5 mt-4">
    <h2 className="font-sans font-bold text-lg text-white mb-1">Monitoring rules and loggers</h2>
    <p className="text-xs text-white/50 mb-4">Customize alerts for this project. Built-in and custom matches work without AI.</p>
    {!config ? <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform("get")}>Configure monitoring</button> :
      <fieldset disabled={busy} className="space-y-4">
        <div className="flex flex-wrap gap-4 text-xs text-white/70">
          <label><input type="checkbox" checked={config.builtinEnabled} onChange={e => setConfig({ ...config, builtinEnabled: e.target.checked })} /> Built-in error rules</label>
          <label><input type="checkbox" checked={config.aiEnabled} onChange={e => setConfig({ ...config, aiEnabled: e.target.checked })} /> AI analysis for unmatched logs</label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-white/60">Alert cooldown (seconds)
            <input className={input} type="number" min={10} max={86400} value={config.cooldownSeconds} onChange={e => setConfig({ ...config, cooldownSeconds: Number(e.target.value) })} />
          </label>
          <label className="text-xs text-white/60">Polling interval (seconds; 0 uses project setting)
            <input className={input} type="number" min={0} max={3600} value={config.intervalSeconds} onChange={e => setConfig({ ...config, intervalSeconds: Number(e.target.value) })} />
          </label>
        </div>
        <label className="block text-xs text-white/60">Extra server-side log files, relative to the project (one per line)
          <textarea className={input} rows={3} value={config.logPaths.join("\n")} onChange={e => setConfig({ ...config, logPaths: e.target.value.split("\n") })} placeholder="logs/application.log" />
        </label>
        <p className="text-xs text-white/40">Up to ten files. Paths cannot escape the project through symlinks. Container loggers should write to stdout/stderr.</p>
        <div className="space-y-3">
          {config.rules.map((rule, index) => <div key={index} className="border-t border-white/10 pt-3 space-y-2">
            <div className="flex gap-3 items-center text-xs text-white/60">
              <label><input type="checkbox" checked={rule.enabled} onChange={e => patchRule(index, { enabled: e.target.checked })} /> Enabled</label>
              <button type="button" className="ray-btn-ghost text-xs ml-auto" onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>Remove rule</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-white/60">Rule ID<input className={input} value={rule.id} onChange={e => patchRule(index, { id: e.target.value })} /></label>
              <label className="text-xs text-white/60">RE2 pattern<input className={input} value={rule.pattern} onChange={e => patchRule(index, { pattern: e.target.value })} placeholder="(?i)payment provider timeout" /></label>
              <label className="text-xs text-white/60">Alert message<input className={input} value={rule.message} onChange={e => patchRule(index, { message: e.target.value })} /></label>
              <label className="text-xs text-white/60">Severity<select className={input} value={rule.severity} onChange={e => patchRule(index, { severity: e.target.value as Severity })}>{["info", "warn", "error", "critical"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className="text-xs text-white/60">Rule cooldown (0 uses default)<input className={input} type="number" min={0} max={86400} value={rule.cooldownSeconds} onChange={e => patchRule(index, { cooldownSeconds: Number(e.target.value) })} /></label>
            </div>
          </div>)}
          <button type="button" className="ray-btn-ghost text-xs" disabled={config.rules.length >= 32} onClick={() => setConfig({ ...config, rules: [...config.rules, { id: `rule-${Date.now()}`, enabled: true, pattern: "", message: "", severity: "error", cooldownSeconds: 0 }] })}>Add error pattern</button>
        </div>
        <label className="block text-xs text-white/70"><input type="checkbox" checked={config.json.enabled} onChange={e => setConfig({ ...config, json: { ...config.json, enabled: e.target.checked } })} /> Recognize structured JSON log lines</label>
        {config.json.enabled && <div className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs text-white/60">Level field<input className={input} value={config.json.levelField} onChange={e => setConfig({ ...config, json: { ...config.json, levelField: e.target.value } })} /></label>
            <label className="text-xs text-white/60">Message field<input className={input} value={config.json.messageField} onChange={e => setConfig({ ...config, json: { ...config.json, messageField: e.target.value } })} /></label>
          </div>
          <label className="block text-xs text-white/60">Level-to-severity mapping (JSON)
            <textarea className={input} rows={5} value={levels} onChange={e => setLevels(e.target.value)} />
          </label>
          <p className="text-xs text-white/40">Nested fields use dots, such as log.level. Numeric levels use string keys, such as "50": "error".</p>
        </div>}
        <label className="block text-xs text-white/60">Sample log text (avoid credentials)
          <textarea className={input} rows={4} maxLength={8192} value={sample} onChange={e => setSample(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="ray-btn-ghost text-xs" onClick={() => perform("preview")}>Preview matches</button>
          <button type="button" className="ray-btn-primary text-xs" onClick={() => perform("save")}>Save monitoring settings</button>
        </div>
        {matches && <ul className="text-xs text-white/70 space-y-1">{matches.length ? matches.map(match => <li key={match.id}>{match.severity}: {match.message}</li>) : <li>No matching rules.</li>}</ul>}
      </fieldset>}
    {(busy || message) && <p role="status" className="text-xs text-white/60 mt-3">{busy ? "Working…" : message}</p>}
  </section>;
}
