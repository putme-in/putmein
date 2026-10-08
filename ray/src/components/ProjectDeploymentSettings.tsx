"use client";
import { useState } from "react";
import LegacyArtifactReview from "./LegacyArtifactReview";
import ProjectMonitoringSettings from "./ProjectMonitoringSettings";
import ProjectLogRetention from "./ProjectLogRetention";
import ProjectReleaseControls from "./ProjectReleaseControls";
import DeploymentSetupFields from "./DeploymentSetupFields";
import type { ProjectSetup } from "@/lib/project-setup";

export default function ProjectDeploymentSettings({ projectId }: { projectId: string }) {
  const [setup, setSetup] = useState<ProjectSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/setup`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load setup");
      setSetup(data.setup);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load setup"); }
    finally { setBusy(false); }
  }
  return <><section className="ray-card p-5" id="section-deployment-setup">
    <h2 className="font-sans font-bold text-lg text-white mb-1">Deployment setup</h2>
    <p className="text-xs text-white/50 mb-4">Configure the next build, CI/CD update or rebuild. Saving does not restart the running application. Rebuild uses the current source snapshot; use CI/CD to fetch new commits.</p>
    {!setup ? <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={load}>{busy ? "Loading…" : "Edit deployment setup"}</button> :
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setMessage("");
        try {
          const response = await fetch(`/api/projects/${projectId}/setup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setup) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not save setup");
          setSetup(data.setup); setMessage("Saved. Deployment settings apply on the next build.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save setup"); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy} className="flex flex-col gap-4">
          <DeploymentSetupFields value={setup} onChange={setSetup} includeDirectory />
          <div className="flex gap-2"><button type="submit" className="ray-btn-primary text-xs">{busy ? "Saving…" : "Save setup"}</button>
          <button type="button" className="ray-btn-ghost text-xs" onClick={() => { setSetup(null); setMessage(""); }}>Close</button></div>
        </fieldset>
      </form>}
    {message && <p role="status" className="text-xs text-white/70 mt-3">{message}</p>}
  </section><ProjectReleaseControls projectId={projectId} /><ProjectLogRetention projectId={projectId} /><ProjectMonitoringSettings projectId={projectId} /><LegacyArtifactReview /></>;
}
