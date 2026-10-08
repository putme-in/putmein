"use client";

import { useId, type ReactNode } from "react";

export interface ProjectSourceAnalysis {
  projectPath: string;
  sourceRoot: string;
  appDirectory: string;
  framework: string;
  frameworkSlug: string;
  language: string;
  hasDockerfile: boolean;
  isMonorepo: boolean;
  startCommand: string;
}

/** Shared setup identity and source review for uploads and existing projects. */
export default function ProjectSetupFields({
  name, onNameChange, analysis, appDirectory, onDirectoryChange, onAnalyze,
  busy = false, directoryEditable = true, children,
}: {
  name: string;
  onNameChange: (value: string) => void;
  analysis: ProjectSourceAnalysis;
  appDirectory: string;
  onDirectoryChange: (value: string) => void;
  onAnalyze: () => void;
  busy?: boolean;
  directoryEditable?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const sourceChanged = appDirectory !== analysis.appDirectory;
  return (
    <fieldset disabled={busy} className="flex flex-col gap-4 min-w-0">
      <div>
        <label htmlFor={`${id}-name`} className="ray-eyebrow block mb-1.5">Project name</label>
        <input id={`${id}-name`} required maxLength={100} value={name}
          onChange={event => onNameChange(event.target.value)} className="ray-input text-xs" />
      </div>
      <div>
        <label htmlFor={`${id}-directory`} className="ray-eyebrow block mb-1.5">Application directory</label>
        <div className="flex gap-2">
          <input id={`${id}-directory`} disabled={!directoryEditable} value={appDirectory} placeholder=". or apps/web"
            onChange={event => onDirectoryChange(event.target.value)} className="ray-input font-mono text-xs flex-1 min-w-0" />
          <button type="button" disabled={!directoryEditable} onClick={onAnalyze} className="ray-btn-ghost text-xs px-3">
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        <p className="text-xs text-white/40 mt-1.5 break-all">Relative to {analysis.sourceRoot}</p>
        {sourceChanged && <p role="status" className="text-xs text-amber-400 mt-1.5">Analyze this directory before continuing.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70" aria-live="polite">
        <span className="ray-badge">{analysis.framework}</span>
        <span>{analysis.language}</span>
        {analysis.hasDockerfile && <span className="ray-badge">Dockerfile found</span>}
        {analysis.isMonorepo && <span className="ray-badge">Workspace detected</span>}
      </div>
      {children}
    </fieldset>
  );
}
